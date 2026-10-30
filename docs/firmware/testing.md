# Testing over USB (and BLE)

Tool: `tools/reactpod_serial.py` (`pip install pyserial`) on the pod's USB port; ops are config-api §5.

## 1. Setup
- Close other serial monitors (one program per port). `--port COM4` is optional (default: first Espressif port).
- Git Bash: prefix commands with pod paths with `MSYS_NO_PATHCONV=1` (else `/prog/x` becomes a Windows path).

## 2. Flash
`pio run -d firmware -e NewBoard -t upload --upload-port COM4`, then `-t uploadfs`. The pod usually stays
in download mode: `reactpod_serial.py --port COM4 wait-boot` tells you when to press **RESET** (not BOOT)
and prints role, state, firmware, generation, last reset. Flash every pod of a set.

## 3. Monitor
`reactpod_serial.py --port COM4 monitor --log pod.log`: firmware log (grey), `[boot]` (green; red with
`panic during step '…'` after a crash), `[state]` (blue), `RESULT`/`SUMMARY`, yellow `>>>` = manual action,
responses cyan. Type ops (`status`, `programs`, `select 8`, `start`, `press`, `results`, `trace on`,
`help`); `quit` ends. Reconnects by itself after a reset. Attach the log to bug reports.

## 4. Single commands
`status` · `reboot central|peripheral` (asks for RESET if needed) · `programs` · `select 8|/prog/duo.json|Duo`
· `start` · `press` · `stop` (pod restarts) · `push firmware/data` / `pull backup` · `results` · `trace on` ·
`set-pin 1234`.

## 5. Guided test
`reactpod_serial.py --port COM4 --log test.log test --program /prog/duo.json --auto-press`: connects, makes
the pod central, validates the program, waits for the peripherals (switch them on, Enter), runs it (press the
peripheral when green; `--auto-press` simulates the central), reports link statistics, reaction times,
misses → `ALL PASSED` or the failed checks. Options: `--push firmware/data`, `--rounds 6`, `--yes`
(unattended), `-v` (firmware log), `--keep-running`. Duo: 1 peripheral, alternating, random 0.5–2 s, miss
after 5 s, summary after 10 rounds.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `waiting for download` / no output after flashing | RESET or power-cycle (`wait-boot`) |
| `[boot] … panic during step '…'` / pod comes back as peripheral after `select` | crash: send the log and the step |
| peripheral never joins | yellow? same firmware? same set (`status.setId`; else hold 3 s while yellow) |
| `could not open port` | another program holds it |
| program not found | `uploadfs` or `--push firmware/data` |
| PC stops seeing BLE devices | Windows adapter: Bluetooth off and on |

