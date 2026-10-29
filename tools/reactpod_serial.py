#!/usr/bin/env python3
"""
Set up, monitor and test ReactPods over the USB serial port (docs/firmware/testing.md).

Requires: pip install pyserial

    python tools/reactpod_serial.py wait-boot             # after flashing: wait for the pod, tell you when to reset it
    python tools/reactpod_serial.py monitor               # live log + events, type commands (e.g. "status")
    python tools/reactpod_serial.py status
    python tools/reactpod_serial.py reboot central
    python tools/reactpod_serial.py select /prog/duo.json
    python tools/reactpod_serial.py start
    python tools/reactpod_serial.py set-name "Halle 2"    # BLE name "ReactPod Halle 2" ("" = default)
    python tools/reactpod_serial.py set-pin 1234          # PIN for BLE writes ("" = clear it)
    python tools/reactpod_serial.py reports               # reports not acknowledged yet (firmware >= 2.11)
    python tools/reactpod_serial.py ack 17                # remove report 17 and the older ones
    python tools/reactpod_serial.py command continue      # answer a waiting communicate block
    python tools/reactpod_serial.py set-variables MAX_LOOPS=5 RUNS=0
    python tools/reactpod_serial.py session ath_42        # athlete id for the following reports ("" = clear)
    python tools/reactpod_serial.py pause                 # pause a running game from the phone (firmware >= 2.12)
    python tools/reactpod_serial.py resume                # end the phone pause
    python tools/reactpod_serial.py blink 2               # find pod 3 (its number minus 1); no id = the central (firmware >= 2.13)
    python tools/reactpod_serial.py push firmware/data
    python tools/reactpod_serial.py test --program /prog/duo.json

--port is optional; without it the first Espressif USB port (VID 303A) is used.
--log FILE writes everything received to a file (with timestamps).

The pod never resets itself when the port is opened. After flashing, an ESP32-C3 often
stays in download mode until its RESET button is pressed or it is switched off and on;
the tools detect that and tell you what to do.
"""
import argparse
import json
import os
import queue
import random
import re
import sys
import threading
import time
import zlib
from pathlib import Path

import serial
import serial.tools.list_ports

from reactpod_format import report_line

PUT_CHUNK = 2048
ESPRESSIF_VID = 0x303A
ANSI = re.compile(r"\x1b\[[0-9;]*m")

USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None
if os.name == "nt":
    os.system("")   # enables ANSI escape codes in the Windows console


def color(text: str, code: str) -> str:
    return f"\x1b[{code}m{text}\x1b[0m" if USE_COLOR else text


def say(text: str = ""):
    print(text, flush=True)


def hint(text: str):
    print(color(">>> " + text, "1;33"), flush=True)


def find_port() -> str:
    for p in serial.tools.list_ports.comports():
        if p.vid == ESPRESSIF_VID:
            return p.device
    return None


def ask(prompt: str, interactive: bool):
    """Wait for Enter (interactive) or continue right away (non-interactive)."""
    if not interactive:
        return
    try:
        input(color(prompt + " [Enter]", "1;36"))
    except EOFError:
        pass


