# Testing with USB

This guide covers flashing a pod, watching its log, and running a guided test with
[tools/reactpod_serial.py](../../tools/reactpod_serial.py). The tool talks to the pod's
built-in USB serial port (the same cable used for flashing). The commands it sends are
described in [config-api.md](config-api.md).

## 1. Preparation (once)

```sh
pip install pyserial
```

- Use a normal terminal (PowerShell, cmd, macOS/Linux shell).
  In **Git Bash** on Windows, prefix commands that contain paths with `MSYS_NO_PATHCONV=1`.
  Otherwise Git Bash turns `/prog/duo.json` into `C:/Program Files/Git/prog/duo.json`.
- Close other serial monitors (`pio device monitor`, Arduino IDE). Only one program can
  use the port.
- `--port COM4` is optional. Without it, the first Espressif USB port is used.

## 2. Flash a pod

```sh
pio run -d firmware -e NewBoard -t upload --upload-port COM4     # firmware
pio run -d firmware -e NewBoard -t uploadfs --upload-port COM4   # program files (firmware/data/)
```

**After flashing, the pod usually stays in download mode** and does not start by
itself. Then:

```sh
python tools/reactpod_serial.py --port COM4 wait-boot
```

The tool waits for the pod and tells you when to **press RESET** (not BOOT) or switch the
pod off and on. As soon as the pod runs, it prints role, state, firmware, store
generation and the *last reset* reason.

Firmware 2.x pods only talk to each other if all of them run the same protocol version,
so flash every pod of the set.

## 3. Watch the log

```sh
python tools/reactpod_serial.py --port COM4 monitor --log pod.log
```

Shows everything the pod prints:

| Shown as | Meaning |
|---|---|
| grey lines `I (1234) TAG: ...` | firmware log |
| `[boot] central firmware 2.0, last reset: power-on` (green) | the pod started |
| `[boot] ... last reset: panic during step 'select: radio start'` (red) | the pod restarted after a crash; the step shows where |
| `[state] CONFIRM pods 1/1 /prog/duo.json` (blue) | central state change |
| `RESULT,...` / `SUMMARY,...` | measured reaction times |
| yellow `>>>` lines | something to do by hand (e.g. press RESET) |

You can type commands while monitoring, for example `status`, `programs`, `select 8`,
`start`, `press`, `results`, `trace on`, `help`. Responses are printed in cyan. `quit`
ends the monitor. `--log` keeps everything in a file. Send that file along when you
report a problem.

If the port disappears (pod restarted, cable), the monitor waits and continues automatically.

## 4. Single steps

| Command | What it does |
|---|---|
| `status` | role, state, program, peripherals with MAC and link statistics, last reset |
| `reboot central` / `reboot peripheral` | restart in that role, without holding the button. If the pod does not restart by itself, the tool asks you to press RESET; the role is kept for that start |
| `programs` | the menu (index, name, path, peripherals) |
| `select 8` / `select /prog/duo.json` / `select Duo` | choose a program (central, in the menu) |
| `start` | start it (all peripherals connected) |
| `press` | simulate the button of the pod on USB |
| `stop` | end the program, back to the menu (the pod restarts) |
| `push firmware/data` / `pull backup` | upload / download all program files |
| `results` | statistics of the recorded metrics |
| `trace on` | report every block the program enters (for automated tests) |

Example (central on COM4, a peripheral switched on):

```sh
python tools/reactpod_serial.py --port COM4 reboot central
python tools/reactpod_serial.py --port COM4 select /prog/duo.json
python tools/reactpod_serial.py --port COM4 status        # shows the connected peripheral
python tools/reactpod_serial.py --port COM4 start
python tools/reactpod_serial.py --port COM4 monitor       # watch the results
```

## 5. Guided test

```sh
python tools/reactpod_serial.py --port COM4 --log test.log test --program /prog/duo.json --auto-press
```

What happens, and what you do:

| Step | The tool | You |
|---|---|---|
| 1 connect | waits until the pod answers | press RESET if asked (e.g. right after flashing) |
| 2 central in menu | restarts the pod as central if needed | press RESET if it does not restart by itself |
| 3 programs | checks that the program exists and validates it | — |
| 4 connect peripherals | selects the program, waits for the peripherals | switch the peripheral on (yellow), press Enter |
| 5 run | starts the program (after Enter), prints each result | press the **peripheral** when it lights green. With `--auto-press` the central's presses are simulated; without it, press the central too |
| 6 report | prints connection data, link statistics, reaction times, misses | — |

At the end you get `ALL PASSED` or the list of failed checks. The pod returns to the
program menu (`--keep-running` leaves it in the game).

Useful options:

| Option | Effect |
|---|---|
| `--push firmware/data` | upload the program files from `firmware/data/` first (e.g. after changing a JSON file) |
| `--rounds 6` | stop after 6 results instead of waiting for the summary |
| `--yes` | no Enter prompts (unattended; manual steps must already be done) |
| `-v` | also show the firmware log |
| `--log FILE` | write everything to a file |

