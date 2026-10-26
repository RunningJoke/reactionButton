#!/usr/bin/env python3
"""Host syntax check for the ReactPod firmware (no PlatformIO needed).

Runs `g++ -std=gnu++17 -fsyntax-only -Wall -Wextra` on firmware .cpp files against stub
headers (tools/fw_syntax_check/stubs/) that stand in for Arduino, ESP-IDF, FreeRTOS, BLE,
Adafruit_NeoPixel, SPIFFS, WiFi and Preferences. ArduinoJson is the real single-header
release (MIT, version in stubs/ArduinoJson.h, pinned like firmware/platformio.ini).

Usage:
    python3 tools/fw_syntax_check/check.py                  # all of firmware/src
    python3 tools/fw_syntax_check/check.py firmware/src/Block/LEDBlock/LEDBlock.cpp ...
    python3 tools/fw_syntax_check/check.py -j 8 -v

Exit code 0: no errors (warnings are printed). 1: at least one file has errors.
Stub gaps: improve the stubs, never the firmware. The stubs only cover names and
signatures that the firmware uses; they do not check runtime behaviour, sdkconfig
macros or the exact ESP-IDF / Arduino versions (espressif32@6.10.0). Warnings that come
from the host (for example int vs. long for uint32_t) can differ from the xtensa/riscv build.
"""
import argparse
import concurrent.futures
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SRC = ROOT / "firmware" / "src"
STUBS = HERE / "stubs"
FLAGS = ["-std=gnu++17", "-fsyntax-only", "-Wall", "-Wextra", "-DARDUINO=10812",
         "-Wno-unused-parameter",   # ESP-IDF builds with -Wno-unused-parameter too
         "-DESP_PLATFORM=1", "-DARDUINO_ARCH_ESP32=1", "-DCONFIG_IDF_TARGET_ESP32C3=1"]


def check(job):
    cpp, extra = job
    cmd = ["g++", *FLAGS, *extra, "-I", str(STUBS), "-I", str(SRC), str(cpp)]
    p = subprocess.run(cmd, capture_output=True, text=True)
    return cpp, extra, p.returncode, p.stderr


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", help=".cpp files (default: all under firmware/src)")
    ap.add_argument("-j", type=int, default=4, help="parallel jobs")
    ap.add_argument("-v", action="store_true", help="list OK files too")
    a = ap.parse_args()
    files = [pathlib.Path(f).resolve() for f in a.files] or sorted(SRC.rglob("*.cpp"))
    # files with hooks for the env:BleEspNowTest build are checked a second time with its flag
    jobs = []
    for f in files:
        jobs.append((f, []))
        if "REACTPOD_BLE_ESPNOW_TEST" in f.read_text(errors="replace"):
            jobs.append((f, ["-DREACTPOD_BLE_ESPNOW_TEST"]))
    bad = warn = 0
    with concurrent.futures.ThreadPoolExecutor(a.j) as ex:
        for cpp, extra, rc, err in ex.map(check, jobs):
            rel = str(cpp.relative_to(ROOT) if cpp.is_relative_to(ROOT) else cpp)
            if extra:
                rel += " [" + " ".join(extra) + "]"
            if rc != 0:
                bad += 1
                print(f"FAIL {rel}\n{err}")
            elif err.strip():
                warn += 1
                print(f"WARN {rel}\n{err}")
            elif a.v:
                print(f"ok   {rel}")
    print(f"\n{len(files)} files ({len(jobs)} runs), {bad} with errors, {warn} with warnings")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