class PodSerial:
    """
    One pod on a serial port. The reader thread reopens the port automatically if it
    disappears (reboot, unplugged). Responses are matched to requests by "id".
    """

    def __init__(self, port: str, show: str = "events", log_file: str = None):
        self.port = port
        self.show = show            # "all" = log + events, "events" = events only, "none"
        self.ser = None
        self.connected = threading.Event()
        self.next_id = 1
        self.responses = queue.Queue()
        self.events = queue.Queue()
        self.running = False
        self.write_lock = threading.Lock()
        self.log = open(log_file, "a", encoding="utf-8") if log_file else None
        self.download_mode = False
        self.last_boot = None

    # ------------------------------------------------------------ connection
    def start(self):
        self.running = True
        threading.Thread(target=self._read_loop, daemon=True).start()

    def stop(self):
        self.running = False
        time.sleep(0.3)
        self._close()
        if self.log:
            self.log.close()

    def _open(self) -> bool:
        try:
            ser = serial.Serial()
            ser.port = self.port
            ser.baudrate = 115200
            ser.timeout = 0.1
            # keep DTR/RTS released: toggling them resets the ESP32-C3 (possibly into download mode)
            ser.dtr = False
            ser.rts = False
            ser.open()
        except (serial.SerialException, OSError):
            return False
        self.ser = ser
        self.connected.set()
        return True

    def _close(self):
        self.connected.clear()
        if self.ser:
            try:
                self.ser.close()
            except (serial.SerialException, OSError):
                pass
        self.ser = None

    def _read_loop(self):
        buffer = b""
        lost_reported = False
        while self.running:
            if self.ser is None:
                if self._open():
                    if lost_reported:
                        self._status(f"[{self.port} is back]")
                    lost_reported = False
                else:
                    if not lost_reported:
                        self._status(f"[{self.port} not available - waiting for the pod ...]")
                        lost_reported = True
                    time.sleep(0.5)
                continue
            try:
                chunk = self.ser.read(1024)
            except (serial.SerialException, OSError):
                self._close()
                continue
            if not chunk:
                continue
            buffer += chunk
            while b"\n" in buffer:
                raw, buffer = buffer.split(b"\n", 1)
                self._handle_line(raw.decode("utf-8", errors="replace").rstrip("\r"))

    def _status(self, text: str):
        if self.show != "none":
            say(color(text, "2"))

    def _handle_line(self, line: str):
        clean = ANSI.sub("", line).strip()
        if self.log:
            self.log.write(f"{time.strftime('%H:%M:%S')} {clean}\n")
            self.log.flush()
        if not clean:
            return

        if "waiting for download" in clean:
            self.download_mode = True
            if self.show != "none":
                say(clean)
            hint("The pod is in DOWNLOAD MODE (normal right after flashing). "
                 "Press its RESET button or switch it off and on.")
            return
        if clean.startswith("rst:") or clean.startswith("ESP-ROM"):
            self.download_mode = False
            if self.show != "none":
                say(color(clean, "2"))
            return

        if clean.startswith("{"):
            try:
                obj = json.loads(clean)
            except json.JSONDecodeError:
                obj = None
            if isinstance(obj, dict):
                if "event" in obj:
                    self._handle_event(obj)
                    return
                if "op" in obj:
                    self.responses.put(obj)
                    return

        if clean.startswith("RESULT,"):
            parts = clean.split(",")
            if len(parts) == 5:
                self.events.put({"event": "result", "t": int(parts[1]), "metric": parts[2],
                                 "pod": int(parts[3]), "ms": int(parts[4])})
        elif clean.startswith("SUMMARY,"):
            parts = clean.split(",")
            if len(parts) == 6:
                self.events.put({"event": "summary", "metric": parts[1], "count": int(parts[2]),
                                 "average": int(parts[3]), "best": int(parts[4]), "worst": int(parts[5])})
        if self.show == "all":
            say(color(clean, "2") if clean[:2] in ("I ", "D ", "V ") else clean)

    def _handle_event(self, event: dict):
        kind = event.get("event")
        if kind == "boot":
            self.download_mode = False
            self.last_boot = event
            reset = event.get("lastReset", {})
            text = f"[boot] {event.get('role')} firmware {event.get('firmware')}, last reset: {reset.get('reason')}"
            if reset.get("reason") in ("panic", "task-watchdog", "interrupt-watchdog", "watchdog", "brownout"):
                say(color(text + f" during step '{reset.get('lastStep')}'", "1;31"))
                hint("The pod restarted after a crash. Please note the step above.")
            elif self.show != "none":
                say(color(text, "1;32"))
        elif kind == "state" and self.show != "none":
            phone = "  (paused by phone)" if event.get("phonePaused") else ""
            say(color(f"[state] {event.get('state')}  pods {event.get('pods')}/{event.get('required')}"
                      f"  {event.get('program', '')}{phone}", "1;34"))
        elif kind == "block" and self.show == "all":
            say(color(f"[block] {event.get('name')}", "2"))
        elif kind == "report" and self.show != "none":
            say(color(report_line(event), "1;35"))
        self.events.put(event)

    # ------------------------------------------------------------ requests
    def send(self, request: dict, wait_connected: float = 10.0):
        if not self.connected.wait(wait_connected):
            raise ConnectionError(f"{self.port} is not available")
        data = (json.dumps(request, ensure_ascii=False) + "\n").encode("utf-8")
        with self.write_lock:
            try:
                self.ser.write(data)
                self.ser.flush()
            except (serial.SerialException, OSError, AttributeError) as e:
                raise ConnectionError(str(e))

    def send_text(self, text: str):
        if not self.connected.wait(5):
            raise ConnectionError(f"{self.port} is not available")
        with self.write_lock:
            self.ser.write((text + "\n").encode("utf-8"))

    def request(self, op: str, timeout: float = 5.0, check: bool = True, **fields) -> dict:
        request_id = self.next_id
        self.next_id += 1
        self.send({"op": op, "id": request_id, **fields})
        deadline = time.time() + timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                raise TimeoutError(f"no answer to '{op}' within {timeout:.0f} s")
            try:
                response = self.responses.get(timeout=remaining)
            except queue.Empty:
                continue
            if response.get("id") != request_id:
                continue    # answer to an earlier request
            if check and not response.get("ok"):
                raise RuntimeError(f"{op} failed: {response.get('error')}: {response.get('message')}")
            return response

    def try_status(self, timeout: float = 2.0):
        try:
            return self.request("status", timeout=timeout)
        except (TimeoutError, ConnectionError, RuntimeError):
            return None

    def wait_event(self, predicate, timeout: float):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                event = self.events.get(timeout=min(0.5, max(0.05, deadline - time.time())))
            except queue.Empty:
                continue
            if predicate(event):
                return event
        return None

    def drain_events(self):
        while not self.events.empty():
            self.events.get_nowait()

    # ------------------------------------------------------------ human-guided waiting
    def wait_ready(self, want=lambda s: True, timeout: float = 120, prompt_after: float = 6,
                   reason: str = "") -> dict:
        """
        Polls 'status' until it answers and want(status) is true. If nothing happens for
        prompt_after seconds, tells the user to reset the pod (once, repeated every 30 s).
        """
        start = time.time()
        next_hint = start + prompt_after
        while time.time() - start < timeout:
            status = self.try_status()
            if status is not None and want(status):
                return status
            if time.time() >= next_hint:
                if self.download_mode:
                    hint("The pod is still in download mode: press RESET (not BOOT) or switch it off and on.")
                elif status is None:
                    hint(f"The pod does not answer{(' ' + reason) if reason else ''}. "
                         "Press its RESET button or switch it off and on. Waiting ...")
                else:
                    hint(f"Still waiting{(' ' + reason) if reason else ''} "
                         f"(role {status.get('role')}, state {status.get('state')}).")
                next_hint = time.time() + 30
            time.sleep(1.0)
        return None

    def reboot(self, role: str = "auto", timeout: float = 120) -> dict:
        """Asks the pod to restart in a role; guides the user if it does not come back."""
        self.drain_events()
        self.last_boot = None
        try:
            self.request("reboot", timeout=3, role=role)
        except (TimeoutError, ConnectionError, RuntimeError):
            pass
        boot = self.wait_event(lambda e: e.get("event") == "boot", 10)
        if boot is None:
            hint("The pod did not restart by itself. Press its RESET button or switch it off and on "
                 "(the requested role is stored and used at the next start).")
        want = (lambda s: True) if role == "auto" else (lambda s: s.get("role") == role)
        return self.wait_ready(want, timeout, prompt_after=15, reason=f"after the restart as {role}")

    # ------------------------------------------------------------ files
    def put_file(self, path: str, text: str) -> dict:
        crc = format(zlib.crc32(text.encode("utf-8")) & 0xFFFFFFFF, "08x")
        offset = 0
        chunks = [text[i:i + PUT_CHUNK] for i in range(0, len(text), PUT_CHUNK)] or [""]
        response = None
        for index, part in enumerate(chunks):
            final = index == len(chunks) - 1
            fields = {"path": path, "offset": offset, "data": part, "final": final}
            if final:
                fields["crc"] = crc
            response = self.request("put", timeout=10, **fields)
            offset += len(part.encode("utf-8"))
        return response

    def get_file(self, path: str) -> str:
        parts, offset = [], 0
        while True:
            r = self.request("get", path=path, offset=offset, length=2048)
            parts.append(r["data"])
            offset += len(r["data"].encode("utf-8"))
            if r["eof"]:
                return "".join(parts)


