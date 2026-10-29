#!/usr/bin/env python3
"""
Hardware test #38: does BLE stay connected on the central while ESP-NOW runs, and do the
game timing and memory hold? Checklist: docs/firmware/testing.md §8.

All pods run the test firmware (pio env BleEspNowTest). The central and the peripherals are
on USB: the script polls them, simulates the presses (central via trace events, peripherals
when they light up) and, in mode "phone", stays connected to the central over BLE, pings it
and receives one load line (~1 KB, stands in for a live report) per period.

Requires: pip install pyserial bleak   (bleak only for --mode phone)

    python tools/ble_espnow_test.py --port COM4 --peripheral-port COM5 --peripheral-port COM6 \\
        --program /prog/dreieck.json --mode phone --minutes 30 --out results/dreieck-phone

Modes:
    off        BLE is switched off at select, as in the normal firmware (baseline)
    advertise  BLE stays on, the script does not connect (the central keeps advertising). A phone
               connected by hand (e.g. nRF Connect) gets the load lines
    phone      BLE stays on, this PC is connected: pings + load lines during the whole game

Output (prefix --out):
    <out>-central.csv      1 Hz: state, heap, BLE connection, indication queue, loop gaps
    <out>-links.csv        every --status-period s, one row per pod: ESP-NOW link counters
    <out>-peripherals.csv  1 Hz per peripheral: clock offset, late ARMs, start error
    <out>-ble.csv          pings (round trip), load lines (seq, delay), connects / disconnects
    <out>-events.csv       state changes, restarts, results
    <out>-summary.json     the numbers of the summary and the pass/fail checks

The serial ports must not be used by another program (close pio device monitor).
"""
import argparse
import asyncio
import csv
import json
import queue
import random
import statistics
import sys
import threading
import time
from pathlib import Path

from reactpod_serial import PodSerial, color, hint, say

TEST_BUILD = "bleEspNowTest"
MIN_FREE_HEAP = 40 * 1024       # #38: minimum free heap > 40 KB
MAX_SPREAD_MS = 5.0             # #38: multi-pod start spread < 5 ms
OFFSET_WINDOW_S = 30.0          # clock offset jitter: residual of a linear fit per window
LOAD_DELAY_WINDOW_S = 60.0      # load delay: relative to the fastest line per window (PC and pod clocks drift)


# ---------------------------------------------------------------- helpers

class CsvLog:
    def __init__(self, path: Path, header: list):
        self.file = open(path, "w", newline="", encoding="utf-8")
        self.writer = csv.writer(self.file)
        self.writer.writerow(header)
        self.lock = threading.Lock()

    def row(self, *values):
        with self.lock:
            self.writer.writerow(values)
            self.file.flush()

    def close(self):
        with self.lock:
            self.file.close()


class Pod:
    """A PodSerial with one request at a time (several threads use the same port)."""

    def __init__(self, port: str, show: str, log_file: str = None):
        self.serial = PodSerial(port, show=show, log_file=log_file)
        self.port = port
        self.lock = threading.Lock()

    def start(self):
        self.serial.start()

    def stop(self):
        self.serial.stop()

    def request(self, op: str, timeout: float = 3.0, **fields):
        with self.lock:
            return self.serial.request(op, timeout=timeout, **fields)

    def try_request(self, op: str, timeout: float = 3.0, **fields):
        try:
            return self.request(op, timeout=timeout, **fields)
        except (TimeoutError, ConnectionError, RuntimeError):
            return None


def percentile(values, p):
    if not values:
        return None
    ordered = sorted(values)
    k = (len(ordered) - 1) * p / 100.0
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def rnd(value, digits=2):
    return None if value is None else round(value, digits)


