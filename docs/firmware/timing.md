# Timing

*Measured* = ADR 0005 test (3 pods, 3 × 30 min, 2026-10-29) or the fw 2.12 soak (central + 1 peripheral,
phone, 30 min). Everything else is an estimate.

Time bases: `esp_timer_get_time()` µs per pod (link, clock sync, button edges, reaction times); `millis()`
same clock in ms (block delays and timeouts); **network time** = the central's `esp_timer`, peripherals
convert with their `ClockSync` offset.

## 1. Loop rules

- `loop()` → `RoleManager::run()`. Central: `button.update()`, `network.service()` (tx results, retries,
  rx frames → claims, PONG, events), `BlockManager::run()`. Peripheral: button, link, state machine. ESP-NOW
  callbacks (WiFi task) only queue frames + rx timestamps.
- **No blocking calls in the game path.** Only the 2 s boot gauge and the 0.5 s pairing-clear flash block.
- **Idle wait** (fw ≥ 2.14): in idle states (peripheral UNCLAIMED/READY, central MENU/CONFIRM/ERROR) the loop
  waits ≤ 1 ms for a frame (`EspNowLink::idleWait`, peek on the rx queue, wakes at once). **Never idle:**
  peripheral SCHEDULED/ACTIVE/HOLDING/DONE, central DISCOVERY/RUN/PAUSED; a frame that arms an activation
  leaves idle in the same pass. Effects run on esp_timer / clock time, independent of the wait.
- Outside idle states the loop spins; the radio always receives. ≈ 1 h battery is the accepted trade-off.
- LEDs are written only on change (`LEDManager::present()`), so a peripheral pass takes µs. While a smooth
  effect runs on an armed pod a press may be seen ≤ one `show()` (~0.6 ms) later; the reaction still counts
  from the first LED update.
- Logging: `CONFIG_LOG_MAXIMUM_LEVEL=3` (INFO; `ESP_LOGD/V` compiled out); no print per pass, only per
  event and one `RESULT`/`SUMMARY` line per measurement. Lower the level further for timing measurements.

| Situation | Pass time |
|---|---|
| peripheral waiting | a few µs |
| pass with an LED change (`show()`, 18 LEDs ≈ 0.54 ms + latch) | ~0.6–1 ms |
| effect running: unchanged frame / new frame (≤ every 16 ms) | µs / ~0.6–1 ms |
| central RUN, block chain | ~0.6–1 ms per LED block (≤ 32 blocks) |
| idle state | 0–1 ms |
| central RUN, *measured* longest gap | 7.6 ms without BLE; 15–17 ms with a phone (gaps > 10 ms ≈ 4/min; one core shared with BLE) |

## 2. Constants

| Where | Constant | Value |
|---|---|---|
| PeripheralRole | HELLO / PING interval | 250 ms / 200 ms |
| | central timeout → UNCLAIMED | 2 s without PONG |
| | pairing reset | hold 3 s while unclaimed |
| PodNetwork | pod timeout → PAUSED | 1.5 s without frames |
| | claim timeout | 0.5 s |
| EspNowLink | tx timeout, retries, queue | link-protocol §3 |
| ClockSync | window | 8 samples (1.6 s), min delay |
| `remoteMultiPress`, `toggle`, `effect` | `syncStartMs` default | 20 ms |
| `main.cpp` | boot gauge | 2000 ms |
| `AutoPowerOff` | idle time / goodbye | 10 min (`AUTO_POWER_OFF_MINUTES`) / 1200 ms |
| `Battery.cpp` | sampling | 16 × `analogReadMilliVolts` every 3000 ms |
| `ErrorAnimation.h` | blink | 1000 ms on / off |
| `LEDManager` | `MIN_FRAME_US`, default period | 16 ms, 1000 ms |
| menu (`runModelSelector`) | short press / dead zone / long press | release ≤ 1.0 s / 1.0–1.8 s / held > ~1.8 s |
| `Input/Button` | debounce lockout | 20 ms after each accepted edge (first edge at once) |
| `button` block | `shortMs` | 1000 ms |
| `lib/loop.json` | pause after `MAX_LOOPS` rounds | 3000 ms |
| `lib/multi.json` | pause between rounds / red flash | 3000 / 1000 ms |
| `solo.json` | random wait / result display | 800–5000 / 2500 ms |

## 3. Reaction-time measurement

- **Peripheral:** ARM (or scheduled start) → `setLEDColors(colorActive)` (~0.6 ms) → `t0` → first press edge
  → `reaction = press − t0` (µs, in PRESSED). `t0` is within ~0.3 ms of the visible change (WS2812 latch);
  polling adds well under 1 ms. Accuracy ≈ ±0.5 ms; the radio does not affect it.
- **Central:** `button` with `record` measures press − block entry, entered right after the LED block in the
  same pass (≤ ~1 ms). `remoteMultiPress` measures from its synchronised lighting.
- **Holds** (fw ≥ 2.9): measured on the pod from edge timestamps. `heldMs` = release − press (a release
  within the 20 ms lockout is not seen). Signal reaction = release − LED update to `goColor`
  (`HoldSession::doSwitch`). The central sees PRESSED / RELEASED a few ms later; `trigger` leaves the block at
  that receive time; hold timeouts run on the central's clock.

## 4. Latency between pods

*Measured:* 0 of 60 000 frames lost or retried (with and without phone); ack round trip `ackUsAvg` 1.6–1.8 ms,
max 10.7 ms. Estimates: central decides < 0.1 ms; air ~0.5–2 ms each way; peripheral pickup + LEDs ≤ ~1 ms;
a retry + ~1–3 ms.

- Remote press → next remote pod lit (random mode): ≈ 2–5 ms. Remote press → central lit (star): ≈ 1–3 ms.
- Synchronous start (RUN modes, `syncStartMs` 20 ms), *measured:* clock offset jitter ≈ 0.9 ms (worst
  1.1 ms), no late ARM in 1 564 starts (every ARM ≥ 9.7 ms early), latest peripheral LED start 2.7 ms (no
  phone) / 3.7 ms (phone) after schedule. A late ARM lights late but measures from its own onset.

### 4.1 The central's own ring (fw ≥ 2.12)
`LEDManager::playEffect` arms a one-shot esp_timer for a future start (esp_timer task; LED output guarded
by a mutex), so the central's first frame is on time instead of up to one loop gap late (before: estimated
spread 9.3 ms without / 18.8 ms with phone). Later frames come from the loop (≤ every 16 ms). Blocks with
a synchronous start (`remoteMultiPress`, `toggle`, `effect`, `delay` countdown) arm it on enter. Still to
confirm with a logic analyser (testing §8, #24).

## 5. Set-up

Program selected → ESP-NOW up ≈ 0.2–0.5 s; per peripheral ≤ 250 ms (next HELLO) + a few ms, claims
sequential; 7 peripherals ≈ 1–2 s until green. First PING right after the claim.

## 6. Open measurements and risks

- Open: total start spread incl. the central on a logic analyser (#24, testing §8); reaction accuracy (LED
  data line vs button line vs `RESULT`). Done: loss, ack round trip, clock jitter, ARM margins, loop gaps,
  BLE soak (min free heap 80 KB, 100 ms interval, no disconnect).
- Loss check: `status.pods[].link` (`txLost`, `txRetries`, `ackUsAvg`, `ackUsMax`) over 30 min.
- 2.4 GHz congestion adds retries and jitter; the channel is fixed (`ESPNOW_CHANNEL`).
- No direct pod-to-pod trigger: every pod → pod step goes through the central (2 hops, ~1–2 ms extra).
