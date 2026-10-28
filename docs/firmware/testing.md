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

## 8. Hardware test: BLE connected while ESP-NOW runs (#38)

Question: can the central keep a phone connected over BLE during the game (epic #37) without
hurting the game? The numbers go into [ADR 0005](../decisions/0005-live-results-over-ble.md).

### 8.1 Test firmware

PlatformIO env `BleEspNowTest` = `NewBoard` + build flag `REACTPOD_BLE_ESPNOW_TEST`
([src/TestHw/BleEspNowTest.h](../../firmware/src/TestHw/BleEspNowTest.h)). The `NewBoard` build
does not change. Only in the test build:

- `select` / long press keeps BLE on (`keepBle`, default on), ESP-NOW starts as usual.
  Advertising stops while a client is connected and restarts after a disconnect, also in the game.
- About 1 s after a connect during the game, the central requests a connection interval of
  `intervalMs` (default 75 ms).
- The config API stays available over BLE in every state. A separate task sends the
  indications, so the game loop never waits for a confirmation.
- While a client is connected, `{"event":"load","seq":…,"t":…,"pad":"…"}` lines of `loadBytes`
  are sent every `loadPeriodMs` (stand-in for one live report per round).
- `status` has `testBuild`, `heap {free, minFree, largest}`, on the central also
  `ble {on, connected, intervalMs, latency, timeoutMs}` and `bleTest {…}`: connects/disconnects,
  indication results, queue and send times, longest loop pass gap (`loopGapUsMax`).
  On peripherals, `bleTest` counts scheduled ARMs that arrived late (`lateArms`), the smallest lead
  before the start time (`armLeadUsMin`) and how late the LEDs went on (`startLateUsMax`).
- Op `bleTest` (USB or BLE): `{"op":"bleTest","keepBle":true,"intervalMs":75,"loadBytes":1024,
  "loadPeriodMs":2000,"reset":true,"brief":false}`. All fields are optional, and the values reset
  on every restart. The script sets them.

Never release this build. Flash `NewBoard` again when the test is done.

### 8.2 What you need

- **3 pods** (1 central + 2 peripherals; `dreieck` and `run` each need 2 peripherals), all
  charged, plus 3 USB data cables (and a hub, or extension cables for the distance).
- A Windows PC with Bluetooth LE. It plays the phone. Note the adapter (built-in / dongle).
- `pip install pyserial bleak`
- Optional: a logic analyser with ≥ 3 channels and ≥ 1 MHz for the start spread (§8.5). Without
  one, the script gives an estimate.
- Optional: an Android phone with nRF Connect (§8.6).

### 8.3 Flash and set up

Use PowerShell (in Git Bash put `MSYS_NO_PATHCONV=1` in front of commands with `/prog/...`).
For **each pod** (COM port of that pod):

```sh
pio run -d firmware -e BleEspNowTest                                     # once; note the flash use in %
pio run -d firmware -e BleEspNowTest -t upload   --upload-port COM4
pio run -d firmware -e BleEspNowTest -t uploadfs --upload-port COM4      # programs, if not current
python tools/reactpod_serial.py --port COM4 wait-boot                    # press RESET if asked
python tools/reactpod_serial.py --port COM4 status                       # must show "testBuild": "bleEspNowTest"
```

Set up:

1. Central (COM4 in the examples) on the table, the PC 1–2 m away.
2. The peripherals at **3–5 m** from the central (as far as the USB cables reach), line of sight,
   about 1 m high. Write the distances down.
3. Note the 2.4 GHz environment: `netsh wlan show networks` (number of networks), place, time.
4. Close every other serial monitor. Switch the peripherals on normally (no button held: yellow).
   The script restarts the central into the program menu itself.

### 8.4 Runs

Each run takes 30 minutes plus about 1 minute to set up. The script selects and starts the
program, simulates every press (central through `trace`, peripherals when they light up), and in
the end returns the central to the menu (the pod restarts). Between two runs, wait until the
peripherals are yellow again. Example for run 3:

```sh
python tools/ble_espnow_test.py --port COM4 --peripheral-port COM5 --peripheral-port COM6 --program /prog/dreieck.json --mode phone --minutes 30 --out results/3-dreieck-phone --log results/3-dreieck-phone.log
```

| Run | `--program` | `--mode` | Needed |
|---|---|---|---|
| 1 | `/prog/dreieck.json` (remotePress) | `off` (BLE off at select, as today) | yes: baseline |
| 2 | `/prog/dreieck.json` | `advertise` (BLE on, nobody connected) | recommended |
| 3 | `/prog/dreieck.json` | `phone` (PC connected, ping 1/s, 1 KB per 2 s) | yes |
| 4 | `/prog/run.json` (remoteMultiPress, `syncStartMs` 20 ms) | `off` | yes: baseline |
| 5 | `/prog/run.json` | `advertise` | recommended |
| 6 | `/prog/run.json` | `phone` | yes |
| 7 | `/prog/run.json` | `phone --interval-ms 15 --minutes 10` (short interval = more BLE air time) | optional: worst case |
| 8 | `/prog/run.json` | `phone --interval-ms 100 --minutes 10` | optional: choice of the interval for #39 |

Do not move the pods between runs. If a run is disturbed (someone unplugs a cable, the PC goes to
sleep), repeat it. Set the PC so it does not sleep for the whole test.

What the script prints every minute: free heap, PAUSED count, results, BLE pings and disconnects.
At the end it prints the summary and `PASS`/`FAIL` per criterion and writes:

| File | Content |
|---|---|
| `<out>-summary.json` | all numbers below + checks |
| `<out>-central.csv` | 1/s: heap, BLE connection + interval, indication queue / times, loop gaps |
| `<out>-links.csv` | every 10 s, per pod: `txFrames`, `txRetries`, `txLost`, `ackUsAvg`, `ackUsMax`, … |
| `<out>-peripherals.csv` | 1/s per peripheral: clock offset, late ARMs, start error |
| `<out>-ble.csv` | each ping (round trip), load line (seq, delay), connect / disconnect |
| `<out>-events.csv` | state changes (PAUSED!), restarts, results |

### 8.5 Start spread with a logic analyser (runs 4–6)

1. Connect the WS2812 data line (GPIO 7) of the central and of both peripherals to three channels,
   and all grounds together. Sample at ≥ 1 MHz.
2. In `run`, every round starts after a 3 s pause (`lib/multi.json`), so the start frame is the
   first LED frame after a gap of more than 2.5 s on each channel.
3. Measure the time between the earliest and the latest start frame per round, for ≥ 50 rounds,
   in run 4 and in run 6. Write down the maximum and the 95th percentile.

Without an analyser, the summary gives `startSpreadEstimateMs` = 2 × clock offset jitter +
the latest LED start. It is a rough upper bound, not a measurement. The ADR must say which one was used.

### 8.6 Optional: Android phone

The PC's Bluetooth stack is not a phone. For a 10 min run with a real phone, run
`--mode advertise` and connect the phone by hand **before** `select` (nRF Connect: connect to
"ReactPod xxxx", enable indications on `…90b2`). The phone then gets the load lines. In
`<out>-central.csv` check `ble_connected` and `ble_interval_ms` (the interval the phone accepted).
When the config app supports it, repeat this with the PWA.

### 8.7 What to record

Copy the table into ADR 0005 (one column per run) and attach the `results/` folder to #38.

| Value | Where |
|---|---|
| date, firmware commit, flash use %, distances, WiFi networks, PC BT adapter | by hand |
| `txLost`, `txRetries` (total and per pod), `ackUsAvg`, `ackUsMax` | summary `espnow` |
| minimum free heap, largest free block | summary `heap` |
| PAUSED count, restarts | summary |
| BLE disconnects (in the game / at select), negotiated interval | summary `bleClient`, `ble` |
| ping round trip avg / p95 / max, load lines lost, load delay p95 / max | summary `bleClient` |
| indication timeouts, lines dropped, `txSendUsMax` | summary `central` |
| longest loop gap, gaps > 2 ms / > 10 ms | summary `central` |
| late ARMs, `armLeadUsMin`, offset jitter, `startLateUsMax` | summary `peripheralClock` |
| start spread: analyser max / p95, or the estimate | §8.5 |

### 8.8 Pass / fail (from #38)

| Criterion | Runs | Pass |
|---|---|---|
| no frame lost | every run | `txLost` = 0 over 30 min |
| synchronous start | 4–6 | start spread < 5 ms (analyser; estimate only if none is available) and `lateArms` = 0 |
| memory | 3, 6 | minimum free heap > 40 KB |
| no PAUSED caused by the phone | 3, 6 | PAUSED = 0. If a phone run pauses, check if the baseline pauses as well; repeat both |

Also record these for the decision; they are not pass criteria of #38: BLE stays connected
(0 disconnects, including at `select`), no load line lost, `txRetries` and `ackUsAvg` of the phone run
compared with the baseline, ping round trip, longest loop gap.

All criteria pass → ADR 0005 "accepted" (option A), go on with #39. A criterion fails → try once
with `--interval-ms 100`. If it still fails, use the fallback in the ADR.

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
