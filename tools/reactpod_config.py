#!/usr/bin/env python3
"""
Reference client for the ReactPod configuration API (BLE, see doc/config-api.md).

The central must be in the program menu (booted with the button held, before a program
is selected). Requires: pip install bleak

    python tools/reactpod_config.py info
    python tools/reactpod_config.py list
    python tools/reactpod_config.py get /prog/solo.json -o solo.json
    python tools/reactpod_config.py put my_game.json /prog/mygame.json
    python tools/reactpod_config.py delete /prog/mygame.json
    python tools/reactpod_config.py validate /prog/mygame.json
    python tools/reactpod_config.py push data          # upload all program files from data/
    python tools/reactpod_config.py pull backup        # download all program files

Options: --address <BLE address> (otherwise the first "ReactPod Config" found is used)
"""
import argparse
import asyncio
import json
import sys
import zlib
from pathlib import Path

from bleak import BleakClient, BleakScanner

SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab"
COMMAND_UUID = "12345678-1234-1234-1234-1234567890b1"
RESPONSE_UUID = "12345678-1234-1234-1234-1234567890b2"
DEVICE_NAME = "ReactPod Config"
PUT_CHUNK = 2048            # characters of file content per put request


class ReactPodConfig:
    def __init__(self, client: BleakClient):
        self.client = client
        self.buffer = bytearray()
        self.responses: asyncio.Queue = asyncio.Queue()
        self.next_id = 1

    async def start(self):
        await self.client.start_notify(RESPONSE_UUID, self._on_data)

    def _on_data(self, _sender, data: bytearray):
        self.buffer.extend(data)
        while b"\n" in self.buffer:
            line, _, rest = self.buffer.partition(b"\n")
            self.buffer = bytearray(rest)
            if line:
                self.responses.put_nowait(json.loads(line.decode("utf-8")))

    async def request(self, op: str, **fields) -> dict:
        request_id = self.next_id
        self.next_id += 1
        message = json.dumps({"op": op, "id": request_id, **fields}, ensure_ascii=False) + "\n"
        payload = message.encode("utf-8")

        chunk = max(20, (self.client.mtu_size or 23) - 3)
        for pos in range(0, len(payload), chunk):
            await self.client.write_gatt_char(COMMAND_UUID, payload[pos:pos + chunk], response=True)

        while True:
            response = await asyncio.wait_for(self.responses.get(), timeout=10)
            if response.get("id") in (request_id, None):
                if not response.get("ok"):
                    raise RuntimeError(f"{op} failed: {response.get('error')}: {response.get('message')}")
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


async def find_device(address):
    if address:
        return address
    device = await BleakScanner.find_device_by_filter(
        lambda d, adv: d.name == DEVICE_NAME or SERVICE_UUID in (adv.service_uuids or []), timeout=10)
    if device is None:
        sys.exit("No ReactPod in configuration mode found (boot the central with the button held)")
    return device


def store_path(data_dir: Path, file: Path) -> str:
    return "/" + file.relative_to(data_dir).as_posix()


async def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--address")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("info")
    sub.add_parser("list")
    p = sub.add_parser("get"); p.add_argument("path"); p.add_argument("-o", "--output")
    p = sub.add_parser("put"); p.add_argument("local"); p.add_argument("path")
    p = sub.add_parser("delete"); p.add_argument("path")
    p = sub.add_parser("validate"); p.add_argument("path")
    p = sub.add_parser("push"); p.add_argument("directory")
    p = sub.add_parser("pull"); p.add_argument("directory")
    args = parser.parse_args()

    async with BleakClient(await find_device(args.address)) as client:
        pod = ReactPodConfig(client)
        await pod.start()

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