## 8. Start spread on a logic analyser (#24) – optional, not run
No logic analyser available; the spread is accepted as measured by the peripherals only (timing §4, §6).
Procedure if one becomes available: WS2812 data line (GPIO 7) of the central and two peripherals, ≥ 1 MHz, first LED frame after the 3 s pause
of `run` per round, ≥ 50 rounds, with and without a phone. Pass < 15 ms (relaxed from 5 ms for #24). All pods in one set; with BLE on
ESP-NOW uses modem sleep (ADR 0005).

## 9. Hold blocks (`charge`, `release`, fw ≥ 2.9) – not yet run on hardware
Demo programs `charge.json`, `release.json`, central + 1 peripheral, `status.pods[0].hold` true. Record
results in #57 / #58, do not mark them passed here.

| # | Check | Expected |
|---|---|---|
| 1 | `charge` on the central, each style | ring follows after `onsetMs`; release → `released`, `CENTRAL_CHARGE` = hold − onset |
| 2 | same with `"pod": 0` | same, animated on the pod |
| 3 | hold < `onsetMs` | `early` (→ `released`), charge 0 |
| 4 | hold until full | flash, `full` at once, flash not reset |
| 5 | `timeoutMs` + countdown | idle ring counts down, a hold stops it, `timeout` after the limit |
| 6 | `accumulate` + `decayMs` on pod 0 | release freezes / drains, holding again continues; full or timeout ends; `POD_CHARGE` set |
| 7 | held ms vs stopwatch | ± 5 ms |
| 8 | `release` trigger, held before the block (`allowHeld`) | `next` at release, `HOLD_MS` set; `noHold`, `maxHoldMs` paths work |
| 9 | `release` signal | reaction ± 2 ms of a `remotePress` measurement; release 1 ms before the switch → `falseStart` |
| 10 | peripheral fw ≤ 2.8 in the set | `timeout` at once, log "cannot measure holds" |

## 10. Toggle block (fw ≥ 2.10) – not yet run on hardware
`domination.json`, central + 2 peripherals, `status.pods[].toggle` true. Record results in #59.

| # | Check | Expected |
|---|---|---|
| 1 | game start | all light together: red, blue, red (alternate, central last) |
| 2 | press a pod | flips at once, `FLIPS` counts |
| 3 | 60 s, 4 pods, video count of owner changes | `RED_PODS`/`BLUE_PODS`, `RED_MS`/`BLUE_MS` match (± 1 flip, ± 50 ms per flip) |
| 4 | presses within `cooldownMs` | only the first flips |
| 5 | all one colour, `allA`/`allB` connected / unconnected | leaves via `allA`/`allB` / goes on to `next` |
| 6 | press after the block ended | no change |
| 7 | countdown + flip | animation continues in the new colour |
| 8 | peripheral fw ≤ 2.9 | left out, log "cannot toggle" |
| 9 | `start: "off"` | dark until pressed; first press → A |

## 11. Live over BLE (`reactpod_config.py live`, fw ≥ 2.12)
`pip install bleak`. `python tools/reactpod_config.py live` (first pod found) or `--name "ReactPod 91c2" live
--auto --athlete ath_42`. Keeps the connection through a game, prints `state` and `report`, fetches and
acks reports (also after a reconnect; rescans by `--name` / `--address`). Keys: `c` continue, `r` repeat,
`s` stop, `p` pause, `u` resume, `v NAME=VALUE …`, `a NAME` athlete (`a` clears), `?` status, `q` quit.
`--auto` answers every `communicate` with `continue` (soak tests). `[connection] lost` = the link dropped
(fw < 2.12 always drops at select; `live` warns). Unit tests: `python tools/test_reactpod_config.py`.

## 12. Release checklist (before every `fw-v*` tag)
Release build on every pod of a set (`upload` + `uploadfs`). Put date, firmware, pods and result of each
line in the release PR. Automated lines: `python tools/reactpod_hwtest.py --central COM3 --peripheral COM4
--peripheral COM5` (§12.1).

| # | Check | Pass | Auto |
|---|---|---|---|
| 1 | 150 `status` requests at 0.3 s on each pod (USB) | 0 timeouts (#74) | yes |
| 2 | every shipped program: select, discovery, start | DISCOVERY → CONFIRM → RUN ≤ 30 s, no ERROR | yes |
| 3 | a full set (up to 7) joins | all claimed, central green | partly |
| 4 | phone pause / resume, also with a pod lost during the pause | config-api "Two kinds of PAUSED" | yes |
| 5 | power-cycle a peripheral mid-game | PAUSED, RUN ≤ 10 s after it is back | yes |
| 6 | cycle report over USB and BLE | report with the cycle metric; `--auto` continues | USB yes, BLE `live --auto` |
| 7 | 30 min soak per mode (`run`, `dreieck`, a hold program) with `live --auto` | no BLE disconnect, `txLost` 0, min free heap > 40 KB, no restart | no |
| 8 | two sets in one room | no cross-joining, no PAUSED caused by the other set | no |
| 9 | battery run-down from full | ≥ 1 h, low-battery warning before power-off | no |
| 10 | start spread (§8), only with a logic analyser, after link / clock / LED timing changes | < 15 ms with and without phone | no |
| 11 | app against the release: BLE + USB, push, restore defaults, training view | as the app acceptance tests | no |
| 12 | auto power-off: unclaimed pod and phone-less central in MENU sleep after 10 min (build with 1 for a quick check), on battery / plain charger (a computer keeps it awake; over USB check `status.powerOff.idleMs` counts and resets on press / claim); drain, a press wakes into a normal boot; claimed pods, a central with phone or in DISCOVERY never sleep | as described | no |

### 12.1 `reactpod_hwtest.py`
Central + ≥ 1 peripheral of one set on USB. Reboots the central into the menu, runs lines 1, 2, 4, 5, 6 (USB),
PASS / FAIL per check, exit 1 on failure. Takes peripherals out by rebooting them as central and back;
restores every pod's role at the end. `--quick` skips line 6 (~2 min).