The Duo program ([data/prog/duo.json](../../firmware/data/prog/duo.json)) needs one peripheral.
Central and peripheral take turns, each after a random 0.5–2 s pause. A target not
pressed within 5 s counts as a miss. After 10 rounds a summary is printed.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `waiting for download` in the log | download mode: press RESET (not BOOT) or power-cycle |
| no output at all after flashing | same as above; `wait-boot` guides you |
| `[boot] ... last reset: panic during step '...'` | crash; send the log file and the step name |
| pod comes back as **peripheral** after `select` | it restarted (crash or reset); see the `[boot]` line |
| peripheral never connects | is it yellow? Same firmware? Paired with another set: hold its button 3 s while yellow (white flash) |
| `could not open port` / permission | another program uses the port; close it |
| program not found | upload programs: `pio run -d firmware -t uploadfs` or `--push firmware/data` |

## 7. Note on the serial port (firmware detail)

With `framework = arduino, espidf` the Arduino core is built without
`ARDUINO_USB_CDC_ON_BOOT`, so `Serial` is UART0 (GPIO 20/21) and not the USB port. The
firmware therefore uses its own USB console object (`Console`,
[src/Config/Console.h](../../firmware/src/Config/Console.h)), which also receives the ESP-IDF log
output. Do not add `ARDUINO_USB_CDC_ON_BOOT`/`ARDUINO_USB_MODE` to `platformio.ini`.
With "arduino, espidf" they only reach `src/`, so `Serial` would mean two different
objects. Crash dumps of the panic handler still go to UART0; the `[boot]` line with
reset reason and last step replaces them for normal use.

## 8. BLE connected while ESP-NOW runs (#38, done)

The hardware test #38 ran on 2026-10-29 with a separate test build and script. Its results and
the decision are in [ADR 0005](../decisions/0005-live-results-over-ble.md) (accepted). The test
build (`BleEspNowTest`, `src/TestHw/`) and `tools/ble_espnow_test.py` were removed afterwards;
they are in the git history (commits c33a87f and 461f7e4) if the test has to be repeated.

What carries over to testing #39 (live BLE):

- All pods must belong to the same set: the central only claims peripherals with its own set id
  or none (`status` shows `setId`). A peripheral of another set stays yellow and the game hangs
  in DISCOVERY. Clear its pairing: while yellow, hold the button 3 s (white flash).
- With BLE on, ESP-NOW runs with WiFi modem sleep (`WIFI_PS_MIN_MODEM`, `EspNowLink::begin`).
- Start spread: measure it with a logic analyser on the WS2812 data line (GPIO 7) of the central
  and two peripherals, ≥ 1 MHz, the first LED frame after the 3 s pause of `run` per round,
  ≥ 50 rounds, with and without a phone connected. Pass: < 5 ms.
- The Windows PC's Bluetooth adapter can stop seeing BLE devices after a while; switch Bluetooth
  off and on.

## 9. Hold blocks (`charge`, `release`), firmware ≥ 2.9

