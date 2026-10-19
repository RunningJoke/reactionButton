# ReactPod – guide for agents

ESP32-C3 reaction buzzers (18-LED ring, one button). A **set** = one **central** (runs the
game program, configured over BLE or USB) + **peripherals** (ESP-NOW). Firmware, app and tools
are versioned together; one branch may touch all of them. Overview: [README.md](README.md),
workflow details: [CONTRIBUTING.md](CONTRIBUTING.md).

## Map – read the spec before changing a part

| Folder | What | Spec |
|---|---|---|
| `firmware/` | PlatformIO, `arduino, espidf`; programs in `firmware/data/` (SPIFFS) | [architecture](docs/firmware/architecture.md), [programs](docs/firmware/programs.md) (§6 format revisions, §7 engine), [config-api](docs/firmware/config-api.md), [link-protocol](docs/firmware/link-protocol.md), [testing](docs/firmware/testing.md) |
| `app/` | React + TS PWA on Pages: https://runningjoke.github.io/reactionButton/ | [spec](docs/app/spec.md) (§4 layout, §13 phases), [acceptance tests](docs/app/acceptance-tests.md) |
| `tools/` | `reactpod_config.py` (BLE), `reactpod_serial.py` (USB), `validate_programs.py` | config-api |
| `hardware/` | KiCad PCB, FreeCAD casing | – |
| `docs/decisions/` | ADRs: layout, versioning + OTA delivery, community platform | – |
| `docs/archive/` | CR-0…CR-7, old roadmap / known issues / improvement plan – history only | – |

## Commands (from the repo root; pio is in `~/.platformio/penv/Scripts/`)

```sh
pio run -d firmware -e NewBoard                                  # build (≈4 min clean); check the "Flash:" line (≈80 %)
pio run -d firmware -e NewBoard -t upload   --upload-port COM4
pio run -d firmware -e NewBoard -t uploadfs --upload-port COM4   # programs
python tools/validate_programs.py
python tools/reactpod_serial.py --port COM4 monitor              # log + JSON API over USB
cd app && npm test && npx tsc                                    # before every app commit
```

## Flows

- **Work:** issue (form, `type:` + `area:` labels) → branch `feat|fix|chore|docs/<topic>` →
  PR with "Closes #n" → CI green → `gh pr merge <n> --squash`. Commit and push only when the
  user asks. Stacked branches: PR against the parent branch, retarget after it is merged.
- **Firmware API or block semantics change:** skill `/fw-api-change`.
- **The app needs a firmware change:** skill `/fw-request`. The app must work without it:
  check `info`, a missing field means the old behaviour.
- **Bug in the other part:** open an issue (`type: bug`); fix it only if the user asks.
- **Release:** skill `/release` (tags `fw-v*` / `app-v*`; workflows build and publish).
- **App phases** (spec §13): the user approves each phase. Mark acceptance tests "pass" only
  when the user reported them as passed.

## Rules

- Firmware: never set `ARDUINO_USB_CDC_ON_BOOT` / `ARDUINO_USB_MODE`; never toggle DTR/RTS
  over USB (resets the C3, maybe into download mode); check flash usage after adding code.
- App: mobile first (≥ 44 px targets, nothing drag-only, works at 360 px); colours from
  `app/src/app/theme.css`; every UI text in `en.json` and `de.json`; check UI changes in a
  real browser (`npm run build && npm run preview`, then `app/scripts/screenshots.mjs`).
- The demo pod (`app/src/pod/simulated/`) and the simulator (`app/src/simulator/engine.ts`)
  behave like the firmware. Change both sides together.
- Windows: `core.autocrlf` is on (CRLF working copy, LF in the repo); LF warnings on `git add`
  are fine. Pods get CRLF programs, Pages bundles LF; the app compares JSON content, so only
  CRCs differ.
