#!/usr/bin/env python3
"""
Reference client for the ReactPod configuration API (BLE, see docs/firmware/config-api.md).

The central must be in the program menu (booted with the button held, before a program
is selected); file changes are refused (`busy`) once a program is selected. From firmware 2.12
on the connection stays during the game, `live` keeps it open through the whole game. Uploads
belong in the menu. Requires: pip install bleak

    python tools/reactpod_config.py info
    python tools/reactpod_config.py list
    python tools/reactpod_config.py get /prog/solo.json -o solo.json
    python tools/reactpod_config.py put my_game.json /prog/mygame.json
    python tools/reactpod_config.py delete /prog/mygame.json
    python tools/reactpod_config.py validate /prog/mygame.json
    python tools/reactpod_config.py validate /prog/mygame.json --file my_game.json   # dry run, nothing stored
    python tools/reactpod_config.py push firmware/data          # upload all program files from firmware/data/
    python tools/reactpod_config.py pull backup        # download all program files
    python tools/reactpod_config.py set-name "Halle 2" # advertise as "ReactPod Halle 2" ("" = default)
    python tools/reactpod_config.py scan               # list the sets in range
    python tools/reactpod_config.py live               # stay connected through the game (firmware >= 2.12)
    python tools/reactpod_config.py live --auto --athlete ath_42   # continue every communicate block

`live` prints the `state` and `report` events, fetches and acknowledges the reports (also after
a reconnect), and reads keys from stdin: c continue, r repeat, s stop, p pause, u resume,
v NAME=VALUE ... (setVariables), a NAME (athlete; "a" alone clears it), ? status, q quit.
`--auto` answers every waiting communicate block with continue (long soak tests). If the
connection drops, it scans again and goes on.

Options: --address <BLE address>, or --name <advertised name, e.g. "ReactPod 91c2">
(otherwise the first ReactPod found is used); --pin <PIN> if the set has a PIN
(info shows "pinRequired"; put, delete and set-name need it)
"""
import argparse
import asyncio
import json
import re
import sys
import threading
import time
import zlib
from pathlib import Path

from bleak import BleakClient, BleakScanner
from bleak.exc import BleakError

from reactpod_format import report_line

SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab"
COMMAND_UUID = "12345678-1234-1234-1234-1234567890b1"
RESPONSE_UUID = "12345678-1234-1234-1234-1234567890b2"
NAME_PREFIX = "ReactPod"     # "ReactPod <last 4 hex digits of setId>" or "ReactPod <set name>"
MANUFACTURER_ID = 0xFFFF    # manufacturer data: set id (4 bytes, big endian)
PUT_CHUNK = 2048            # characters of file content per put request
REPORT_PAGE = 2             # reports per `reports` request in live (config-api.md §5)
RECONNECT_DELAY = 3         # seconds between two scans in live
AUTO_RETRIES = 10           # live --auto: tries of `command continue`, 0.2 s apart (block not waiting yet)
KEY_HELP = ("c continue, r repeat, s stop, p pause, u resume, v NAME=VALUE ... variables, "
            "a NAME athlete (a alone clears it), ? status, q quit")
KEY_COMMANDS = {
    "c": ("command", {"name": "continue"}),
    "r": ("command", {"name": "repeat"}),
    "s": ("command", {"name": "stop"}),
    "p": ("pause", {}),
    "u": ("resume", {}),
    "?": ("status", {}),
    "q": ("quit", {}),
}


class PodError(RuntimeError):
    """An error response of the pod (config-api.md §3.1); `code` is e.g. `not_ready`."""

    def __init__(self, op: str, response: dict):
        self.code = response.get("error")
        super().__init__(f"{op} failed: {self.code}: {response.get('message')}")


def split_messages(buffer: bytearray, data: bytes) -> list:
    """Adds one indication to the buffer and returns the complete JSON lines in it (config-api.md §3)."""
    buffer.extend(data)
    messages = []
    while b"\n" in buffer:
        line, _, rest = buffer.partition(b"\n")
        buffer[:] = rest
        if not line.strip():
            continue
        try:
            messages.append(json.loads(line.decode("utf-8")))
        except (UnicodeDecodeError, json.JSONDecodeError):
            print(f"ignored a line that is not JSON: {line[:80]!r}", file=sys.stderr)
    return messages


def is_event(message: dict) -> bool:
    """Event lines (`{"event": ...}`) are not responses; they never match a request."""
    return "event" in message