# ---------------------------------------------------------------- helpers

def store_path(data_dir: Path, file: Path) -> str:
    return "/" + file.relative_to(data_dir).as_posix()


def push(pod: PodSerial, directory: str):
    data_dir = Path(directory)
    files = sorted(f for f in data_dir.rglob("*.json") if store_path(data_dir, f) != "/programs.json")
    index = data_dir / "programs.json"
    if index.exists():
        files.append(index)     # menu last, so it never points to missing files
    for f in files:
        r = pod.put_file(store_path(data_dir, f), f.read_text(encoding="utf-8"))
        say(f"  {r['path']}: {r['size']} bytes, crc {r['crc']}")


def print_pods(status: dict):
    pods = status.get("pods", [])
    if not pods:
        say("  (no peripherals connected)")
        return
    say("  id  mac                alive  hold   toggle last seen   tx ok  retries  lost   rx   ack avg/max (us)")
    for p in pods:
        link = p.get("link", {})
        hold = "-" if "hold" not in p else str(p["hold"])    # hold: firmware >= 2.9 (link revision 2)
        toggle = "-" if "toggle" not in p else str(p["toggle"])    # toggle: firmware >= 2.10 (link revision 3)
        say(f"  {p['id']:<3} {p['mac']:<18} {str(p['alive']):<6} {hold:<5} {toggle:<6} {p['lastSeenMs']:>6} ms  "
            f"{link.get('txFrames', 0):>6} {link.get('txRetries', 0):>8} {link.get('txLost', 0):>5} "
            f"{link.get('rxFrames', 0):>5}   {link.get('ackUsAvg', 0)}/{link.get('ackUsMax', 0)}")


