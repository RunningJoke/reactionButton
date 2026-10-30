# Firmware host syntax check

Compiles `firmware/src/*.cpp` with the host `g++` (`-std=gnu++17 -fsyntax-only -Wall -Wextra`) against stub
headers: syntax and type errors in seconds instead of a 4 min PlatformIO build. Needs `g++` (13 tested) and
Python 3.

```sh
python3 tools/fw_syntax_check/check.py                    # all of firmware/src, exit 1 on errors
python3 tools/fw_syntax_check/check.py firmware/src/Block/LEDBlock/LEDBlock.cpp
python3 tools/fw_syntax_check/check.py -j 8 -v            # 8 jobs, list OK files too
```

- `stubs/`: Arduino core, ESP-IDF 4.4, classic BLE, SPIFFS / FS, Preferences, WiFi, Adafruit NeoPixel.
  `stubs/ArduinoJson.h` is the real 7.4.2 single header (MIT), the version `^7.4.2` resolves to: update it
  with `lib_deps`.
- A missing name or signature is a stub gap: fix the stub, not the firmware; add only what the firmware uses.
- Limits: names and signatures only, no linking or runtime. Host types differ (`int64_t` = `long`,
  `uint32_t` = `unsigned int`), so `-Wformat` warnings can differ from RISC-V; `sdkconfig` macros and
  espressif32@6.10.0 core differences are not modelled. The real build stays the final check.
