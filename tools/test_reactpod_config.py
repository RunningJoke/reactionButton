#!/usr/bin/env python3
"""
Tests of tools/reactpod_config.py and tools/reactpod_format.py without hardware: line splitting
into events and responses, request matching against a fake BLE link, report and state formatting,
the keyboard parser of `live`, and the fetch + ack sequence against a fake request function.
Needs bleak (pip install bleak), like the client itself.

    python tools/test_reactpod_config.py
"""
import asyncio
import base64
import contextlib
import hashlib
import io
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reactpod_config as config  # noqa: E402
import reactpod_ota as ota  # noqa: E402
from reactpod_format import report_line  # noqa: E402

SAMPLE_REPORT = {
    "event": "report", "id": 17, "program": "/prog/dreieck.json", "setId": "1a2b3c4d", "athlete": "ath_42",
    "cycle": 3, "startMs": 120400, "endMs": 165210,
    "values": [{"t": 121003, "metric": "reaction", "pod": 1, "ms": 312}],
    "stats": {"reaction": {"count": 1, "average": 312, "best": 312, "worst": 312},
              "lap": {"count": 1, "average": 44097, "best": 44097, "worst": 44097}},
    "vars": {"RUNS": 12, "MAX_LOOPS": 12},
}


def line(message: dict) -> bytes:
    return (json.dumps(message) + "\n").encode("utf-8")


class FakeLink:
    """Stands in for BleakClient: collects the request bytes like the pod does (until '\\n') and
    answers them with `reply(request)`, which returns the bytes of one or more indications."""

    mtu_size = 23

    def __init__(self, reply):
        self.reply = reply
        self.pod = None
        self.inbox = b""
        self.requests = []

    async def write_gatt_char(self, _uuid, data, response=True):
        self.inbox += data
        while b"\n" in self.inbox:
            raw, _, self.inbox = self.inbox.partition(b"\n")
            request = json.loads(raw.decode("utf-8"))
            self.requests.append(request)
            self.pod._on_data(None, bytearray(self.reply(request)))


