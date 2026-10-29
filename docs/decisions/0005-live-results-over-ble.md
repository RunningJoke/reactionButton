# 0005 Live results over BLE during the game

Date: 2026-10-20 · Status: accepted, 2026-10-29 (hardware test #38; condition: the central's own start is scheduled, see Decision)

## Context

Epic #37 wants the phone (PWA, Android) to get each program's measurements live, assign the
athlete and send commands during the game. Today the central switches BLE off when a program is
selected (`PhoneConfig::stop`, link-protocol.md §6): BLE and ESP-NOW never run at the same time.

Known before the test:
- Espressif's coexistence table for the ESP32-C3 lists ESP-NOW TX as supported and ESP-NOW RX as
  stable in STA mode with BLE connected. The pods run STA, `sdkconfig.NewBoard` has SW coexistence on.
- Bluedroid is already linked (menu), so keeping it costs no flash, only RAM while it runs.
- Only the central shares its radio. Peripheral reaction times are measured on the peripheral,
  and the central's own button is a GPIO; neither goes over the air.
- Unknown: free heap with both stacks, the effect on ARM/RESET delivery, retries and clock sync
  (`syncStartMs` of `remoteMultiPress`), and whether the BLE link itself stays up.
- Found while preparing the test: `PhoneConfig::sendLine` indicates in the main loop and waits for
  every confirmation (up to one connection interval per MTU-sized piece, 1 s timeout). With a long
  interval during a game, that would stall the game loop by 100s of ms. The test build therefore
  sends indications from a separate task. Any live-BLE firmware must do the same.

## Options

| | Option | Live | Extra hardware | Risk |
|---|---|---|---|---|
| A | **BLE stays connected on the central during the game** (#39 `liveBle`): long connection interval in the game, indications from a separate task, file changes `busy` | yes | none | radio sharing on the central: retries, start skew, heap |
| B | **Reports after the game**: the central keeps reports in RAM; BLE comes back in the menu (after `stop`, or in PAUSED / between cycles) and the app fetches them | no (per cycle / per session) | none | needs a reboot-free return to the menu; coach waits for results |
| C | **Reports over USB**: PC tools read `RESULT` lines / a `results` op over USB serial | yes, but PC only | cable | Android Chrome has no Web Serial: not usable for the PWA |
| D | Separate ESP32 bridge dongle | yes | yes | rejected in #37 (extra hardware) |
| E | WiFi AP on the central | yes | none | rejected in #37 (phone loses internet, `ws://` blocked in an HTTPS PWA) |

## Decision

**A**, with a 100 ms connection interval and peripheral latency 0, on the condition that #39
also schedules the central's own ring at the start time (see *Findings*). The criteria of
the hardware test #38 (testing.md §8.8):

| Criterion | Pass |
|---|---|
| ESP-NOW frames lost | `txLost` = 0 over 30 min, `dreieck` and `run`, with the phone connected |
| multi-pod start spread (`run`, `syncStartMs` 20 ms) | < 5 ms, no late ARM |
| minimum free heap, both stacks running | > 40 KB |
| PAUSED caused by the phone | none |

If a criterion fails, retry once with a 100 ms interval. If it still fails: **B** for the PWA
(reports stay in RAM, 8 as in #37, fetched in the menu), and **C** for the PC tools. The
`communicate` block of #37 then only marks report boundaries and continues on press or
timeout. It does not wait for the app.

## Measurements

From `tools/ble_espnow_test.py` (summary JSON and CSV of each run; the `results/` folder is
attached to #38). 3 pods (central + 2 peripherals on USB), test firmware `BleEspNowTest` at
1655761 (68.9 % flash), PC with a Realtek Bluetooth 5.0 adapter as the phone, interval 100 ms,
2026-10-29. Distances and WiFi networks were not recorded. No logic analyser: the start spread
is the script's estimate.

| Value | 4 run off | 6 run phone | 3 dreieck phone |
|---|---|---|---|
| duration | 30 min | 30 min | 30 min |
| ESP-NOW frames / `txLost` / `txRetries` | 20 320 / 0 / 0 | 20 420 / 0 / 0 | 20 021 / 0 / 0 |
| `ackUsAvg` / `ackUsMax` (worst pod) | 1.6 / 6.1 ms | 1.8 / 10.2 ms | 1.7 / 10.7 ms |
| minimum free heap / largest block | 137 KB / 116 KB | 73 KB / 62 KB | 73 KB / 62 KB |
| PAUSED / restarts | 0 / 0 | 0 / 0 | 0 / 0 |
| BLE disconnects (game / at select) | – | 0 / 0 | 0 / 0 |
| negotiated connection interval | – | 100 ms | 100 ms |
| ping round trip avg / p95 / max | – | 227 / 502 / 800 ms | 219 / 488 / 793 ms |
| load lines lost, load delay p95 / max | – | 0, 309 / 834 ms | 0, 307 / 520 ms |
| indication timeouts, lines dropped | – | 0, 0 | 0, 0 |
| longest central loop gap; gaps > 2 ms / > 10 ms | 7.6 ms; 3 191 / 0 | 17.1 ms; 7 595 / 137 | 15.0 ms; 8 789 / 139 |
| late ARMs, offset jitter (worst pod) | 0 of 770, 0.89 ms | 0 of 794, 0.88 ms | –, 1.10 ms |
| latest peripheral LED start | 2.7 ms | 3.7 ms | – |
| start spread estimate | 9.3 ms¹ | 18.8 ms | – |

¹ The summary of run 4 printed 4.48 ms: the central's last status came too late and the loop gap
was left out. With the logged 7.6 ms it is 2 × 0.89 + 7.6 = 9.3 ms.

Short runs (2 min, same setup): `dreieck` off and phone (75 ms) all passed; `run` phone with
peripheral latency 4 (100 ms): loop gaps > 10 ms 49 instead of 9, ping round trip avg 839 ms,
one ping timeout. Run 1 (`dreieck` off, 30 min) was replaced by the 2 min run and run 4.

### Findings

- **ESP-NOW is not affected.** No frame lost or retried in 60 000 frames, ack times barely change.
  The peripherals' clock sync is the same with and without the phone (jitter about 0.9 ms) and
  every scheduled ARM arrives at least 9.7 ms before its start.
- **Memory:** both stacks leave 73 KB free (largest block 62 KB). Bluedroid costs about 64 KB.
- **BLE holds:** no disconnect in 60 min, nothing lost. Round trips up to 0.8 s: fine for
  reports and `command`, not for per-press live display.
- **The central's loop:** with the phone connected, gaps > 2 ms double and gaps of 10–17 ms appear
  (about 4 per minute). The ESP32-C3 has one core, and the BLE controller and host run on it.
- **Start spread:** the criterion fails as an estimate, also without the phone. The peripherals
  start on their scheduled time (≤ 3.7 ms late). The central lights its own ring when its loop
  next sees the start time (`RemoteMultiplePressBlock::execute`), so it is late by up to one loop
  gap: 7.6 ms without BLE, 17 ms with BLE. Scheduling the central's start with a timer, like the
  peripherals, removes this term for both cases. Confirm with a logic analyser after #39.
- **Peripheral latency does not help:** skipped connection events make the BLE work come in
  longer bursts (more gaps > 10 ms) and slow the link down. Use latency 0.
- **WiFi power save:** with Bluetooth enabled, ESP-NOW must run with modem sleep
  (`WIFI_PS_MIN_MODEM`); `WIFI_PS_NONE` aborts the WiFi driver. With no AP connection the radio
  still receives ESP-NOW frames (all runs above use it).
- **Windows:** the PC's Realtek adapter once stopped seeing any BLE device between runs; switching
  Bluetooth off and on fixed it. Not a pod issue.

The interval chosen for #39: **100 ms**, latency 0, because 75 ms and 100 ms give the same game
results, 100 ms gives the radio to ESP-NOW more often, and the round trip stays under 1 s.

## Consequences

- **A accepted:** #39 implements `liveBle` as in the test build: no `PhoneConfig::stop` on select,
  advertising stops while connected and restarts on disconnect, 100 ms interval and latency 0
  after select, the short interval back in the menu, indications from their own task, `busy` for
  file changes during a game, `heap` and `ble` in `status`, ESP-NOW with modem sleep while BLE is
  on. Also: the central's own ring starts at the scheduled time (timer, not the loop) in
  `remoteMultiPress` and the other blocks with a synchronous start, and the reports from #41 are
  sent as BLE indications (a full `reports` answer is about 20 KB: page it). Update link-protocol.md §6, architecture.md §5.2,
  config-api.md §1 and timing.md (measured values). The other sub-issues of #37 are unblocked.
- **Fallback (B + C):** #37 is changed from "live" to "per cycle". The app shows reports after
  each cycle / session. The reboot on `stop` must go (the app has to reconnect anyway). The
  training view and athlete assignment stay; remote control during a running cycle is dropped.
- Either way, the test build (`BleEspNowTest`, `src/TestHw/`) is removed or folded into #39 once
  the decision is accepted. It is never released.
