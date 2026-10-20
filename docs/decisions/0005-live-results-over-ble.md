# 0005 Live results over BLE during the game

Date: 2026-10-20 · Status: proposed (waiting for the hardware test #38)

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

## Decision (proposed)

**A**, if the hardware test #38 meets all of these criteria (testing.md §8.8):

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

Filled in from `tools/ble_espnow_test.py` (summary JSON of each run, files attached to #38).
Runs and method: testing.md §8.4–§8.7.

| Value | 1 dreieck off | 3 dreieck phone | 4 run off | 6 run phone |
|---|---|---|---|---|
| firmware commit / flash use % | | | | |
| distances, WiFi networks, PC adapter | | | | |
| `txLost` (total) | | | | |
| `txRetries` (total), per 1000 frames | | | | |
| `ackUsAvg` / `ackUsMax` (worst pod) | | | | |
| minimum free heap / largest block | | | | |
| PAUSED / restarts | | | | |
| BLE disconnects (game / at select) | – | | – | |
| negotiated connection interval | – | | – | |
| ping round trip avg / p95 / max | – | | – | |
| load lines lost, load delay p95 / max | – | | – | |
| indication timeouts, lines dropped | – | | – | |
| longest central loop gap | | | | |
| late ARMs, offset jitter | – | – | | |
| start spread (analyser max / p95, or estimate) | – | – | | |

Optional runs (advertise only, 15 ms / 100 ms interval, Android phone) go into extra columns.
The interval chosen for #39: … ms, because …

## Consequences

- **A accepted:** #39 implements `liveBle` as in the test build: no `PhoneConfig::stop` on select,
  advertising stops while connected and restarts on disconnect, the chosen long interval after
  select, the short interval back in the menu, indications from their own task, `busy` for file
  changes during a game, `heap` and `ble` in `status`. Update link-protocol.md §6, architecture.md §5.2,
  config-api.md §1 and timing.md (measured values). The other sub-issues of #37 are unblocked.
- **Fallback (B + C):** #37 is changed from "live" to "per cycle". The app shows reports after
  each cycle / session. The reboot on `stop` must go (the app has to reconnect anyway). The
  training view and athlete assignment stay; remote control during a running cycle is dropped.
- Either way, the test build (`BleEspNowTest`, `src/TestHw/`) is removed or folded into #39 once
  the decision is accepted. It is never released.