def print_status(status: dict):
    reset = status.get("lastReset", {})
    say(f"  role {status.get('role')}, state {status.get('state')}, firmware {status.get('firmware')}, "
        f"set {status.get('setId')}, uptime {status.get('uptimeMs', 0) / 1000:.0f} s")
    say(f"  store generation {status.get('store', {}).get('generation')}, hash {status.get('store', {}).get('hash')}; "
        f"last reset: {reset.get('reason')} (step '{reset.get('lastStep')}')")
    if status.get("program"):
        p = status["program"]
        say(f"  program [{p.get('index')}] {p.get('name')} {p.get('path')} "
            f"{'(selected)' if p.get('selected') else '(menu)'}")
    if status.get("role") == "central" and status.get("state") != "MENU":
        say(f"  peripherals {len(status.get('pods', []))}/{status.get('requiredPeripherals')}")
        print_pods(status)
    if status.get("role") == "peripheral" and status.get("podId") is not None:
        clock = status.get("clock", {})
        say(f"  pod {status.get('podId')} of central {status.get('central')}, "
            f"clock synced {clock.get('synced')} (offset {clock.get('offsetUs')} us)")


class Check:
    def __init__(self):
        self.failed = []

    def ok(self, name: str, passed: bool, detail: str = "") -> bool:
        mark = color("PASS", "1;32") if passed else color("FAIL", "1;31")
        say(f"[{mark}] {name}{(' - ' + detail) if detail else ''}")
        if not passed:
            self.failed.append(name)
        return passed


# ---------------------------------------------------------------- test scenario