Checks for the `charge` and `release` blocks with the demo programs `charge.json` and `release.json`
(one central + one peripheral, both with firmware ≥ 2.9; `status.pods[0].hold` must be `true`).
Not yet run on hardware: record the results in the issue (#57 / #58), do not mark them passed here.

| # | Check | Expected |
|---|---|---|
| 1 | `charge`, central, each style (`fill`, `brightness`, `trafficLight`, `colorShift`): hold the button | ring follows the charge after `onsetMs`; release → `released`, `CENTRAL_CHARGE` = hold − onset |
| 2 | same on pod 0 (`"pod": 0`) | same behaviour, ring animates on the pod |
| 3 | hold shorter than `onsetMs` | port `early` (falls back to `released` if unconnected), charge 0 |
| 4 | hold until full | ring flashes, block leaves through `full` at once, no reset of the flash |
| 5 | `timeoutMs` with `countdown` | idle ring counts down, a hold stops it; `timeout` after the limit |
| 6 | `accumulate` with `decayMs` on pod 0 | release freezes / drains the ring visibly, hold again goes on; full or `timeout` ends; `POD_CHARGE` set |
| 7 | held ms from pod 0 vs a stopwatch (`record` + `RESULT` line) | within ± 5 ms |
| 8 | `release` trigger: hold pod 0 before the block starts (`allowHeld`), then release | `next` at the release, `HOLD_MS` set; `noHold` and `maxHoldMs` paths work |
| 9 | `release` signal: release after the switch | reaction within ± 2 ms of a `remotePress` measurement (timing.md §3); release 1 ms before the switch → `falseStart` |
| 10 | peripheral with firmware ≤ 2.8 in the set | `charge` / `release` on it take `timeout` at once; the log has "cannot measure holds" |

## 10. Toggle block, firmware ≥ 2.10

Checks for the `toggle` block with the demo program `domination.json` (one central + two peripherals, all with
firmware ≥ 2.10; `status.pods[].toggle` must be `true`). Not yet run on hardware: record the results in the issue
(#59), do not mark them passed here.

| # | Check | Expected |
|---|---|---|
| 1 | start of the game | central and both pods light at the same moment: red, blue, red (alternate, central last) |
| 2 | press a pod | its ring flips at once; the variable `FLIPS` counts it |
| 3 | 60 s game with 4 pods (set `durationMs`, `pods`), a video count of the owner changes | `RED_PODS` / `BLUE_PODS` at the end and `RED_MS` / `BLUE_MS` match the video (± 1 flip, ± 50 ms per flip) |
| 4 | press a pod several times within `cooldownMs` | only the first press flips |
| 5 | make all pods one colour with `allA` / `allB` connected; then with them unconnected | the block leaves through `allA` / `allB`; unconnected: the game goes on to `next` |
| 6 | press a pod after the block ended (in the "Show" delay) | its colour does not change |
| 7 | `countdown` (e.g. `drain`) with a flip in the middle | the animation goes on in the new colour, it does not restart |
| 8 | peripheral with firmware ≤ 2.9 in the set | it is left out of the game; the log has "cannot toggle" |
| 9 | block `toggle` with `start: "off"` | all rings dark until pressed; the first press makes a pod A |

## 11. Live over BLE (`reactpod_config.py live`, firmware ≥ 2.12)

`live` keeps the BLE connection open through a game (config-api.md §1): it prints the `state`
and `report` events, fetches and acknowledges the reports (also after a reconnect) and reads keys
from the terminal. It needs `pip install bleak`; no USB cable is needed.

```sh
python tools/reactpod_config.py live                          # first ReactPod found; keys: ? shows the status
python tools/reactpod_config.py --name "ReactPod 91c2" live --auto --athlete ath_42
```

- Start the central in the menu (button held during boot), select a program, start the game.
  The connection must stay. A `[connection] lost` line means it did not (firmware < 2.12 drops it
  when a program is selected; `live` warns on connect in that case).
- Keys: `c` continue, `r` repeat, `s` stop, `p` pause, `u` resume, `v NAME=VALUE ...` setVariables,
  `a NAME` athlete (`a` alone clears it), `?` status, `q` quit.
- `--auto` answers every waiting `communicate` block with `continue`: use it for soak tests.
- After a dropped connection `live` scans again by `--name` / `--address` and fetches the
  reports that are still unacknowledged on the pod.
- Unit tests of the parser, the formatting and the fetch + ack sequence, without hardware:
  `python tools/test_reactpod_config.py`.

## 12. Release checklist (before every `fw-v*` tag)

Run on the release build, flashed to every pod of a set (`-t upload` and `-t uploadfs`). The
`/release` skill links here. Note the date, firmware, pods and result of each line in the release
PR. Automated lines: `python tools/reactpod_hwtest.py --central COM3 --peripheral COM4 --peripheral COM5`
(§12.1).

| # | Check | Pass | Automated |
|---|---|---|---|
| 1 | USB serial: 150 `status` requests at 0.3 s on each pod | 0 timeouts (#74) | yes |
| 2 | Every shipped program: select, discovery, start | DISCOVERY → CONFIRM → RUN within 30 s, no ERROR | yes |
| 3 | A full set (as many pods as available, up to 7) joins | all pods claimed, central green | partly (pods on USB) |
| 4 | Pause / resume from the phone, also with a pod lost during the pause | config-api.md "Pause and resume" | yes |
| 5 | Power-cycle a peripheral mid-game | PAUSED, then RUN within 10 s after it is back | yes (USB reboot) |
| 6 | Cycle report of a shipped program, over USB and BLE | report with the cycle metric; `--auto` continues | yes (USB), BLE with `live --auto` |
| 7 | 30 min soak per mode (`run`, `dreieck`, one hold program) with `reactpod_config.py live --auto` | no BLE disconnect, `status.pods[].link.txLost` 0, minimum free heap > 40 KB, no restart | no |
| 8 | Two sets in one room, both running | no pod joins the other set, no PAUSED caused by the other set | no |
| 9 | Battery run-down from full on one pod (firmware with battery monitoring) | runtime ≥ 1 h, low-battery warning before the pod switches off | no |
| 10 | Start spread on a logic analyser (§8) after changes to the link, clock sync or LED timing | < 5 ms with and without a phone | no |
| 11 | App against the release: connect over BLE and USB, push, restore defaults, training view | as in the app acceptance tests | no |
| 12 | Auto power-off (#21): an unclaimed pod and a central in the menu without a phone sleep after `AUTO_POWER_OFF_MINUTES` (10; use a build with 1 for a quick check). Goodbye drain, `sleep` event on serial, a press wakes it into a normal boot (gauge, role). A claimed pod and a central with a phone never sleep | sleep and wake as described; a central in DISCOVERY is not put to sleep | no (manual) |

### 12.1 `reactpod_hwtest.py`

Needs the central and at least one peripheral of the same set on USB (`pip install pyserial`).
It reboots the central into the menu and runs lines 1, 2, 4, 5 and 6 (USB part), prints PASS /
FAIL per check and exits with 1 on any failure. Peripherals are taken out by rebooting them as
central and brought back as peripheral; it puts every pod back into its original role at the end.
`--quick` skips line 6 (a cycle takes about 2 min).