class ReactPodConfig:
    def __init__(self, client: BleakClient, on_event=None):
        self.client = client
        self.buffer = bytearray()
        self.responses: asyncio.Queue = asyncio.Queue()
        self.on_event = on_event    # called with every event line; events never reach request()
        self.lock = asyncio.Lock()  # one request at a time (config-api.md §3)
        self.next_id = 1
        self.mtu = None     # from info (firmware >= 2.7), else bleak's value
        self.info = {}

    async def start(self):
        await self.client.start_notify(RESPONSE_UUID, self._on_data)
        self.info = await self.request("info")
        self.mtu = self.info.get("mtu")

    def _on_data(self, _sender, data: bytearray):
        for message in split_messages(self.buffer, data):
            if is_event(message):
                if self.on_event:
                    self.on_event(message)
            else:
                self.responses.put_nowait(message)

    async def request(self, op: str, **fields) -> dict:
        async with self.lock:
            request_id = self.next_id
            self.next_id += 1
            message = json.dumps({"op": op, "id": request_id, **fields}, ensure_ascii=False) + "\n"
            payload = message.encode("utf-8")

            chunk = max(20, (self.mtu or self.client.mtu_size or 23) - 3)
            for pos in range(0, len(payload), chunk):
                await self.client.write_gatt_char(COMMAND_UUID, payload[pos:pos + chunk], response=True)

            while True:
                response = await asyncio.wait_for(self.responses.get(), timeout=10)
                if response.get("id") in (request_id, None):
                    if not response.get("ok"):
                        raise PodError(op, response)
                    return response

    async def get_file(self, path: str) -> str:
        parts, offset = [], 0
        while True:
            r = await self.request("get", path=path, offset=offset, length=2048)
            parts.append(r["data"])
            offset += len(r["data"].encode("utf-8"))
            if r["eof"]:
                return "".join(parts)

    async def put_file(self, path: str, text: str) -> dict:
        crc = format(zlib.crc32(text.encode("utf-8")) & 0xFFFFFFFF, "08x")
        offset = 0
        chunks = [text[i:i + PUT_CHUNK] for i in range(0, len(text), PUT_CHUNK)] or [""]
        for index, part in enumerate(chunks):
            final = index == len(chunks) - 1
            fields = {"path": path, "offset": offset, "data": part, "final": final}
            if final:
                fields["crc"] = crc
            r = await self.request("put", **fields)
            offset += len(part.encode("utf-8"))   # offsets count bytes, not characters
        return r


def is_reactpod(adv) -> bool:
    return SERVICE_UUID in (adv.service_uuids or [])


def set_id_of(adv):
    data = (adv.manufacturer_data or {}).get(MANUFACTURER_ID)
    return data[:4].hex() if data and len(data) >= 4 else None


async def scan():
    found = await BleakScanner.discover(timeout=5, return_adv=True)
    for device, adv in found.values():
        if is_reactpod(adv):
            print(f"{device.address}  {adv.local_name or device.name}  setId {set_id_of(adv)}  rssi {adv.rssi}")


async def find_device(address, name):
    """The address to connect to, or the device a scan found (None if no ReactPod is in range)."""
    if address:
        return address
    return await BleakScanner.find_device_by_filter(
        lambda d, adv: is_reactpod(adv) and (name is None or (adv.local_name or d.name) == name), timeout=10)


def store_path(data_dir: Path, file: Path) -> str:
    return "/" + file.relative_to(data_dir).as_posix()


# ---- live: formatting, keys and the report fetch (pure functions, see tools/test_reactpod_config.py)

def say(text: str):
    print(f"{time.strftime('%H:%M:%S')} {text}", flush=True)


def state_line(event: dict) -> str:
    def count(value):
        return len(value) if isinstance(value, list) else value
    text = f"[state] {event.get('state')}"
    if event.get("program"):
        text += f"  program {event['program']}"
    if "pods" in event or "required" in event:
        text += f"  pods {count(event.get('pods'))}/{count(event.get('required'))}"
    if event.get("phonePaused"):
        text += "  (phone pause)"
    return text


def status_line(status: dict) -> str:
    reports = status.get("reports") or {}
    ble = status.get("ble") or {}
    text = (f"[status] {status.get('state')}  program {status.get('program') or '-'}"
            f"  athlete {status.get('athlete') or '-'}"
            f"  reports pending {reports.get('pending', '-')} dropped {reports.get('dropped', '-')}"
            f"  ble {'connected' if ble.get('connected') else 'no'} interval {ble.get('intervalMs', '-')} ms")
    if status.get("phonePaused"):
        text += "  (phone pause)"
    if status.get("waiting"):
        text += f"  waiting {status['waiting'].get('block')}"
    return text


def event_line(event: dict) -> str:
    kind = event.get("event")
    if kind == "state":
        return state_line(event)
    if kind == "report":
        return report_line(event)
    details = {k: v for k, v in event.items() if k != "event"}
    return f"[{kind}] {json.dumps(details, ensure_ascii=False)}"