def run_test(pod: PodSerial, args) -> int:
    interactive = not args.yes and sys.stdin.isatty()
    check = Check()
    say(color(f"== ReactPod test on {pod.port}: program {args.program}", "1"))
    say("   Needed: this pod on USB, the peripheral(s) for the program switched on (yellow = waiting).")
    say("   The script tells you whenever something has to be done by hand.\n")

    # 1. pod answers
    say("Step 1: connect to the pod")
    status = pod.wait_ready(timeout=args.ready_timeout, reason="on the serial port")
    if not check.ok("pod answers on serial", status is not None):
        hint("Check the cable / port, close other serial monitors (pio device monitor), then run again.")
        return 1
    print_status(status)

    # 2. central in the program menu
    say("\nStep 2: make it a central in the program menu")
    if status["role"] != "central":
        say("   rebooting as central ...")
        status = pod.reboot("central", timeout=args.ready_timeout)
    elif status.get("state") != "MENU":
        say(f"   state is {status.get('state')}, returning to the menu ...")
        status = pod.reboot("central", timeout=args.ready_timeout)
    if not check.ok("central in program menu", status is not None and status.get("role") == "central"
                    and status.get("state") == "MENU", status.get("state") if status else "no answer"):
        return 1
    if pod.last_boot and pod.last_boot.get("lastReset", {}).get("reason") == "panic":
        check.ok("no crash before the test", False, pod.last_boot["lastReset"].get("lastStep", ""))

    # 3. programs
    say("\nStep 3: programs")
    if args.push:
        say(f"   uploading program files from {args.push} ...")
        push(pod, args.push)
    programs = pod.request("programs")["programs"]
    match = [p for p in programs if args.program in (p["path"], p["name"], str(p["index"]))]
    if not check.ok("program available", bool(match),
                    match[0]["path"] if match else "found: " + ", ".join(p["path"] for p in programs)):
        hint("Upload the programs: 'pio run -d firmware -t uploadfs' or this tool with --push firmware/data.")
        return 1
    program = match[0]
    if not args.no_validate:
        r = pod.request("validate", check=False, path=program["path"])
        check.ok("program validates", r.get("ok", False), r.get("message", f"{r.get('blocks')} blocks"))

    # 4. select and wait for the peripherals
    say("\nStep 4: select the program and connect the peripherals")
    if program["peripherals"] > 0:
        say(f"   '{program['name']}' needs {program['peripherals']} peripheral(s). "
            "Switch them on now if they are off (they light yellow).")
        ask("   Ready?", interactive)
    pod.request("trace", on=True)
    pod.drain_events()
    pod.last_boot = None
    try:
        r = pod.request("select", timeout=10, program=program["path"])
        say(f"   selected '{r['name']}' - BLE off, radio on, searching for peripherals ...")
    except (TimeoutError, ConnectionError) as e:
        check.ok("program selected", False, str(e))
        boot = pod.wait_event(lambda ev: ev.get("event") == "boot", 15)
        if boot:
            hint(f"The pod restarted while selecting (last reset: {boot.get('lastReset')}). "
                 "Please report this with the log (--log file).")
        return 1

    t0 = time.time()
    last_report = 0
    confirm = None
    while time.time() - t0 < args.discovery_timeout:
        confirm = pod.wait_event(lambda e: e.get("event") == "state" and e.get("state") in ("CONFIRM", "ERROR"), 1)
        if confirm:
            break
        if time.time() - last_report > 5:
            last_report = time.time()
            s = pod.try_status()
            if s:
                say(f"   ... {len(s.get('pods', []))}/{s.get('requiredPeripherals')} peripherals after {time.time() - t0:.0f} s")
    if not check.ok("peripherals connected", confirm is not None and confirm["state"] == "CONFIRM",
                    f"{time.time() - t0:.1f} s" if confirm else "timeout"):
        hint("Is the peripheral on and yellow? A peripheral paired with another set is ignored: "
             "hold its button 3 s while it is yellow to clear the pairing (white flash).")
        s = pod.try_status()
        if s:
            print_pods(s)
        return 1

    time.sleep(1.0)     # a few heartbeats for meaningful link numbers
    status = pod.request("status")
    say("   connection data:")
    print_pods(status)
    check.ok("all peripherals alive", all(p["alive"] for p in status.get("pods", [])))

    # 5. run
    say("\nStep 5: run the program")
    if args.auto_press:
        say("   The central's presses are simulated. Press the PERIPHERAL when it lights up.")
    else:
        say("   Press the pod that lights up green (central or peripheral).")
    ask("   Start the program?", interactive)
    pod.drain_events()
    pod.request("start")
    check.ok("program started", pod.wait_event(lambda e: e.get("event") == "state" and e.get("state") == "RUN", 3) is not None)

    press_blocks = set(filter(None, args.press_blocks.split(",")))
    remote_blocks = set(filter(None, args.remote_blocks.split(",")))
    central_id = status.get("requiredPeripherals", 0)
    results = []
    deadline = time.time() + args.duration
    while time.time() < deadline:
        event = pod.wait_event(lambda e: True, max(0.1, deadline - time.time()))
        if event is None:
            break
        kind = event.get("event")
        if kind == "block":
            name = event.get("name")
            if name in press_blocks:
                if args.auto_press:
                    time.sleep(random.uniform(0.18, 0.35))
                    pod.request("press")
                else:
                    say(color("   -> press the CENTRAL", "1;32"))
            elif name in remote_blocks:
                say(color("   -> press the PERIPHERAL", "1;32"))
        elif kind == "result":
            results.append(event)
            who = "central" if event["pod"] == central_id else f"pod {event['pod']}"
            say(f"   RESULT {who}: {event['ms']} ms")
            if args.rounds and len(results) >= args.rounds:
                break
        elif kind == "summary":
            say(f"   SUMMARY: {event['count']} hits, avg {event['average']} ms, "
                f"best {event['best']} ms, worst {event['worst']} ms")
            break
        elif kind == "state" and event.get("state") in ("PAUSED", "ERROR"):
            hint(f"State changed to {event['state']}"
                 + (" - a peripheral stopped answering; switch it back on to continue." if event["state"] == "PAUSED" else ""))
        elif kind == "boot":
            check.ok("no restart during the run", False, str(event.get("lastReset")))
            return 1

    # 6. report
    say("\nStep 6: report")
    final = pod.request("status")
    print_pods(final)
    misses = final.get("variables", {}).get("MISSES")
    if misses is not None:
        say(f"   misses (not pressed within 5 s): {misses}")
    check.ok("results recorded", len(results) > 0, f"{len(results)} results")
    lost = sum(p.get("link", {}).get("txLost", 0) for p in final.get("pods", []))
    check.ok("no frames lost", lost == 0, f"{lost} lost")
    by_pod = {}
    for r in results:
        by_pod.setdefault(r["pod"], []).append(r["ms"])
    for pod_id, values in sorted(by_pod.items()):
        who = "central" if pod_id == central_id else f"pod {pod_id}"
        say(f"   {who}: n={len(values)} avg={sum(values) / len(values):.0f} ms min={min(values)} ms max={max(values)} ms")

    pod.request("trace", on=False, check=False)
    if not args.keep_running:
        say("   returning the pod to the program menu ...")
        pod.request("stop", check=False)

    say(color("== " + ("ALL PASSED" if not check.failed else f"FAILED: {', '.join(check.failed)}"), "1"))
    return 0 if not check.failed else 1


