#!/usr/bin/env python3
"""
Tests of tools/reactpod_config.py and tools/reactpod_format.py without hardware: line splitting
into events and responses, request matching against a fake BLE link, report and state formatting,
the keyboard parser of `live`, and the fetch + ack sequence against a fake request function.
Needs bleak (pip install bleak), like the client itself.

    python tools/test_reactpod_config.py
"""
import asyncio
import contextlib
import io
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reactpod_config as config  # noqa: E402
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


if __name__ == "__main__":
    unittest.main()