def offset_jitter_us(samples):
    """Max |residual| of a linear fit (crystal drift) per OFFSET_WINDOW_S window, in µs."""
    worst = None
    if not samples:
        return None
    start = samples[0][0]
    windows = {}
    for t, offset in samples:
        windows.setdefault(int((t - start) // OFFSET_WINDOW_S), []).append((t, offset))
    for points in windows.values():
        if len(points) < 10:
            continue
        n = len(points)
        mt = sum(p[0] for p in points) / n
        mo = sum(p[1] for p in points) / n
        var = sum((p[0] - mt) ** 2 for p in points)
        slope = sum((p[0] - mt) * (p[1] - mo) for p in points) / var if var > 0 else 0.0
        resid = max(abs(p[1] - (mo + slope * (p[0] - mt))) for p in points)
        worst = resid if worst is None else max(worst, resid)
    return worst


# ---------------------------------------------------------------- shared run state

class Run:
    def __init__(self, args, out: Path):
        self.args = args
        self.stop = threading.Event()
        self.t0 = time.time()
        self.lock = threading.Lock()
        self.paused = 0
        self.restarts = []
        self.results = 0
        self.states = []
        self.central_rows = []          # compact central polls (dicts)
        self.link_final = None          # last full status
        self.link_ack_max = {}          # pod -> max ackUsMax seen
        self.peripherals = {}           # port -> {"podId", "offsets": [(t, us)], "last": dict}
        self.ble = {"pings": [], "ping_timeouts": 0, "load_seq_last": None, "load_received": 0,
                    "load_lost": 0, "load_delays": [], "disconnects": [], "connected_s": 0.0}

        prefix = str(out)
        self.events_csv = CsvLog(Path(prefix + "-events.csv"), ["t_s", "kind", "detail"])
        self.central_csv = CsvLog(Path(prefix + "-central.csv"), [
            "t_s", "heap_free", "heap_min", "heap_largest", "ble_on", "ble_connected", "ble_interval_ms",
            "connects", "disconnects", "game_disconnects", "last_disconnect_reason", "param_updates",
            "load_sent", "tx_lines", "tx_dropped", "tx_queued", "tx_wait_us_max", "tx_send_us_avg",
            "tx_send_us_max", "tx_busy_ms", "indicate_ok", "indicate_timeouts", "indicate_failed",
            "loop_gap_us_max", "loop_gaps_2ms", "loop_gaps_10ms"])
        self.links_csv = CsvLog(Path(prefix + "-links.csv"), [
            "t_s", "state", "pod", "alive", "last_seen_ms", "tx_frames", "tx_retries", "tx_lost",
            "rx_frames", "rx_duplicates", "ack_us_last", "ack_us_avg", "ack_us_max"])
        self.periph_csv = CsvLog(Path(prefix + "-peripherals.csv"), [
            "t_s", "port", "pod", "state", "synced", "offset_us", "scheduled_arms", "late_arms",
            "arm_lead_us_min", "starts", "start_late_us_max", "start_late_us_avg", "heap_min"])
        self.ble_csv = CsvLog(Path(prefix + "-ble.csv"), ["t_s", "kind", "seq", "rtt_ms", "delay_ms", "detail"])

    def now(self) -> float:
        return round(time.time() - self.t0, 3)

    def event(self, kind: str, detail=""):
        self.events_csv.row(self.now(), kind, detail)

    def close(self):
        for log in (self.events_csv, self.central_csv, self.links_csv, self.periph_csv, self.ble_csv):
            log.close()


# ---------------------------------------------------------------- USB threads

def central_events(central: Pod, run: Run, press_blocks: set):
    """Simulates the central's presses (trace events) and records state changes."""
    def press():
        if not run.stop.is_set():
            central.try_request("press", timeout=2)

    while not run.stop.is_set():
        try:
            event = central.serial.events.get(timeout=0.5)
        except queue.Empty:
            continue
        kind = event.get("event")
        if kind == "block":
            if event.get("name") in press_blocks and not run.args.manual_press:
                threading.Timer(random.uniform(0.18, 0.35), press).start()
        elif kind == "state":
            state = event.get("state")
            run.event("state", state)
            with run.lock:
                run.states.append((run.now(), state))
                if state == "PAUSED":
                    run.paused += 1
            if state in ("PAUSED", "ERROR"):
                hint(f"central state {state} at {run.now():.0f} s")
        elif kind == "boot":
            reset = event.get("lastReset", {})
            run.event("boot", json.dumps(reset))
            with run.lock:
                run.restarts.append(reset)
            hint(f"the central restarted ({reset}) - the run is not valid")
        elif kind == "result":
            run.event("result", f"pod {event.get('pod')} {event.get('ms')} ms")
            with run.lock:
                run.results += 1


def central_poll(central: Pod, run: Run):
    """1 Hz compact counters (bleTest), every --status-period s the full status (link counters)."""
    next_status = 0.0
    while not run.stop.is_set():
        started = time.time()
        r = central.try_request("bleTest", timeout=3)
        if r:
            heap, ble, t = r.get("heap", {}), r.get("ble", {}), r.get("bleTest", {})
            row = {"t": run.now(), "heap_min": heap.get("minFree"), "heap_free": heap.get("free"),
                   "ble_connected": ble.get("connected"), "ble_interval_ms": ble.get("intervalMs"), **t}
            with run.lock:
                run.central_rows.append(row)
            run.central_csv.row(run.now(), heap.get("free"), heap.get("minFree"), heap.get("largest"),
                                ble.get("on"), ble.get("connected"), ble.get("intervalMs"),
                                t.get("connects"), t.get("disconnects"), t.get("gameDisconnects"),
                                t.get("lastDisconnectReason"), t.get("paramUpdates"), t.get("loadSent"),
                                t.get("txLines"), t.get("txDropped"), t.get("txQueued"), t.get("txWaitUsMax"),
                                t.get("txSendUsAvg"), t.get("txSendUsMax"), t.get("txBusyMs"),
                                t.get("indicateOk"), t.get("indicateTimeouts"), t.get("indicateFailed"),
                                t.get("loopGapUsMax"), t.get("loopGaps2ms"), t.get("loopGaps10ms"))
        if time.time() >= next_status:
            next_status = time.time() + run.args.status_period
            status = central.try_request("status", timeout=3)
            if status:
                record_links(run, status)
        run.stop.wait(max(0.05, run.args.poll_period - (time.time() - started)))


def record_links(run: Run, status: dict):
    with run.lock:
        run.link_final = status
    for pod in status.get("pods", []):
        link = pod.get("link", {})
        pod_id = pod.get("id")
        with run.lock:
            run.link_ack_max[pod_id] = max(run.link_ack_max.get(pod_id, 0), link.get("ackUsMax", 0))
        run.links_csv.row(run.now(), status.get("state"), pod_id, pod.get("alive"), pod.get("lastSeenMs"),
                          link.get("txFrames"), link.get("txRetries"), link.get("txLost"), link.get("rxFrames"),
                          link.get("rxDuplicates"), link.get("ackUsLast"), link.get("ackUsAvg"), link.get("ackUsMax"))


def peripheral_poll(pod: Pod, run: Run):
    """Presses the peripheral when it lights up; records clock offset and start counters."""
    info = run.peripherals[pod.port]
    last_row = 0.0
    pressed_at = 0.0
    while not run.stop.is_set():
        r = pod.try_request("bleTest", timeout=2)
        now = time.time()
        if r:
            info["last"] = r
            if r.get("synced"):
                info["offsets"].append((now, r.get("offsetUs", 0)))
            if r.get("state") == "ACTIVE" and not run.args.manual_press and now - pressed_at > 1.0:
                time.sleep(random.uniform(0.2, 0.4))
                pod.try_request("press", timeout=2)
                pressed_at = time.time()
            if now - last_row >= 1.0:
                last_row = now
                t = r.get("bleTest", {})
                run.periph_csv.row(run.now(), pod.port, info.get("podId"), r.get("state"), r.get("synced"),
                                   r.get("offsetUs"), t.get("scheduledArms"), t.get("lateArms"),
                                   t.get("armLeadUsMin"), t.get("starts"), t.get("startLateUsMax"),
                                   t.get("startLateUsAvg"), r.get("heap", {}).get("minFree"))
        run.stop.wait(run.args.peripheral_poll)


# ---------------------------------------------------------------- BLE (mode phone)

class BleSide:
    def __init__(self, run: Run, set_id: str):
        import reactpod_config as rc        # needs bleak; only imported in mode phone
        from bleak import BleakClient, BleakScanner
        self.rc = rc
        self.BleakClient = BleakClient
        self.BleakScanner = BleakScanner
        self.run = run
        self.set_id = set_id
        self.client = None
        self.connected = False
        self.connected_since = None
        self.disconnected_at = None
        self.buffer = bytearray()
        self.responses = asyncio.Queue()
        self.next_id = 1
        self.mtu = 23
        self.loop = None

    async def connect(self, timeout: float = 15.0) -> bool:
        self.loop = asyncio.get_running_loop()
        device = await self.BleakScanner.find_device_by_filter(
            lambda d, adv: self.rc.is_reactpod(adv) and self.rc.set_id_of(adv) == self.set_id, timeout=timeout)
        if device is None:
            return False
        client = self.BleakClient(device, disconnected_callback=self._on_disconnect)
        try:
            await client.connect()
            await client.start_notify(self.rc.RESPONSE_UUID, self._on_data)
        except Exception as e:      # bleak raises backend-specific errors
            self.run.ble_csv.row(self.run.now(), "connect_failed", "", "", "", str(e))
            try:
                await client.disconnect()
            except Exception:
                pass
            return False
        self.client = client
        self.buffer = bytearray()
        self.connected = True
        self.connected_since = time.time()
        self.mtu = client.mtu_size or 23
        try:
            info = await self.request("info", timeout=5)
            self.mtu = info.get("mtu") or self.mtu
        except (asyncio.TimeoutError, RuntimeError):
            pass
        downtime = "" if self.disconnected_at is None else round(time.time() - self.disconnected_at, 2)
        self.run.ble_csv.row(self.run.now(), "connect", "", "", "", f"mtu {self.mtu} downtime_s {downtime}")
        self.run.event("ble_connect", f"mtu {self.mtu}")
        return True

    def _on_disconnect(self, _client):
        if not self.connected:
            return
        self.connected = False
        self.disconnected_at = time.time()
        if self.connected_since:
            self.run.ble["connected_s"] += self.disconnected_at - self.connected_since
        self.run.ble["disconnects"].append(self.run.now())
        self.run.ble_csv.row(self.run.now(), "disconnect", "", "", "", "")
        self.run.event("ble_disconnect")
        hint(f"BLE disconnected at {self.run.now():.0f} s - reconnecting")

    def _on_data(self, _sender, data: bytearray):
        arrived = time.time()
        self.buffer.extend(data)
        while b"\n" in self.buffer:
            line, _, rest = self.buffer.partition(b"\n")
            self.buffer = bytearray(rest)
            if not line:
                continue
            try:
                obj = json.loads(line.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self.run.ble_csv.row(self.run.now(), "bad_line", "", "", "", len(line))
                continue
            if obj.get("event") == "load":
                self._on_load(obj, arrived, len(line) + 1)
            elif "op" in obj:
                self.responses.put_nowait((obj, arrived))

    def _on_load(self, obj: dict, arrived: float, size: int):
        ble = self.run.ble
        seq = obj.get("seq", 0)
        last = ble["load_seq_last"]
        if last is not None and seq > last + 1:
            ble["load_lost"] += seq - last - 1
            self.run.ble_csv.row(self.run.now(), "load_gap", seq, "", "", f"{seq - last - 1} lines missing")
        ble["load_seq_last"] = seq
        ble["load_received"] += 1
        # one-way delay up to an unknown constant (PC clock - pod clock); made relative in the summary
        raw = arrived * 1000.0 - obj.get("t", 0)
        ble["load_delays"].append((arrived, raw))
        self.run.ble_csv.row(self.run.now(), "load", seq, "", round(raw, 1), size)

    async def request(self, op: str, timeout: float = 5.0, **fields):
        request_id = self.next_id
        self.next_id += 1
        payload = (json.dumps({"op": op, "id": request_id, **fields}) + "\n").encode("utf-8")
        chunk = max(20, self.mtu - 3)
        sent = time.time()
        for pos in range(0, len(payload), chunk):
            await self.client.write_gatt_char(self.rc.COMMAND_UUID, payload[pos:pos + chunk], response=True)
        deadline = sent + timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                raise asyncio.TimeoutError()
            response, arrived = await asyncio.wait_for(self.responses.get(), timeout=remaining)
            if response.get("id") == request_id:
                if not response.get("ok"):
                    raise RuntimeError(f"{op}: {response.get('error')}: {response.get('message')}")
                response["_rtt_ms"] = (arrived - sent) * 1000.0
                return response

    async def ping_loop(self):
        while not self.run.stop.is_set():
            if self.connected:
                try:
                    r = await self.request("bleTest", timeout=5, brief=True)
                    rtt = r["_rtt_ms"]
                    self.run.ble["pings"].append(rtt)
                    self.run.ble_csv.row(self.run.now(), "ping", "", round(rtt, 1), "", "")
                except asyncio.TimeoutError:
                    self.run.ble["ping_timeouts"] += 1
                    self.run.ble_csv.row(self.run.now(), "ping_timeout", "", "", "", "")
                except Exception as e:  # write failed: usually a disconnect in progress
                    self.run.ble_csv.row(self.run.now(), "ping_error", "", "", "", str(e))
            else:
                if await self.connect(timeout=5):
                    say(color(f"   BLE reconnected after {time.time() - self.disconnected_at:.1f} s", "1;32"))
            await asyncio.sleep(self.run.args.ping_period)

    async def close(self):
        if self.connected and self.connected_since:
            self.run.ble["connected_s"] += time.time() - self.connected_since
        self.connected = False
        if self.client:
            try:
                await self.client.disconnect()
            except Exception:
                pass


# ---------------------------------------------------------------- summary

def summarize(run: Run, args, program: dict, duration_s: float, final_central: dict, finals: dict) -> dict:
    checks = []

    def check(name, passed, value, criterion):
        checks.append({"check": name, "pass": passed, "value": value, "criterion": criterion})

    status = run.link_final or {}
    pods = status.get("pods", [])
    tx_lost = sum(p.get("link", {}).get("txLost", 0) for p in pods)
    tx_retries = sum(p.get("link", {}).get("txRetries", 0) for p in pods)
    tx_frames = sum(p.get("link", {}).get("txFrames", 0) for p in pods)
    links = [{"pod": p.get("id"), **p.get("link", {}), "ackUsMaxSeen": run.link_ack_max.get(p.get("id"))} for p in pods]

    heap_min = (final_central.get("heap") or {}).get("minFree")
    t = final_central.get("bleTest", {})

    periph = []
    late_arms = 0
    start_late_max = 0
    jitter_max = 0.0
    for port, info in run.peripherals.items():
        last = info.get("last") or {}
        bt = (finals.get(port) or last).get("bleTest", {})
        jitter = offset_jitter_us(info["offsets"])
        late_arms += bt.get("lateArms", 0) or 0
        start_late_max = max(start_late_max, bt.get("startLateUsMax", 0) or 0)
        jitter_max = max(jitter_max, jitter or 0.0)
        periph.append({"port": port, "pod": info.get("podId"), "offsetJitterUs": rnd(jitter, 1),
                       "offsetSamples": len(info["offsets"]), **bt})
    # rough upper bound of the start spread: two pods with opposite clock errors, plus the
    # latest LED start; the central's own LED is late by at most one loop gap
    spread_ms = (2 * jitter_max + max(start_late_max, t.get("loopGapUsMax", 0) or 0)) / 1000.0

    ble = run.ble
    delays = []
    if ble["load_delays"]:
        start = ble["load_delays"][0][0]
        windows = {}
        for arrived, raw in ble["load_delays"]:
            windows.setdefault(int((arrived - start) // LOAD_DELAY_WINDOW_S), []).append(raw)
        for values in windows.values():
            base = min(values)
            delays.extend(v - base for v in values)

    summary = {
        "program": program.get("path"), "mode": args.mode, "durationS": round(duration_s, 1),
        "peripherals": len(run.peripherals), "results": run.results, "paused": run.paused,
        "restarts": run.restarts,
        "espnow": {"txFrames": tx_frames, "txRetries": tx_retries, "txLost": tx_lost, "pods": links},
        "heap": final_central.get("heap"),
        "central": {k: t.get(k) for k in ("loopGapUsMax", "loopGaps2ms", "loopGaps10ms", "txLines", "txDropped",
                                           "txWaitUsMax", "txSendUsAvg", "txSendUsMax", "indicateOk",
                                           "indicateTimeouts", "indicateFailed", "connects", "disconnects",
                                           "gameDisconnects", "lastDisconnectReason", "paramUpdates",
                                           "paramRejects", "loadSent")},
        "ble": final_central.get("ble"),
        "peripheralClock": periph,
        "startSpreadEstimateMs": rnd(spread_ms, 2),
    }
    if args.mode == "phone":
        pings = ble["pings"]
        summary["bleClient"] = {
            "disconnects": len(ble["disconnects"]), "disconnectTimesS": ble["disconnects"],
            "disconnectsBeforeStart": len(ble.get("disconnects_before_start", [])),
            "connectedShare": rnd(ble["connected_s"] / duration_s if duration_s else None, 4),
            "pings": len(pings), "pingTimeouts": ble["ping_timeouts"],
            "rttMsAvg": rnd(statistics.mean(pings) if pings else None, 1),
            "rttMsP50": rnd(percentile(pings, 50), 1), "rttMsP95": rnd(percentile(pings, 95), 1),
            "rttMsMax": rnd(max(pings) if pings else None, 1),
            "loadReceived": ble["load_received"], "loadLost": ble["load_lost"],
            "loadDelayMsP95": rnd(percentile(delays, 95), 1), "loadDelayMsMax": rnd(max(delays) if delays else None, 1),
        }

    # acceptance criteria of #38
    check("txLost = 0", tx_lost == 0, tx_lost, "0 over the whole run")
    check("min free heap > 40 KB", heap_min is not None and heap_min > MIN_FREE_HEAP, heap_min, f"> {MIN_FREE_HEAP}")
    check("no PAUSED", run.paused == 0, run.paused, "0 (with the phone connected: none caused by the phone)")
    scheduled = sum((p.get("scheduledArms") or 0) for p in periph)
    if scheduled > 0:
        check("start spread < 5 ms (estimate)", spread_ms < MAX_SPREAD_MS, rnd(spread_ms, 2),
              "< 5 ms; confirm with the logic analyser (testing.md §8.5)")
        check("no late ARM", late_arms == 0, f"{late_arms} of {scheduled}", "every scheduled ARM arrives before its start time")
    else:
        summary["startSpreadEstimateMs"] = None
        check("start spread < 5 ms (estimate)", True, "n/a", "only for programs with a synchronous start (remoteMultiPress)")
    check("no restart", not run.restarts, len(run.restarts), "0")
    if args.mode == "phone":
        before = len(ble.get("disconnects_before_start", []))
        check("BLE stayed connected", len(ble["disconnects"]) == 0 and before == 0,
              f"{len(ble['disconnects'])} in the game, {before} at select / discovery", "0 disconnects")
        check("no load line lost", ble["load_lost"] == 0 and (t.get("txDropped") or 0) == 0,
              f"{ble['load_lost']} lost, {t.get('txDropped')} dropped", "0")
    summary["checks"] = checks
    summary["passed"] = all(c["pass"] for c in checks)
    return summary


def print_summary(summary: dict):
    say(color(f"\n== Summary: {summary['program']}, mode {summary['mode']}, {summary['durationS'] / 60:.1f} min", "1"))
    e = summary["espnow"]
    say(f"   ESP-NOW: {e['txFrames']} frames, {e['txRetries']} retries, {e['txLost']} lost")
    for p in e["pods"]:
        say(f"     pod {p['pod']}: retries {p.get('txRetries')} lost {p.get('txLost')} "
            f"ack avg {p.get('ackUsAvg')} us max {p.get('ackUsMaxSeen')} us")
    heap = summary.get("heap") or {}
    say(f"   heap: free {heap.get('free')} B, min free {heap.get('minFree')} B, largest block {heap.get('largest')} B")
    c = summary["central"]
    say(f"   central loop: max gap {c.get('loopGapUsMax')} us, gaps > 2 ms {c.get('loopGaps2ms')}, > 10 ms {c.get('loopGaps10ms')}")
    ble = summary.get("ble") or {}
    say(f"   BLE on pod: on {ble.get('on')}, connected {ble.get('connected')}, interval {ble.get('intervalMs')} ms, latency {ble.get('latency')}, "
        f"indications ok {c.get('indicateOk')} timeouts {c.get('indicateTimeouts')}, lines {c.get('txLines')} "
        f"dropped {c.get('txDropped')}, send max {c.get('txSendUsMax')} us")
    for p in summary["peripheralClock"]:
        say(f"   peripheral {p['port']} (pod {p['pod']}): offset jitter {p['offsetJitterUs']} us, "
            f"late ARMs {p.get('lateArms')}/{p.get('scheduledArms')}, ARM lead min {p.get('armLeadUsMin')} us, "
            f"start late max {p.get('startLateUsMax')} us")
    say(f"   start spread estimate: {summary['startSpreadEstimateMs']} ms; PAUSED {summary['paused']}; results {summary['results']}")
    b = summary.get("bleClient")
    if b:
        say(f"   BLE client: disconnects {b['disconnects']}, connected {b['connectedShare']}, pings {b['pings']} "
            f"(timeouts {b['pingTimeouts']}), rtt avg {b['rttMsAvg']} p95 {b['rttMsP95']} max {b['rttMsMax']} ms, "
            f"load {b['loadReceived']} received / {b['loadLost']} lost, delay p95 {b['loadDelayMsP95']} max {b['loadDelayMsMax']} ms")
    say("")
    for ch in summary["checks"]:
        mark = color("PASS", "1;32") if ch["pass"] else color("FAIL", "1;31")
        say(f"   {mark}  {ch['check']}: {ch['value']}  ({ch['criterion']})")
    say(color("== " + ("ALL PASSED" if summary["passed"] else "FAILED"), "1"))


# ---------------------------------------------------------------- main

def wait_state(central: Pod, states: tuple, timeout: float):
    deadline = time.time() + timeout
    while time.time() < deadline:
        s = central.try_request("status", timeout=3)
        if s and s.get("state") in states:
            return s
        time.sleep(1.0)
    return None


async def main_async(args) -> int:
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    central = Pod(args.port, show="events", log_file=args.log)
    central.start()
    peripherals = [Pod(p, show="none", log_file=(args.log + "." + Path(p).name) if args.log else None)
                   for p in args.peripheral_port]
    for p in peripherals:
        p.start()

    say(color(f"== BLE + ESP-NOW test (#38): {args.program}, mode {args.mode}, {args.minutes} min", "1"))
    status = await asyncio.to_thread(central.serial.wait_ready, timeout=120, reason="on the serial port")
    if status is None:
        hint(f"The central on {args.port} does not answer.")
        return 2
    if status.get("role") != "central" or status.get("state") != "MENU":
        say("   restarting the central into the program menu ...")
        status = await asyncio.to_thread(central.serial.reboot, "central", 120)
        if status is None or status.get("state") != "MENU":
            hint("The central is not in the program menu.")
            return 2
    if status.get("testBuild") != TEST_BUILD:
        hint("The central does not run the test firmware. Flash it: "
             "pio run -d firmware -e BleEspNowTest -t upload --upload-port " + args.port)
        return 2

    run = Run(args, out)
    try:
        for p in peripherals:
            s = await asyncio.to_thread(p.serial.wait_ready, timeout=60, reason="on the serial port")
            if s is None or s.get("role") != "peripheral":
                hint(f"{p.port} is not a peripheral (role {s.get('role') if s else 'no answer'}). "
                     "Restart it without holding the button.")
                return 2
            if s.get("testBuild") != TEST_BUILD:
                hint(f"{p.port} does not run the test firmware (pio env BleEspNowTest).")
                return 2
            run.peripherals[p.port] = {"podId": s.get("podId"), "offsets": [], "last": None}

        programs = central.request("programs")["programs"]
        match = [p for p in programs if args.program in (p["path"], p["name"], str(p["index"]))]
        if not match:
            hint("Program not found. Found: " + ", ".join(p["path"] for p in programs))
            return 2
        program = match[0]
        if len(peripherals) < program["peripherals"] and not args.manual_press:
            hint(f"'{program['name']}' needs {program['peripherals']} peripherals; only {len(peripherals)} on USB. "
                 "The others must be pressed by hand (--manual-press) or the game waits.")

        central.request("bleTest", keepBle=args.mode != "off", intervalMs=args.interval_ms,
                        latency=args.latency,
                        loadBytes=args.load_bytes, loadPeriodMs=args.load_period_ms if args.mode != "off" else 0)

        ble = None
        if args.mode == "phone":
            ble = BleSide(run, status.get("setId"))
            say(f"   connecting over BLE to set {status.get('setId')} ...")
            if not await ble.connect():
                hint("No BLE connection. Is the central advertising (program menu)? Is Bluetooth on?")
                return 2
            r = await ble.request("bleTest", brief=True)
            say(f"   BLE connected, MTU {ble.mtu}, first ping {r['_rtt_ms']:.0f} ms")

        say(f"   selecting {program['path']}; switch the {program['peripherals']} peripheral(s) on (yellow) ...")
        central.request("trace", on=True)
        central.serial.drain_events()
        central.request("select", timeout=10, program=program["path"])
        run.event("select", program["path"])
        threads = [threading.Thread(target=central_events, args=(central, run, set(args.press_blocks.split(","))), daemon=True)]
        threads[0].start()
        ping_task = asyncio.create_task(ble.ping_loop()) if ble else None   # BLE kept through select?
        if not await asyncio.to_thread(wait_state, central, ("CONFIRM",), args.discovery_timeout):
            hint("The peripherals did not connect (CONFIRM not reached).")
            return 1
        polls = [threading.Thread(target=central_poll, args=(central, run), daemon=True)]
        polls += [threading.Thread(target=peripheral_poll, args=(p, run), daemon=True) for p in peripherals]
        for th in polls:
            th.start()
        threads += polls
        central.request("start")
        if not await asyncio.to_thread(wait_state, central, ("RUN",), 10):
            hint("The program did not start.")
            return 1
        await asyncio.sleep(2.0)    # first rounds (radio start, first indications), then count from zero
        central.request("bleTest", reset=True)
        for p in peripherals:
            p.request("bleTest", reset=True)
        measure_start = time.time()
        if ble:
            # BLE numbers count from here; disconnects during select / discovery are kept apart
            run.ble["disconnects_before_start"] = list(run.ble["disconnects"])
            run.ble.update(pings=[], ping_timeouts=0, load_received=0, load_lost=0, load_delays=[],
                           disconnects=[], connected_s=0.0)
            if ble.connected:
                ble.connected_since = measure_start
        run.event("measure_start", program["path"])
        say(color(f"   running for {args.minutes} min (Ctrl+C ends early) ...", "1;32"))

        end = measure_start + args.minutes * 60
        next_report = time.time() + 60
        try:
            while time.time() < end:
                await asyncio.sleep(1.0)
                if time.time() >= next_report:
                    next_report += 60
                    rows = run.central_rows[-1:] or [{}]
                    say(f"   {(time.time() - measure_start) / 60:.0f} min: heap min {rows[0].get('heap_min')} B, PAUSED {run.paused}, "
                        f"results {run.results}" + (f", BLE pings {len(run.ble['pings'])}, disconnects "
                                                     f"{len(run.ble['disconnects'])}" if ble else ""))
        except (KeyboardInterrupt, asyncio.CancelledError):
            say("   stopped early")
        duration = time.time() - measure_start

        run.stop.set()
        if ping_task:
            ping_task.cancel()
            try:
                await ping_task
            except (asyncio.CancelledError, Exception):
                pass
        for th in threads:
            th.join(timeout=5)

        final = central.try_request("status", timeout=5)
        if final:
            record_links(run, final)
        final_central = central.try_request("bleTest", timeout=5) or {}
        finals = {p.port: p.try_request("bleTest", timeout=3) for p in peripherals}
        if ble:
            await ble.close()

        summary = summarize(run, args, program, duration, final_central, finals)
        Path(str(out) + "-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print_summary(summary)
        say(f"   files: {out}-*.csv, {out}-summary.json")

        central.try_request("trace", on=False)
        if not args.keep_running:
            central.try_request("stop")
        return 0 if summary["passed"] else 1
    finally:
        run.stop.set()
        run.close()
        central.stop()
        for p in peripherals:
            p.stop()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", required=True, help="central's serial port, e.g. COM4")
    parser.add_argument("--peripheral-port", action="append", default=[], help="a peripheral's serial port (repeat)")
    parser.add_argument("--program", default="/prog/dreieck.json", help="index, path or name")
    parser.add_argument("--mode", choices=["off", "advertise", "phone"], default="phone")
    parser.add_argument("--minutes", type=float, default=30)
    parser.add_argument("--out", default="ble-espnow", help="prefix of the output files")
    parser.add_argument("--latency", type=int, default=0,
                        help="peripheral latency the central requests with the interval: connection events it may skip (0 = none)")
    parser.add_argument("--interval-ms", type=int, default=75, help="connection interval the central requests in the game (0 = none)")
    parser.add_argument("--load-bytes", type=int, default=1024, help="size of one load line")
    parser.add_argument("--load-period-ms", type=int, default=2000,
                        help="one load line per period while a client is connected (0 = none)")
    parser.add_argument("--ping-period", type=float, default=1.0, help="s between BLE pings")
    parser.add_argument("--poll-period", type=float, default=1.0, help="s between compact central polls")
    parser.add_argument("--status-period", type=float, default=10.0, help="s between full central status polls")
    parser.add_argument("--peripheral-poll", type=float, default=0.15, help="s between peripheral polls")
    parser.add_argument("--press-blocks", default="CentralPress,ActivateAll",
                        help="blocks that wait for the central's press (comma list)")
    parser.add_argument("--manual-press", action="store_true", help="do not simulate presses")
    parser.add_argument("--discovery-timeout", type=float, default=90)
    parser.add_argument("--keep-running", action="store_true", help="leave the program running afterwards")
    parser.add_argument("--log", metavar="FILE", help="raw serial log of the central (peripherals: FILE.<port>)")
    args = parser.parse_args()
    try:
        sys.exit(asyncio.run(main_async(args)))
    except KeyboardInterrupt:
        sys.exit(130)
    except (TimeoutError, RuntimeError, ConnectionError) as e:
        hint(f"aborted: {e}")
        sys.exit(2)


if __name__ == "__main__":
    main()
