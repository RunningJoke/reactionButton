"""
Firmware update over the config API (docs/firmware/config-api.md "Firmware update", fw >= 2.19), shared by
reactpod_serial.py (USB) and reactpod_config.py (BLE).

ota_steps() is the whole protocol as one generator: it yields (op, fields) and takes the response dict back.
run_sync() and run_async() drive it over a transport. A failed step raises OtaError; an update that is still
open then gets otaAbort first (its `aborted` says whether that worked; None = no update was open).
"""
import base64
import hashlib
import time
from pathlib import Path

MAX_CHUNK = 2048    # raw bytes per otaWrite: the pod's maxChunk (3072) capped here


class OtaError(RuntimeError):
    def __init__(self, code: str, message: str = ""):
        self.code = code
        self.message = message
        self.aborted = None     # set by ota_steps: True / False once otaAbort was sent, None if no update was open
        super().__init__(f"{code}: {message}" if message else str(code))


def load_image(path: str) -> bytes:
    data = Path(path).read_bytes()
    if not data:
        raise ValueError(f"{path} is empty")
    return data


def ota_supported(info: dict) -> bool:
    return "ota" in info.get("features", [])


def _ok(response: dict) -> dict:
    if not response.get("ok"):
        raise OtaError(response.get("error") or "error", response.get("message") or "")
    return response


def ota_steps(image: bytes, activate: bool = True, progress=None):
    """otaBegin, otaWrite chunks, otaEnd and (if activate) otaActivate. progress(done, total) after each step."""
    size = len(image)
    opened = False
    try:
        begin = _ok((yield ("otaBegin", {"size": size, "sha256": hashlib.sha256(image).hexdigest()})))
        opened = True
        offset = begin["received"]      # > 0: an earlier, unfinished upload of this image is resumed
        complete = offset == size       # nothing to write: an earlier run may have verified it already
        chunk = min(begin.get("maxChunk", MAX_CHUNK), MAX_CHUNK)
        if progress:
            progress(offset, size)
        while offset < size:
            part = image[offset:offset + chunk]
            reply = _ok((yield ("otaWrite", {"offset": offset, "data": base64.b64encode(part).decode("ascii")})))
            if reply["received"] != offset + len(part):
                raise OtaError("bad_response", f"otaWrite answered received {reply['received']}, "
                                               f"expected {offset + len(part)}")
            offset = reply["received"]
            if progress:
                progress(offset, size)
        # otaEnd is refused in `ready` (an earlier --no-activate verified it): ask the state first
        ready = complete and _ok((yield ("status", {}))).get("ota", {}).get("state") == "ready"
        if not ready:
            _ok((yield ("otaEnd", {})))
        if not activate:
            return "verified"
        _ok((yield ("otaActivate", {})))
        opened = False
        return "activated"
    except Exception as error:
        if opened:
            try:
                reply = yield ("otaAbort", {})
                error.aborted = bool(reply.get("ok"))
            except Exception:
                error.aborted = False
        raise error


def run_sync(steps, request):
    """Drives ota_steps over request(op, fields) -> response dict; a transport exception goes into the generator."""
    try:
        step = next(steps)
        while True:
            try:
                reply = request(*step)
            except Exception as error:
                step = steps.throw(error)
            else:
                step = steps.send(reply)
    except StopIteration as done:
        return done.value


async def run_async(steps, request):
    """run_sync for an async request(op, fields) (BLE)."""
    try:
        step = next(steps)
        while True:
            try:
                reply = await request(*step)
            except Exception as error:
                step = steps.throw(error)
            else:
                step = steps.send(reply)
    except StopIteration as done:
        return done.value


class Progress:
    """Prints a line every 5 % of the image (and at 100 %): bytes, elapsed time and speed since this run started."""

    def __init__(self, emit=print):
        self.emit = emit
        self.next_pct = 0
        self.start = None
        self.base = 0

    def __call__(self, done: int, total: int):
        if self.start is None:
            self.start, self.base = time.time(), done
        pct = done * 100 // total
        if done < total and pct < self.next_pct:
            return
        self.next_pct = (pct // 5 + 1) * 5
        elapsed = time.time() - self.start
        speed = f"  {(done - self.base) / 1000 / elapsed:.1f} kB/s" if elapsed > 0 and done > self.base else ""
        self.emit(f"  {pct:3d} %  {done:>8} / {total} bytes  {elapsed:5.1f} s{speed}")

    @property
    def elapsed(self) -> float:
        return time.time() - self.start if self.start else 0.0


def failure_lines(error: OtaError) -> list:
    lines = [f"update failed: {error.code}: {error.message}"]
    if error.aborted is True:
        lines.append("the open update was aborted (otaAbort)")
    elif error.aborted is False:
        lines.append("could not abort: the update stays open on the pod; the same command resumes it")
    return lines


def result_lines(before: str, info: dict) -> tuple:
    """(lines, exit code) after the restart: firmware, running slot, outcome of the last otaActivate."""
    ota = info.get("ota") or {}
    lines = [f"info.firmware {info.get('firmware')}",
             f"info.ota.running {ota.get('running')} (before: {before})",
             f"info.ota.lastResult {ota.get('lastResult')}"]
    return lines, (1 if ota.get("lastResult") == "rolledBack" else 0)