# ---------------------------------------------------------------- monitor

def run_monitor(pod: PodSerial, seconds: float, interactive: bool):
    say(color(f"Monitoring {pod.port}. " + ("Type commands (e.g. status, programs, select 8, start, press, help); "
                                           "Ctrl+C or 'quit' to exit." if interactive else "Ctrl+C to exit."), "1"))

    def printer():
        while pod.running:
            try:
                response = pod.responses.get(timeout=0.3)
            except queue.Empty:
                continue
            say(color(json.dumps(response, indent=2, ensure_ascii=False), "36"))

    threading.Thread(target=printer, daemon=True).start()
    end = time.time() + seconds if seconds else None
    if interactive:
        while end is None or time.time() < end:
            try:
                line = input()
            except EOFError:
                break
            line = line.strip()
            if line in ("quit", "exit"):
                break
            if line:
                try:
                    pod.send_text(line)
                except ConnectionError as e:
                    hint(str(e))
    else:
        while end is None or time.time() < end:
            time.sleep(0.2)


# ---------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", help="serial port, e.g. COM4 or /dev/ttyACM0 (default: first Espressif USB port)")
    parser.add_argument("--log", metavar="FILE", help="append everything received to this file")
    parser.add_argument("-v", "--verbose", action="store_true", help="also show the firmware log")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("programs", "info", "list", "results", "start", "press", "help"):
        sub.add_parser(name)
    sub.add_parser("status", help="show the pod's state, program, peripherals and link statistics")
    p = sub.add_parser("wait-boot", help="after flashing: wait until the pod runs, guide through the reset")
    p.add_argument("--timeout", type=float, default=300)
    p = sub.add_parser("monitor", help="live log and events; type commands")
    p.add_argument("--seconds", type=float, default=0, help="0 = until Ctrl+C")
    p.add_argument("--no-input", action="store_true", help="only show output")
    p = sub.add_parser("select"); p.add_argument("program", help="index, path or name")
    p = sub.add_parser("reboot"); p.add_argument("role", nargs="?", default="auto", choices=["auto", "central", "peripheral"])
    sub.add_parser("stop", help="end the program, back to the menu (the pod restarts)")
    p = sub.add_parser("trace"); p.add_argument("state", choices=["on", "off"])
    p = sub.add_parser("set-name", help="set the set name advertised over BLE (\"\" = default)"); p.add_argument("name")
    p = sub.add_parser("set-pin", help="set the PIN for BLE writes, 4-6 digits (\"\" = clear it)"); p.add_argument("pin")
    sub.add_parser("reports", help="reports not acknowledged yet (firmware >= 2.11)")
    p = sub.add_parser("ack", help="acknowledge a report: it and the older ones leave the buffer"); p.add_argument("id", type=int)
    p = sub.add_parser("command", help="answer a waiting communicate block")
    p.add_argument("name", choices=["continue", "repeat", "stop"])
    p = sub.add_parser("set-variables", help="change editable variables of a waiting communicate block: NAME=value ...")
    p.add_argument("values", nargs="+", metavar="NAME=value")
    p = sub.add_parser("session", help="athlete id copied into the following reports (\"\" = clear it)"); p.add_argument("athlete")
    sub.add_parser("pause", help="pause a running game (firmware >= 2.12); only resume ends it")
    sub.add_parser("resume", help="end a pause made by pause (firmware >= 2.12)")
    p = sub.add_parser("blink", help="blink a pod for 2 s to find it (firmware >= 2.13), only before a game")
    p.add_argument("pod", nargs="?", type=int, default=-1, help="pod id (number minus 1); omitted or -1 = the central")
    p = sub.add_parser("cmd", help="send one raw command (JSON or text form)"); p.add_argument("text")
    p = sub.add_parser("push", help="upload program files"); p.add_argument("directory")
    p = sub.add_parser("pull", help="download program files"); p.add_argument("directory")
    p = sub.add_parser("get"); p.add_argument("path"); p.add_argument("-o", "--output")
    p = sub.add_parser("test", help="guided test session")
    p.add_argument("--program", default="/prog/duo.json")
    p.add_argument("--push", metavar="DIR", help="upload program files before the test")
    p.add_argument("--auto-press", action="store_true", help="simulate the central's button presses")
    p.add_argument("--press-blocks", default="CentralPress", help="blocks that wait for the central (comma list)")
    p.add_argument("--remote-blocks", default="RemoteTarget", help="blocks that wait for a peripheral (comma list)")
    p.add_argument("--rounds", type=int, default=0, help="stop after this many results (0 = until the summary)")
    p.add_argument("--duration", type=float, default=300, help="max. run time of the program in s")
    p.add_argument("--discovery-timeout", type=float, default=60)
    p.add_argument("--ready-timeout", type=float, default=300, help="how long to wait for the pod (incl. manual reset)")
    p.add_argument("--no-validate", action="store_true")
    p.add_argument("--keep-running", action="store_true", help="do not return to the menu afterwards")
    p.add_argument("-y", "--yes", action="store_true", help="no Enter prompts (unattended)")
    args = parser.parse_args()

    port = args.port or find_port()
    if not port:
        sys.exit("No Espressif USB serial port found. Connect the pod or give --port.")

    if args.command == "monitor":
        show = "all"
    elif args.command in ("wait-boot", "test"):
        show = "all" if args.verbose else "events"
    else:
        show = "all" if args.verbose else "none"
    pod = PodSerial(port, show=show, log_file=args.log)
    pod.start()
    time.sleep(0.5)
    try:
        if args.command == "status":
            status = pod.wait_ready(timeout=20, prompt_after=6)
            if status is None:
                return 1
            print_status(status)
            if args.verbose:
                say(json.dumps(status, indent=2, ensure_ascii=False))
        elif args.command in ("programs", "info", "list", "results", "start", "press", "help"):
            say(json.dumps(pod.request(args.command, check=False), indent=2, ensure_ascii=False))
        elif args.command == "wait-boot":
            say(f"Waiting for the pod on {port}. If it was just flashed, press its RESET button "
                "or switch it off and on.")
            status = pod.wait_ready(timeout=args.timeout, prompt_after=8)
            if status is None:
                say("No answer.")
                return 1
            say(color("The pod is running:", "1;32"))
            print_status(status)
        elif args.command == "select":
            program = int(args.program) if args.program.isdigit() else args.program
            say(json.dumps(pod.request("select", timeout=10, check=False, program=program), indent=2, ensure_ascii=False))
        elif args.command == "trace":
            say(json.dumps(pod.request("trace", on=args.state == "on"), indent=2))
        elif args.command == "set-name":
            say(json.dumps(pod.request("setName", check=False, name=args.name), indent=2, ensure_ascii=False))
        elif args.command == "set-pin":
            say(json.dumps(pod.request("setPin", check=False, pin=args.pin), indent=2))
        elif args.command == "reports":
            say(json.dumps(pod.request("reports", check=False), indent=2, ensure_ascii=False))
        elif args.command == "ack":
            say(json.dumps(pod.request("ack", check=False, reportId=args.id), indent=2))
        elif args.command == "command":
            say(json.dumps(pod.request("command", check=False, name=args.name), indent=2))
        elif args.command == "set-variables":
            values = {}
            for item in args.values:
                name, sep, number = item.partition("=")
                if not sep or not number.lstrip("-").isdigit():
                    sys.exit(f"set-variables: '{item}' is not NAME=integer")
                values[name] = int(number)
            say(json.dumps(pod.request("setVariables", check=False, values=values), indent=2))
        elif args.command == "session":
            say(json.dumps(pod.request("session", check=False, athlete=args.athlete), indent=2, ensure_ascii=False))
        elif args.command in ("pause", "resume"):
            say(json.dumps(pod.request(args.command, check=False), indent=2))
        elif args.command == "blink":
            say(json.dumps(pod.request("blink", check=False, pod=args.pod), indent=2))
        elif args.command == "reboot":
            status = pod.reboot(args.role)
            if status:
                print_status(status)
        elif args.command == "stop":
            say(json.dumps(pod.request("stop", check=False), ensure_ascii=False))
            status = pod.wait_ready(lambda s: s.get("role") == "central" and s.get("state") == "MENU",
                                    timeout=120, prompt_after=15, reason="after stop")
            if status:
                print_status(status)
        elif args.command == "cmd":
            text = args.text.strip()
            if text.startswith("{"):
                obj = json.loads(text)
                obj.setdefault("id", 0)
                pod.send(obj)
            else:
                pod.send_text(text)
            try:
                say(json.dumps(pod.responses.get(timeout=5), indent=2, ensure_ascii=False))
            except queue.Empty:
                say("no answer")
        elif args.command == "push":
            push(pod, args.directory)
        elif args.command == "pull":
            out = Path(args.directory)
            for entry in pod.request("list")["files"]:
                target = out / entry["path"].lstrip("/")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(pod.get_file(entry["path"]), encoding="utf-8")
                say(f"  {entry['path']} -> {target}")
        elif args.command == "get":
            text = pod.get_file(args.path)
            if args.output:
                Path(args.output).write_text(text, encoding="utf-8")
            else:
                say(text)
        elif args.command == "monitor":
            run_monitor(pod, args.seconds, interactive=not args.no_input and sys.stdin.isatty())
        elif args.command == "test":
            return run_test(pod, args)
    except KeyboardInterrupt:
        say("\naborted")
    except (TimeoutError, ConnectionError, RuntimeError) as e:
        hint(str(e))
        return 1
    finally:
        pod.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