def parse_key(line: str):
    """One line typed in live -> (op, fields); None for an empty line; ValueError if it is not a key command."""
    words = line.split()
    if not words:
        return None
    key, args = words[0], words[1:]
    if key in KEY_COMMANDS and not args:
        op, fields = KEY_COMMANDS[key]
        return op, dict(fields)
    if key == "v" and args:
        values = {}
        for item in args:
            name, sep, number = item.partition("=")
            if not sep or not name or not re.fullmatch(r"-?\d+", number):
                raise ValueError(f"'{item}' is not NAME=integer")
            values[name] = int(number)
        return "setVariables", {"values": values}
    if key == "a":
        return "session", {"athlete": " ".join(args)}
    raise ValueError(f"unknown key '{line.strip()}': {KEY_HELP}")


async def fetch_reports(request, printed: set, emit=print) -> int:
    """Prints the reports not acknowledged yet (pages of REPORT_PAGE) and acknowledges each one.
    `printed` holds the ids already printed from `report` events. Returns the number of reports acknowledged."""
    count = 0
    while True:
        page = await request("reports", max=REPORT_PAGE)
        reports = page.get("reports", [])
        for report in reports:
            if report.get("id") not in printed:
                printed.add(report.get("id"))
                emit(report_line(report))
            await request("ack", reportId=report["id"])
            count += 1
        if not reports or not page.get("more"):
            return count


async def answer_continue(request, emit=print) -> bool:
    """`command continue` for a waiting communicate block. The report event comes before the block
    waits, so `not_ready` is retried for a moment."""
    for _ in range(AUTO_RETRIES):
        try:
            await request("command", name="continue")
            emit("[auto] continue")
            return True
        except PodError as error:
            if error.code != "not_ready":
                emit(f"[auto] {error}")
                return False
        await asyncio.sleep(0.2)
    emit("[auto] no communicate block waiting, continue not sent")
    return False


def read_keys(loop, queue: asyncio.Queue):
    """Thread: every line typed on stdin goes to the asyncio queue. EOF just ends the thread."""
    if sys.stdin is None:
        return
    for line in sys.stdin:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, line)
        except RuntimeError:    # event loop closed
            return


class Live:
    """`live`: one BLE connection through the game; reconnects (scan again) when it drops."""

    def __init__(self, args):
        self.args = args
        self.pod = None             # ReactPodConfig while connected
        self.printed = set()        # report ids printed from events on this connection
        self.events: asyncio.Queue = asyncio.Queue()
        self.keys: asyncio.Queue = asyncio.Queue()
        self.quit = asyncio.Event()

    async def run(self):
        loop = asyncio.get_running_loop()
        threading.Thread(target=read_keys, args=(loop, self.keys), daemon=True).start()
        tasks = [asyncio.create_task(self.event_loop()), asyncio.create_task(self.key_loop())]
        say(f"keys: {KEY_HELP}")
        try:
            while not self.quit.is_set():
                try:
                    await self.connect_once()
                except (ConnectionError, BleakError, asyncio.TimeoutError, OSError) as error:
                    say(f"[connection] {error or type(error).__name__}")
                if not self.quit.is_set():
                    await self.wait_quit(RECONNECT_DELAY)
        finally:
            for task in tasks:
                task.cancel()
        say("bye")

    async def wait_quit(self, seconds: float):
        try:
            await asyncio.wait_for(self.quit.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass

    async def connect_once(self):
        device = await find_device(self.args.address, self.args.name)
        if device is None:
            raise ConnectionError("no ReactPod in range (boot the central with the button held)")
        lost = asyncio.Event()
        async with BleakClient(device, disconnected_callback=lambda _client: lost.set()) as client:
            pod = ReactPodConfig(client, on_event=self.events.put_nowait)
            await pod.start()
            self.pod = pod
            self.printed = set()
            try:
                info = pod.info
                say(f"[connected] {getattr(device, 'address', device)}  firmware {info.get('firmware')}"
                    f"  setId {info.get('setId')}")
                if "liveBle" not in info.get("features", []):
                    say(f"[warning] firmware {info.get('firmware')} has no liveBle: the connection drops "
                        "when the game starts (firmware 2.12 keeps it)")
                if self.args.athlete is not None:
                    await pod.request("session", athlete=self.args.athlete)
                await fetch_reports(pod.request, self.printed, say)
                waiters = [asyncio.ensure_future(lost.wait()), asyncio.ensure_future(self.quit.wait())]
                await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)
                for waiter in waiters:
                    waiter.cancel()
            finally:
                self.pod = None
        if not self.quit.is_set():
            say("[connection] lost, scanning again")

    async def event_loop(self):
        while True:
            event = await self.events.get()
            try:
                await self.handle_event(event)
            except (PodError, asyncio.TimeoutError, BleakError, OSError) as error:
                say(f"[event] {event.get('event')} not handled: {error}")

    async def handle_event(self, event: dict):
        if event.get("event") != "report":
            say(event_line(event))
            return
        if event.get("id") not in self.printed:     # not yet printed by the fetch of this connection
            self.printed.add(event.get("id"))
            say(event_line(event))
        if self.pod is None:
            return
        if self.args.auto:
            await answer_continue(self.pod.request, say)
        await fetch_reports(self.pod.request, self.printed, say)

    async def key_loop(self):
        while True:
            line = await self.keys.get()
            try:
                command = parse_key(line)
            except ValueError as error:
                say(f"[keys] {error}")
                continue
            if command is None:
                continue
            op, fields = command
            if op == "quit":
                self.quit.set()
                return
            if self.pod is None:
                say(f"[{op}] not connected, nothing sent")
                continue
            try:
                response = await self.pod.request(op, **fields)
            except (PodError, asyncio.TimeoutError, BleakError, OSError) as error:
                say(f"[{op}] {error}")
                continue
            if op == "status":
                say(status_line(response))
            else:
                details = {k: v for k, v in response.items() if k not in ("op", "id", "ok")}
                say(f"[{op}] ok {json.dumps(details, ensure_ascii=False)}".rstrip())