class SplitTests(unittest.TestCase):
    def test_one_message_per_line(self):
        buffer = bytearray()
        messages = config.split_messages(buffer, line({"op": "info", "id": 1, "ok": True}))
        self.assertEqual(messages, [{"op": "info", "id": 1, "ok": True}])
        self.assertEqual(buffer, bytearray())

    def test_partial_lines_are_kept_until_the_newline(self):
        buffer = bytearray()
        self.assertEqual(config.split_messages(buffer, b'{"event":"sta'), [])
        self.assertEqual(config.split_messages(buffer, b'te","state":"RUN"}\n{"id":2'),
                         [{"event": "state", "state": "RUN"}])
        self.assertEqual(config.split_messages(buffer, b',"ok":true}\n'), [{"id": 2, "ok": True}])

    def test_events_are_told_apart_from_responses(self):
        messages = config.split_messages(bytearray(), line({"event": "report", "id": 3}) + line({"id": 3, "ok": True}))
        self.assertEqual([config.is_event(m) for m in messages], [True, False])

    def test_line_that_is_not_json_is_skipped(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            messages = config.split_messages(bytearray(), b"garbage\n" + line({"ok": True}))
        self.assertEqual(messages, [{"ok": True}])
        self.assertIn("not JSON", err.getvalue())


class RoutingTests(unittest.TestCase):
    def test_event_during_a_request_is_not_taken_as_its_response(self):
        def reply(request):
            return (line({"event": "state", "state": "RUN"})
                    + line({"op": request["op"], "id": request["id"], "ok": True, "value": 7}))

        async def scenario():
            events = []
            link = FakeLink(reply)
            pod = config.ReactPodConfig(link, on_event=events.append)
            link.pod = pod
            response = await pod.request("status")
            return response, events

        response, events = asyncio.run(scenario())
        self.assertEqual(response["value"], 7)
        self.assertEqual(events, [{"event": "state", "state": "RUN"}])

    def test_stale_response_with_another_id_is_skipped(self):
        def reply(request):
            return line({"op": "old", "id": 0, "ok": True}) + line({"op": request["op"], "id": request["id"], "ok": True})

        async def scenario():
            link = FakeLink(reply)
            pod = config.ReactPodConfig(link)
            link.pod = pod
            return await pod.request("list")

        self.assertEqual(asyncio.run(scenario())["op"], "list")

    def test_error_response_raises_pod_error_with_code(self):
        def reply(request):
            return line({"op": request["op"], "id": request["id"], "ok": False, "error": "not_ready",
                         "message": "no block waits"})

        async def scenario():
            link = FakeLink(reply)
            pod = config.ReactPodConfig(link)
            link.pod = pod
            await pod.request("command", name="continue")

        with self.assertRaises(config.PodError) as caught:
            asyncio.run(scenario())
        self.assertEqual(caught.exception.code, "not_ready")

    def test_request_is_sent_as_one_json_line(self):
        def reply(request):
            return line({"op": request["op"], "id": request["id"], "ok": True})

        async def scenario():
            link = FakeLink(reply)
            pod = config.ReactPodConfig(link)
            link.pod = pod
            await pod.request("reports", max=2)
            return link.requests

        self.assertEqual(asyncio.run(scenario())[0], {"op": "reports", "id": 1, "max": 2})


class FormatTests(unittest.TestCase):
    def test_report_line(self):
        self.assertEqual(
            report_line(SAMPLE_REPORT),
            "[report 17] cycle 3 /prog/dreieck.json 44.8 s athlete ath_42  "
            "reaction 1x avg 312 best 312 worst 312; lap 1x avg 44097 best 44097 worst 44097; "
            "RUNS=12; MAX_LOOPS=12")

    def test_report_line_with_dropped_values(self):
        text = report_line({"id": 2, "cycle": 1, "program": "/prog/a.json", "startMs": 0, "endMs": 1000,
                            "valuesDropped": 3})
        self.assertEqual(text, "[report 2] cycle 1 /prog/a.json 1.0 s  (3 values dropped)")

    def test_state_line_counts_pods(self):
        event = {"event": "state", "state": "PAUSED", "program": "/prog/x.json",
                 "pods": [{"id": 1}, {"id": 2}], "required": 2, "phonePaused": True}
        self.assertEqual(config.event_line(event), "[state] PAUSED  program /prog/x.json  pods 2/2  (phone pause)")

    def test_unknown_event_is_printed_with_its_fields(self):
        self.assertEqual(config.event_line({"event": "boot", "role": "central"}),
                         '[boot] {"role": "central"}')

    def test_status_line(self):
        text = config.status_line({"state": "RUN", "program": "/prog/x.json", "athlete": "",
                                   "reports": {"pending": 2, "dropped": 0},
                                   "ble": {"connected": True, "intervalMs": 100}})
        self.assertEqual(text, "[status] RUN  program /prog/x.json  athlete -  reports pending 2 dropped 0"
                               "  ble connected interval 100 ms")


class KeyParserTests(unittest.TestCase):
    def test_single_letter_commands(self):
        self.assertEqual(config.parse_key("c\n"), ("command", {"name": "continue"}))
        self.assertEqual(config.parse_key("r"), ("command", {"name": "repeat"}))
        self.assertEqual(config.parse_key("s"), ("command", {"name": "stop"}))
        self.assertEqual(config.parse_key("p"), ("pause", {}))
        self.assertEqual(config.parse_key("u"), ("resume", {}))
        self.assertEqual(config.parse_key("?"), ("status", {}))
        self.assertEqual(config.parse_key("q"), ("quit", {}))

    def test_variables(self):
        self.assertEqual(config.parse_key("v MAX_LOOPS=5 RUNS=-2"),
                         ("setVariables", {"values": {"MAX_LOOPS": 5, "RUNS": -2}}))

    def test_variables_must_be_integers(self):
        for bad in ("v MAX_LOOPS", "v MAX_LOOPS=x", "v =3", "v A=--3"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                config.parse_key(bad)

    def test_athlete(self):
        self.assertEqual(config.parse_key("a ath_42"), ("session", {"athlete": "ath_42"}))
        self.assertEqual(config.parse_key("a Anna Berg"), ("session", {"athlete": "Anna Berg"}))
        self.assertEqual(config.parse_key("a"), ("session", {"athlete": ""}))

    def test_empty_and_unknown_lines(self):
        self.assertIsNone(config.parse_key("   \n"))
        with self.assertRaises(ValueError):
            config.parse_key("x")
        with self.assertRaises(ValueError):
            config.parse_key("c now")


class FakeReports:
    """Pod report buffer: `reports` returns the unacknowledged reports (paged by `max`), `ack`
    removes the given id and all older ones (config-api.md §5)."""

    def __init__(self, ids):
        self.pending = [{"event": "report", "id": i, "cycle": i, "program": "/prog/a.json",
                         "startMs": 0, "endMs": 1000} for i in ids]
        self.calls = []

    async def __call__(self, op, **fields):
        self.calls.append((op, fields))
        if op == "reports":
            page = self.pending[:fields["max"]]
            return {"ok": True, "reports": page, "total": len(self.pending),
                    "more": len(self.pending) > len(page)}
        if op == "ack":
            self.pending = [r for r in self.pending if r["id"] > fields["reportId"]]
            return {"ok": True}
        raise AssertionError(op)


class FetchTests(unittest.TestCase):
    def test_fetch_prints_and_acks_all_pages(self):
        fake = FakeReports([1, 2, 3])
        out = []
        count = asyncio.run(config.fetch_reports(fake, set(), out.append))
        self.assertEqual(count, 3)
        self.assertEqual([op for op, _ in fake.calls],
                         ["reports", "ack", "ack", "reports", "ack"])
        self.assertEqual([fields["reportId"] for op, fields in fake.calls if op == "ack"], [1, 2, 3])
        self.assertEqual([text.split()[1].rstrip("]") for text in out], ["1", "2", "3"])
        self.assertEqual(fake.pending, [])

    def test_report_already_printed_from_an_event_is_acked_but_not_printed_again(self):
        fake = FakeReports([4, 5])
        out = []
        asyncio.run(config.fetch_reports(fake, {4}, out.append))
        self.assertEqual([text.split()[1].rstrip("]") for text in out], ["5"])
        self.assertEqual([fields["reportId"] for op, fields in fake.calls if op == "ack"], [4, 5])

    def test_nothing_pending_sends_one_request(self):
        fake = FakeReports([])
        self.assertEqual(asyncio.run(config.fetch_reports(fake, set(), [].append)), 0)
        self.assertEqual([op for op, _ in fake.calls], ["reports"])

    def test_continue_is_retried_while_no_block_waits(self):
        attempts = []

        async def request(op, **fields):
            attempts.append((op, fields))
            if len(attempts) < 3:
                raise config.PodError(op, {"error": "not_ready", "message": "no block waits"})
            return {"ok": True}

        out = []
        self.assertTrue(asyncio.run(config.answer_continue(request, out.append)))
        self.assertEqual(len(attempts), 3)
        self.assertEqual(attempts[0], ("command", {"name": "continue"}))
        self.assertEqual(out, ["[auto] continue"])

    def test_other_errors_are_not_retried(self):
        attempts = []

        async def request(op, **fields):
            attempts.append(op)
            raise config.PodError(op, {"error": "busy", "message": "not now"})

        out = []
        self.assertFalse(asyncio.run(config.answer_continue(request, out.append)))
        self.assertEqual(len(attempts), 1)
        self.assertIn("busy", out[0])


def fail(code: str, message: str = "", **extra) -> dict:
    return {"ok": False, "error": code, "message": message, **extra}


class FakeOtaPod:
    """The ota ops as the firmware answers them (config-api.md "Firmware update"), one update at a time.
    `fail_writes_after`: the next otaWrite after that many good ones answers bad_offset.
    `begin_error`: otaBegin answers this error code (a pod not in the menu answers busy)."""

    def __init__(self, fail_writes_after=None, begin_error=None):
        self.state = "idle"
        self.size = self.sha = None
        self.data = bytearray()
        self.ops = []
        self.writes = 0
        self.activated = False
        self.fail_writes_after = fail_writes_after
        self.begin_error = begin_error

    @classmethod
    def partial(cls, image: bytes, received: int):
        """A pod with an unfinished upload of `image` (the connection dropped after `received` bytes)."""
        pod = cls()
        pod.state, pod.size, pod.sha = "receiving", len(image), hashlib.sha256(image).hexdigest()
        pod.data = bytearray(image[:received])
        return pod

    def handle(self, op: str, fields: dict) -> dict:
        self.ops.append(op)
        if op == "otaBegin":
            if self.begin_error:
                return fail(self.begin_error, "not allowed now")
            if not (self.state in ("receiving", "ready") and fields["size"] == self.size and fields["sha256"] == self.sha):
                self.state, self.size, self.sha, self.data = "receiving", fields["size"], fields["sha256"], bytearray()
            return {"ok": True, "slotSize": 1835008, "maxChunk": 3072, "received": len(self.data)}
        if op == "otaWrite":
            if self.state != "receiving":
                return fail("not_ready", "no update is receiving")
            if self.fail_writes_after is not None and self.writes >= self.fail_writes_after:
                return fail("bad_offset", "offset is not the bytes received", received=len(self.data))
            if fields["offset"] != len(self.data):
                return fail("bad_offset", "offset is not the bytes received", received=len(self.data))
            self.data += base64.b64decode(fields["data"])
            self.writes += 1
            return {"ok": True, "received": len(self.data)}
        if op == "status":
            return {"ok": True, "ota": {"state": self.state, "received": len(self.data), "total": self.size or 0}}
        if op == "otaEnd":
            if self.state == "ready":
                return fail("not_ready", "update state ready")
            if len(self.data) != self.size:
                return fail("not_ready", "not all bytes received")
            if hashlib.sha256(self.data).hexdigest() != self.sha:
                self.state = "failed"
                return fail("ota_failed", "sha256 differs")
            self.state = "ready"
            return {"ok": True}
        if op == "otaActivate":
            if self.state != "ready":
                return fail("not_ready", "no verified update")
            self.activated = True
            return {"ok": True}
        if op == "otaAbort":
            self.state, self.data = "idle", bytearray()
            return {"ok": True}
        return fail("unknown_op", op)


def run_over_ble(image: bytes, pod: FakeOtaPod, activate: bool = True):
    """The async driver (reactpod_config.py) over the fake BLE link."""
    link = FakeLink(lambda request: line({"op": request["op"], "id": request["id"],
                                          **pod.handle(request["op"], {k: v for k, v in request.items()
                                                                       if k not in ("op", "id")})}))
    cfg = config.ReactPodConfig(link)
    link.pod = cfg

    async def scenario():
        return await ota.run_async(ota.ota_steps(image, activate=activate),
                                   lambda op, fields: cfg.request(op, check=False, **fields))
    return asyncio.run(scenario())


def run_over_serial(image: bytes, pod: FakeOtaPod, activate: bool = True):
    """The sync driver (reactpod_serial.py) over a fake USB request function."""
    return ota.run_sync(ota.ota_steps(image, activate=activate), lambda op, fields: pod.handle(op, fields))


IMAGE = bytes(range(256)) * 20      # 5120 bytes: writes of 2048, 2048, 1024 (chunks capped at 2048)


class OtaTests(unittest.TestCase):
    def test_normal_run_uploads_verifies_and_activates(self):
        for name, run in (("ble", run_over_ble), ("usb", run_over_serial)):
            with self.subTest(transport=name):
                pod = FakeOtaPod()
                self.assertEqual(run(IMAGE, pod), "activated")
                self.assertEqual(pod.ops, ["otaBegin", "otaWrite", "otaWrite", "otaWrite", "otaEnd", "otaActivate"])
                self.assertEqual(bytes(pod.data), IMAGE)
                self.assertTrue(pod.activated)

    def test_begin_carries_size_and_sha256(self):
        pod = FakeOtaPod()
        seen = []

        def request(op, fields):
            seen.append((op, fields))
            return pod.handle(op, fields)
        ota.run_sync(ota.ota_steps(IMAGE), request)
        self.assertEqual(seen[0], ("otaBegin", {"size": len(IMAGE), "sha256": hashlib.sha256(IMAGE).hexdigest()}))

    def test_resume_continues_from_received(self):
        pod = FakeOtaPod.partial(IMAGE, 3000)
        self.assertEqual(run_over_ble(IMAGE, pod), "activated")
        self.assertEqual(pod.ops, ["otaBegin", "otaWrite", "otaWrite", "otaEnd", "otaActivate"])
        self.assertTrue(pod.activated)
        self.assertEqual(bytes(pod.data), IMAGE)

    def test_bad_offset_is_an_error_and_the_open_update_is_aborted(self):
        pod = FakeOtaPod(fail_writes_after=1)
        with self.assertRaises(ota.OtaError) as caught:
            run_over_ble(IMAGE, pod)
        self.assertEqual(caught.exception.code, "bad_offset")
        self.assertIs(caught.exception.aborted, True)
        self.assertEqual(pod.ops, ["otaBegin", "otaWrite", "otaWrite", "otaAbort"])
        self.assertEqual(pod.state, "idle")
        self.assertFalse(pod.activated)

    def test_no_activate_stops_after_otaend(self):
        pod = FakeOtaPod()
        self.assertEqual(run_over_serial(IMAGE, pod, activate=False), "verified")
        self.assertEqual(pod.ops[-1], "otaEnd")
        self.assertEqual(pod.state, "ready")     # left ready, not aborted
        self.assertFalse(pod.activated)

    def test_rerun_after_no_activate_activates_without_otaend(self):
        pod = FakeOtaPod()
        self.assertEqual(run_over_serial(IMAGE, pod, activate=False), "verified")
        self.assertEqual(run_over_serial(IMAGE, pod), "activated")
        self.assertEqual(pod.ops[5:], ["otaBegin", "status", "otaActivate"])
        self.assertTrue(pod.activated)

    def test_failure_before_the_update_opens_sends_no_abort(self):
        pod = FakeOtaPod(begin_error="busy")
        with self.assertRaises(ota.OtaError) as caught:
            run_over_serial(IMAGE, pod)
        self.assertEqual(caught.exception.code, "busy")
        self.assertIsNone(caught.exception.aborted)
        self.assertEqual(pod.ops, ["otaBegin"])

    def test_result_lines_flag_a_rollback(self):
        lines, code = ota.result_lines("app0", {"firmware": "2.19", "ota": {"running": "app1", "lastResult": "ok"}})
        self.assertEqual(code, 0)
        self.assertIn("info.ota.running app1 (before: app0)", lines)
        self.assertEqual(ota.result_lines("app1", {"ota": {"running": "app1", "lastResult": "rolledBack"}})[1], 1)


if __name__ == "__main__":
    unittest.main()
