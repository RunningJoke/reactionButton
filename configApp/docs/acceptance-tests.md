# Acceptance tests – Config App v1

Test procedures on real hardware. Each test lists its setup, its steps and the expected
result. Record the result (pass / fail, browser + version, firmware version, notes) in the
table at the end.

**Standard setup:** a set of at least 3 pods (1 central + 2 peripherals), charged, firmware
2.0. The central is in the program menu (switch it on and hold the button during the blue
boot animation). Desktop Chrome with a USB-C cable, and an Android phone with Chrome.

Before a test session: run `python tools/reactpod_serial.py` → `info` to note the
generation and store hash.

---

## S – USB serial (desktop Chrome)

| ID | Steps | Expected |
|---|---|---|
| AT-S1 | Plug in the central (in the menu), app → Pod → USB, pick the port | connected, **the pod does not reset** (no boot animation), `info` shown |
| AT-S2 | Same with a peripheral | connected, role "peripheral" shown, push / restore / delete disabled (read-only) |
| AT-S3 | Unplug the cable while connected | app shows "disconnected" within 2 s, no frozen UI |
| AT-S4 | Open Settings → Advanced → debug console | firmware log lines appear, separate from API responses |


## B – BLE (Android Chrome, desktop Chrome)

Needs firmware with change request CR-0 (`doc/changerequest/config-app-api.md` on the firmware branch). Without it the app connects, then reports "The pod did not answer" (timeout).

| ID | Steps | Expected |
|---|---|---|
| AT-B1 | App → Pod → Bluetooth | chooser lists "ReactPod Config", connecting works, `info` shown |
| AT-B2 | Central not in the menu (game running) | the app does not find it and shows the hint how to open the menu |
| AT-B3 | Read all programs of the default set | completes. Note the duration and the MTU |
| AT-B4 | Select a program on the pod (long press) while connected | app shows "disconnected" (BLE off), no data loss locally |
| AT-B5 | Two centrals in the menu at the same time | user can tell them apart (depends on CR-1, record what is shown) |

## P – Sync and push

| ID | Steps | Expected |
|---|---|---|
| AT-P1 | Fresh pod with default programs, connect | all files "in sync" or "pod only", library read-only |
| AT-P2 | Create a new program in the app (2 peripherals, uses preset `loop`), add it to the menu, push | plan shows program + `/programs.json`; upload ok; `validate` ok; the pod menu shows the new pattern |
| AT-P3 | Select the new program on the pod with all pods on, play it | it behaves like in the simulator |
| AT-P4 | Then switch on a pod of the set that was off during P2, start a program | the new program spreads to it (check with `list` over serial) |
| AT-P5 | Edit a program, push a version with a type error (forced through serial / test hook) | app shows the pod's `invalid_program` message on the right block |
| AT-P6 | Change a program on the pod via `tools/reactpod_config.py` and in the app, connect | conflict shown, "keep pod" and "keep mine" both work |
| AT-P7 | Push while the central runs a game (serial) | `busy` explained, nothing half written (old file intact, CRC unchanged) |
| AT-P8 | Upload a program with umlauts in name / description (`Übung`) | CRC ok, file identical when read back |
| AT-P9 | Restore defaults on a pod with a user program | default menu restored, user program file still present (`list`) |
| AT-P10 | Delete a file via Settings → Advanced | needs the extra confirmation, library and menu are not offered |

## M – Simulator (no hardware needed, compare with hardware)

| ID | Steps | Expected |
|---|---|---|
| AT-M1 | Simulate `duo.json`, press the pods as they light | central + 1 peripheral shown, current block highlighted, metric `reaction` and `MISSES` update |
| AT-M2 | Step mode through `dreieck.json`, 3 rounds | every entered block is shown one by one, `SELECTED` never repeats |
| AT-M3 | `run5.json`, press a red pod | `avoidHit` → `Fail` path |
| AT-M4 | Same seed twice | identical block sequence |
| AT-M5 | Compare: run `solo.json` on the pod with `trace on` (serial) and in the simulator with the same presses | same block sequence |

## U – Usability and platform

| ID | Steps | Expected |
|---|---|---|
| AT-U1 | (once hosted) Phone, airplane mode, open the installed PWA. Before hosting: desktop, `npm run preview`, DevTools offline, reload | app works, local programs, editor and simulator available |
| AT-U2 | Phone (360 px wide): create a 5-block program without drag and drop | possible, nothing cut off |
| AT-U3 | Switch language de ↔ en | all texts translated, no missing keys |
| AT-U4 | iPhone Safari | editor + simulator work, connecting explains that Bluetooth needs the app |
| AT-U5 | Compare the menu pattern of each program in the app (Programs list) with the pod's menu | same LEDs lit at the same positions. The app assumes LED 0 at the top, clockwise; if not, tell the developer the position of LED 0 and the direction |
| AT-U6 | Programs: open every shipped program and the 4 library parts, tap blocks | graphs readable on a phone, block details match the JSON file |

---

## Results

| ID | Date | Device / browser | Firmware | Result | Notes |
|---|---|---|---|---|---|
| AT-S1 | 2026-10-18 | desktop Chrome / Edge, USB | 2.0 | pass | reported by Patrick Stähle |
| AT-S2 | 2026-10-18 | desktop Chrome / Edge, USB | 2.0 | pass | reported by Patrick Stähle |
| AT-S3 | 2026-10-18 | desktop Chrome / Edge, USB | 2.0 | pass | reported by Patrick Stähle |
| AT-S4 | 2026-10-18 | desktop Chrome / Edge, USB | 2.0 | pass | reported by Patrick Stähle |
| AT-B1 … AT-B5 | – | – | 2.0 | blocked | waits for firmware CR-0 |
