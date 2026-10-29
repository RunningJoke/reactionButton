#!/usr/bin/env python3
"""
Automated part of the firmware release checklist (docs/firmware/testing.md §12) over USB serial.

    python tools/reactpod_hwtest.py --central COM3 --peripheral COM4 --peripheral COM5
    python tools/reactpod_hwtest.py --central COM3 --peripheral COM4 --quick    # without the cycle report

The central and the peripherals must belong to the same set. Peripherals are "lost" by rebooting
them as central and brought back as peripheral. Every pod is put back into its original role at
the end. Exit code 1 if a check failed. Requires: pip install pyserial
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reactpod_serial import PodSerial  # noqa: E402

REQUESTS = 150          # line 1: status requests per pod
REQUEST_GAP = 0.3
REPORT_PROGRAM = "/prog/duo.json"   # 1 peripheral, misses after 5 s: a cycle ends without presses
REPORT_WAIT = 240


class Checks:
    def __init__(self):
        self.failed = 0
        self.passed = 0

    def check(self, name: str, ok: bool, detail: str = ""):
        if ok:
            self.passed += 1
        else:
            self.failed += 1
        print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)

    def skip(self, name: str, why: str):
        print(f"SKIP {name}  [{why}]", flush=True)


def request(pod: PodSerial, op: str, **fields) -> dict:
    try:
        return pod.request(op, timeout=3, check=False, **fields)
    except (TimeoutError, ConnectionError) as e:
        return {"ok": False, "error": "timeout", "message": str(e)}


def wait_state(pod: PodSerial, state: str, timeout: float):
    return pod.wait_event(lambda e: e.get("event") == "state" and e.get("state") == state, timeout)


def reboot(pod: PodSerial, role: str, settle: float = 6):
    try:
        pod.request("reboot", timeout=2, role=role)
    except (TimeoutError, ConnectionError, RuntimeError):
        pass    # the pod may restart before it answers
    time.sleep(settle)


def to_menu(central: PodSerial) -> bool:
    reboot(central, "central")
    central.drain_events()
    for _ in range(10):
        status = central.try_status()
        if status and status.get("state") == "MENU":
            return True
        time.sleep(0.5)
    return False


def start_program(central: PodSerial, path: str, checks: Checks, peripherals: int, label: str = ""):
    """Selects and starts a program; returns True in RUN, None if skipped."""
    central.drain_events()
    r = request(central, "select", program=path)
    if not r.get("ok"):
        checks.check(f"{label}select {path}", False, f"{r.get('error')} {r.get('message', '')}")
        return False
    need = r.get("requiredPeripherals", 0)
    if need > peripherals:
        checks.skip(f"{label}{path}", f"needs {need} peripherals, {peripherals} on USB")
        return None
    confirm = wait_state(central, "CONFIRM", 30)
    if not confirm:
        checks.check(f"{label}{path}: DISCOVERY -> CONFIRM", False, "no CONFIRM within 30 s")
        return False
    r = request(central, "start")
    running = r.get("ok") and wait_state(central, "RUN", 5) is not None
    checks.check(f"{label}{path}: CONFIRM -> RUN", running, r.get("error", ""))
    return running


def line1_serial(pods: dict, checks: Checks):
    for port, pod in pods.items():
        lost, slow = 0, 0
        for _ in range(REQUESTS):
            t0 = time.time()
            try:
                pod.request("status", timeout=1.5)
                slow = max(slow, time.time() - t0)
            except (TimeoutError, ConnectionError, RuntimeError):
                lost += 1
            time.sleep(REQUEST_GAP)
        checks.check(f"1 serial {port}: {REQUESTS} status requests", lost == 0,
                     f"{lost} timeouts, slowest {slow * 1000:.0f} ms")


def line2_programs(central: PodSerial, peripherals: int, checks: Checks):
    menu = request(central, "list").get("menu", [])
    checks.check("2 program menu listed", bool(menu), f"{len(menu)} programs")
    for path in menu:
        if not to_menu(central):
            checks.check(f"2 {path}: central back in MENU", False)
            continue
        start_program(central, path, checks, peripherals, "2 ")


def find_victim(central: PodSerial, peripherals: list):
    """The first peripheral the central has claimed (ACTIVE)."""
    for pod in peripherals:
        status = pod.try_status()
        if status and status.get("role") == "peripheral" and status.get("podId") is not None:
            return pod
    return None


def line4_5_pause_and_loss(central: PodSerial, peripherals: list, checks: Checks):
    if not to_menu(central) or not start_program(central, "/prog/dreieck.json", checks, len(peripherals), "4 "):
        if len(peripherals) < 2:
            checks.skip("4/5 pause and pod loss", "dreieck needs 2 peripherals")
        return
    victim = find_victim(central, peripherals)
    if victim is None:
        checks.check("4 a claimed peripheral found", False)
        return
    time.sleep(2)

    r = request(central, "pause")
    checks.check("4 pause in RUN -> PAUSED", r.get("ok") and r.get("state") == "PAUSED", str(r.get("error", "")))
    r = request(central, "pause")
    checks.check("4 second pause -> not_running", r.get("error") == "not_running", str(r.get("error")))
    reboot(victim, "central", settle=4)
    status = request(central, "status")
    checks.check("4 pod lost while phone-paused: PAUSED, phonePaused", status.get("state") == "PAUSED"
                 and status.get("phonePaused") is True, f"{status.get('state')} {status.get('phonePaused')}")
    r = request(central, "resume")
    status = request(central, "status")
    checks.check("4 resume with the pod missing -> PAUSED, phonePaused false", r.get("state") == "PAUSED"
                 and status.get("phonePaused") is False, f"{r.get('state')} {status.get('phonePaused')}")
    central.drain_events()
    t0 = time.time()
    reboot(victim, "peripheral", settle=0)
    back = wait_state(central, "RUN", 25)
    checks.check("4 pod back -> RUN by itself", back is not None, f"{time.time() - t0:.1f} s after the reboot request")

    time.sleep(3)
    r = request(central, "pause")
    reboot(victim, "central", settle=4)
    reboot(victim, "peripheral", settle=12)
    status = request(central, "status")
    checks.check("4 pod back during the phone pause: still PAUSED", status.get("state") == "PAUSED"
                 and status.get("phonePaused") is True, f"{status.get('state')} {status.get('phonePaused')}")
    r = request(central, "resume")
    checks.check("4 resume -> RUN", r.get("ok") and r.get("state") == "RUN", str(r.get("error", "")))
    r = request(central, "resume")
    checks.check("4 resume without pause -> not_paused", r.get("error") == "not_paused", str(r.get("error")))

    # line 5: power-cycle a peripheral mid-game (USB reboot as a stand-in)
    time.sleep(2)
    central.drain_events()
    reboot(victim, "peripheral", settle=0)
    paused = wait_state(central, "PAUSED", 5)
    t0 = time.time()
    running = wait_state(central, "RUN", 10)
    if paused:
        checks.check("5 peripheral restarted mid-game: PAUSED, then RUN within 10 s", running is not None,
                     f"{time.time() - t0:.1f} s")
    else:
        # the reboot can be shorter than the 1.5 s pod timeout: then the game never pauses
        status = request(central, "status")
        checks.check("5 peripheral restarted mid-game: game still running", status.get("state") == "RUN",
                     f"no PAUSED (restart shorter than the pod timeout), state {status.get('state')}")


def line6_report(central: PodSerial, peripherals: int, checks: Checks):
    if not to_menu(central) or not start_program(central, REPORT_PROGRAM, checks, peripherals, "6 "):
        return
    print(f"     waiting for the cycle report of {REPORT_PROGRAM} (about 2 min) ...", flush=True)
    report = central.wait_event(lambda e: e.get("event") == "report", REPORT_WAIT)
    checks.check("6 cycle report over USB", report is not None)
    if not report:
        return
    text = str(report)
    checks.check("6 report has the cycle metric and RUNS", "cycle" in text and "RUNS" in text, text[:200])
    r = request(central, "command", name="continue")
    checks.check("6 command continue", r.get("ok"), str(r.get("error", "")))
    r = request(central, "reports")
    checks.check("6 reports lists it", r.get("ok") and r.get("total", len(r.get("reports", []))) >= 1,
                 f"total {r.get('total')}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--central", required=True, help="serial port of the central, e.g. COM3")
    parser.add_argument("--peripheral", action="append", default=[], help="serial port of a peripheral (repeat)")
    parser.add_argument("--quick", action="store_true", help="skip the cycle report (line 6)")
    args = parser.parse_args()

    ports = [args.central] + args.peripheral
    pods = {port: PodSerial(port, show="none") for port in ports}
    for pod in pods.values():
        pod.start()
    roles = {}
    for port, pod in pods.items():
        pod.connected.wait(5)
        status = pod.try_status(3)
        if status is None:
            sys.exit(f"{port}: no answer to status")
        roles[port] = status.get("role")
        print(f"{port}: {status.get('role')} firmware {status.get('firmware')} set {status.get('setId')}")

    central = pods[args.central]
    peripherals = [pods[p] for p in args.peripheral]
    for pod in peripherals:
        if (pod.try_status() or {}).get("role") != "peripheral":
            reboot(pod, "peripheral")

    checks = Checks()
    try:
        line1_serial(pods, checks)
        line2_programs(central, len(peripherals), checks)
        line4_5_pause_and_loss(central, peripherals, checks)
        if not args.quick:
            line6_report(central, len(peripherals), checks)
    finally:
        for port, pod in pods.items():
            role = roles.get(port) if roles.get(port) in ("central", "peripheral") else "peripheral"
            reboot(pod, role, settle=0)
        time.sleep(1)
        for pod in pods.values():
            pod.stop()
    print(f"\n{checks.passed} passed, {checks.failed} failed")
    sys.exit(1 if checks.failed else 0)


if __name__ == "__main__":
    main()
