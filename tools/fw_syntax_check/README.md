# Firmware host syntax check

Compiles the firmware `.cpp` files with the host `g++` (`-std=gnu++17 -fsyntax-only -Wall -Wextra`) against
stub headers, so that syntax and type errors show up without PlatformIO (seconds instead of a 4 min build).

```sh
python3 tools/fw_syntax_check/check.py                       # all of firmware/src, exit code 1 on errors
python3 tools/fw_syntax_check/check.py firmware/src/Block/LEDBlock/LEDBlock.cpp   # single files
python3 tools/fw_syntax_check/check.py -j 8 -v               # 8 parallel jobs, list OK files too
```

Needs only `g++` (13 tested) and Python 3.

- `stubs/` holds Arduino core (`Arduino.h`, `WString.h`, `Print.h`, `HWCDC.h`), ESP-IDF 4.4 (`esp_*.h`, `freertos/`),
  classic BLE (`BLEDevice.h` and aliases), `SPIFFS.h` / `FS.h`, `Preferences.h`, `WiFi.h` and `Adafruit_NeoPixel.h`.
- `stubs/ArduinoJson.h` is the real single-header release 7.4.2 (MIT, from the GitHub release), the version that
  `firmware/platformio.ini` resolves `^7.4.2` to. Update it together with `lib_deps`.
- Files that mention `REACTPOD_BLE_ESPNOW_TEST` are checked a second time with that flag (env `BleEspNowTest`).
- A missing name or signature in a stub is a stub gap: fix the stub, not the firmware. Add only what the firmware uses.

Limits: names and signatures only, no linking, no runtime behaviour. The host is 64-bit (`int64_t` is `long`, `uint32_t` is
`unsigned int`), so `-Wformat` warnings about `%lld` / `%lu` can differ from the RISC-V build. `sdkconfig` macros and
Arduino core version differences (espressif32@6.10.0) are not modelled; the real build stays the final check.
