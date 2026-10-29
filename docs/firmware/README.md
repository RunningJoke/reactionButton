# ReactPod – Firmware Documentation

ReactPods are battery-powered, BLE-connected reaction buzzers (round pods with an
18-LED ring and one large push button). Several pods form a *set*: one pod acts as
**CENTRAL** (runs the game program) and the others act as **PERIPHERALS** (light up,
detect a press, report back).

This folder documents firmware **2.0**: JSON game programs and an ESP-NOW link between
the pods. It started from commit `70389a6` (BLE firmware 1.x).

| Document | Content |
|---|---|
| [architecture.md](architecture.md) | Hardware, build setup, module structure, boot flow, state machines, block engine |
| [link-protocol.md](link-protocol.md) | ESP-NOW pod link: frames, reliability, pairing, clock sync, recovery, phone BLE config |
| [timing.md](timing.md) | Loop structure, all timing constants, latency chain, reaction-time measurement accuracy |
| [game-modes.md](../user/game-modes.md) | Current capabilities: the 8 programs, their block graphs and LED codes |
| [programs.md](programs.md) | **How to write programs**: JSON format, all block types, measurements, adding new block types |
| [config-api.md](config-api.md) | **Configuration API** (BLE + USB serial): programs upload / download, status, select / start, sync to all pods |
| [testing.md](testing.md) | **Flashing, log monitor and guided tests over USB** |
| [known-issues.md](../archive/known-issues.md) | Code review findings: bugs, risks and limitations (with file/line references) |
| [improvement-plan.md](../archive/improvement-plan.md) | Concrete, prioritized work packages to improve the firmware |
| [roadmap.md](../archive/roadmap.md) | Milestones from "stable" to "programmable platform" |

Other files in this folder:

- `anleitung.pdf` / `anleitung.sla` – user manual (German, Scribus source)
- `renderingBuzzer.png`, `renderingOnOff.png` – renderings used in the manual

## Quick facts

| Item | Value |
|---|---|
| MCU | ESP32-C3 (single-core RISC-V, 160 MHz), board `esp32-c3-devkitm-1` |
| Framework | PlatformIO, `framework = arduino, espidf` (Arduino as ESP-IDF component) |
| Pod link | ESP-NOW on WiFi channel 1, up to 7 peripherals per set |
| Phone | BLE (Bluedroid), central only, during the program menu |
| LEDs | 18 × WS2812 (NeoPixel, GRB, 800 kHz) on GPIO 7 |
| Button | GPIO 3, active LOW (external pull-up assumed, `pinMode INPUT`) |
| Battery sense | GPIO 5, ADC (`analogReadMilliVolts`) through a 1:1 divider R6 / R7 (2 × 100 k), see `Battery/` (firmware 2.13) |
| Libraries | Adafruit NeoPixel ^1.12.0, ArduinoJson ^7.4.2 |
| Max set size in shipped programs | 5 pods (1 central + 4 peripherals) |
| Firmware limit | 7 peripherals (`CentralRole::MAX_PERIPHERALS`) |

## Building & flashing

```sh
python tools/validate_programs.py   # check the JSON programs in firmware/data/
pio run -d firmware -e NewBoard                 # build
pio run -d firmware -e NewBoard -t upload       # flash firmware via USB (USB-CDC, usb_reset)
pio run -d firmware -e NewBoard -t uploadfs     # flash firmware/data/ (programs) to SPIFFS - needed on the central
python tools/reactpod_serial.py wait-boot   # then press RESET when asked (pod stays in download mode)
python tools/reactpod_serial.py monitor     # log + events, type commands
```

After flashing, the pod usually needs a manual RESET (or power cycle) to start. See
[testing.md](testing.md) for the guided test.

Game programs live in `firmware/data/` and are **not** part of the firmware image. Install them with
`uploadfs`, or upload them over BLE (`python tools/reactpod_config.py push firmware/data`, see
[config-api.md](config-api.md)). A central without programs shows the red error blink and
waits for an upload. The pods of a set share their programs automatically.

Firmware 2.0 is not compatible with 1.x (BLE). Update all pods of a set together.

`sdkconfig.NewBoard` holds the ESP-IDF configuration (BLE connection count etc.).
Changes to BLE limits must be made there (`pio run -d firmware -t menuconfig`).
