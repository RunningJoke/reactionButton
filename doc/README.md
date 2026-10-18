# ReactPod – Firmware Documentation

ReactPods are battery-powered, BLE-connected reaction buzzers (round pods with an
18-LED ring and one large push button). Several pods form a *set*: one pod acts as
**CENTRAL** (runs the game program) and the others act as **PERIPHERALS** (light up,
detect a press, report back).

This folder documents the firmware in `src/`, based on commit `70389a6`
("switched framework for support of up to 7 buzzers") plus the rework of the block
system to JSON programs.

| Document | Content |
|---|---|
| [architecture.md](architecture.md) | Hardware, build setup, module structure, boot flow, state machines, block engine |
| [ble-protocol.md](ble-protocol.md) | GATT service, characteristics, message sequences between central and peripherals |
| [timing.md](timing.md) | Loop structure, all timing constants, latency chain, reaction-time measurement accuracy |
| [game-modes.md](game-modes.md) | Current capabilities: the 8 programs, their block graphs and LED codes |
| [programs.md](programs.md) | **How to write programs**: JSON format, all block types, measurements, adding new block types |
| [known-issues.md](known-issues.md) | Code review findings: bugs, risks and limitations (with file/line references) |
| [improvement-plan.md](improvement-plan.md) | Concrete, prioritized work packages to improve the firmware |
| [roadmap.md](roadmap.md) | Milestones from "stable" to "programmable platform" |

Other files in this folder:

- `anleitung.pdf` / `anleitung.sla` – user manual (German, Scribus source)
- `renderingBuzzer.png`, `renderingOnOff.png` – renderings used in the manual

## Quick facts

| Item | Value |
|---|---|
| MCU | ESP32-C3 (single-core RISC-V, 160 MHz), board `esp32-c3-devkitm-1` |
| Framework | PlatformIO, `framework = arduino, espidf` (Arduino as ESP-IDF component) |
| BLE stack | Bluedroid (Arduino `BLEDevice` wrapper), up to 8 ACL connections configured |
| LEDs | 18 × WS2812 (NeoPixel, GRB, 800 kHz) on GPIO 7 |
| Button | GPIO 3, active LOW (external pull-up assumed, `pinMode INPUT`) |
| Battery sense | GPIO 5 (configured as input, **not read yet**) |
| Libraries | Adafruit NeoPixel ^1.12.0, ArduinoJson ^7.4.2 |
| Max set size in shipped programs | 5 pods (1 central + 4 peripherals) |
| Hardware limit by config | 7 peripherals + 1 phone connection (`CONFIG_BT_ACL_CONNECTIONS=8`) |

## Building & flashing

```sh
python tools/validate_programs.py   # check the JSON programs in data/
pio run -e NewBoard                 # build
pio run -e NewBoard -t upload       # flash firmware via USB (USB-CDC, usb_reset)
pio run -e NewBoard -t uploadfs     # flash data/ (programs) to SPIFFS - needed on the central
pio device monitor                  # 115200 baud, esp32_exception_decoder
```

Game programs live in `data/` and are **not** part of the firmware image. A central
without `uploadfs` has no programs and shows the red error blink.

`sdkconfig.NewBoard` holds the ESP-IDF configuration (BLE connection count etc.).
Changes to BLE limits must be made there (`pio run -t menuconfig`).