async def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--address")
    parser.add_argument("--name", help='advertised name, e.g. "ReactPod 91c2"')
    parser.add_argument("--pin", help="PIN for write operations, if the set has one")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("info")
    sub.add_parser("list")
    p = sub.add_parser("get"); p.add_argument("path"); p.add_argument("-o", "--output")
    p = sub.add_parser("put"); p.add_argument("local"); p.add_argument("path")
    p = sub.add_parser("delete"); p.add_argument("path")
    p = sub.add_parser("validate"); p.add_argument("path")
    p.add_argument("--file", help="validate this local file as <path> without storing it (firmware >= 2.4)")
    p = sub.add_parser("push"); p.add_argument("directory")
    p = sub.add_parser("pull"); p.add_argument("directory")
    p = sub.add_parser("set-name"); p.add_argument("set_name")
    sub.add_parser("scan")
    p = sub.add_parser("live", help="stay connected through the game (firmware >= 2.12): events, reports, keys")
    p.add_argument("--auto", action="store_true", help="answer every waiting communicate block with continue")
    p.add_argument("--athlete", help="athlete id set at every connect (session op)")
    args = parser.parse_args()

    if args.command == "scan":
        await scan()
        return
    if args.command == "live":
        await Live(args).run()
        return

    device = await find_device(args.address, args.name)
    if device is None:
        sys.exit("No ReactPod in configuration mode found (boot the central with the button held)")
    async with BleakClient(device) as client:
        pod = ReactPodConfig(client)
        await pod.start()
        if args.pin:
            await pod.request("auth", pin=args.pin)

        if args.command in ("info", "list"):
            print(json.dumps(await pod.request(args.command), indent=2))
        elif args.command == "get":
            text = await pod.get_file(args.path)
            if args.output:
                Path(args.output).write_text(text, encoding="utf-8")
            else:
                print(text)
        elif args.command == "put":
            r = await pod.put_file(args.path, Path(args.local).read_text(encoding="utf-8"))
            print(f"stored {r['path']}: {r['size']} bytes, crc {r['crc']}, generation {r['generation']}")
        elif args.command == "set-name":
            print(json.dumps(await pod.request("setName", name=args.set_name), indent=2, ensure_ascii=False))
        elif args.command == "validate" and args.file:
            data = Path(args.file).read_text(encoding="utf-8")
            print(json.dumps(await pod.request("validate", path=args.path, data=data), indent=2, ensure_ascii=False))
        elif args.command in ("delete", "validate"):
            print(json.dumps(await pod.request(args.command, path=args.path), indent=2))
        elif args.command == "push":
            data_dir = Path(args.directory)
            files = sorted(f for f in data_dir.rglob("*.json") if store_path(data_dir, f) != "/programs.json")
            index = data_dir / "programs.json"
            if index.exists():
                files.append(index)     # menu last, so it never points to missing files
            for f in files:
                r = await pod.put_file(store_path(data_dir, f), f.read_text(encoding="utf-8"))
                print(f"{r['path']}: {r['size']} bytes")
            for program in json.loads(index.read_text(encoding="utf-8")).get("programs", []) if index.exists() else []:
                r = await pod.request("validate", path=program)
                print(f"validate {program}: ok, {r['blocks']} blocks")
        elif args.command == "pull":
            out = Path(args.directory)
            for entry in (await pod.request("list"))["files"]:
                target = out / entry["path"].lstrip("/")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(await pod.get_file(entry["path"]), encoding="utf-8")
                print(f"{entry['path']} -> {target}")


if __name__ == "__main__":
    asyncio.run(main())
