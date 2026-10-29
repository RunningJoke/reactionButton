# Timing Structures

This document lists every place where the firmware deals with time: the main loop,
constants, the latency between pods, and how reaction times are measured.

Since firmware 2.0 the pods talk over **ESP-NOW** (see [link-protocol.md](link-protocol.md)).
Values marked *measured* come from the BLE + ESP-NOW hardware test of
[ADR 0005](../decisions/0005-live-results-over-ble.md) (3–4 pods on USB, 30 min runs, 2026-10-29) and the
firmware 2.12 soak (central + 1 peripheral, phone connected, 30 min). Everything else is an
**estimate** from the design; §6 lists what is still to measure.

Time bases:
- `esp_timer_get_time()`: µs since boot, per pod. Used for the link, clock sync, button edges and reaction times.
- `millis()`: the same clock in ms. Used by blocks for delays and timeouts.
- **Network time** = the central's `esp_timer`. Peripherals convert it with their
  `ClockSync` offset.

## 1. Execution model

```
Arduino loopTask (core 0)                         WiFi task (higher priority)
────────────────────────────────────────          ──────────────────────────────
loop() → RoleManager::run()                       ESP-NOW receive callback
  Central:    button.update()                       → copy frame + rx timestamp into rxQueue
              network.service()                   ESP-NOW send callback
                └ link.service(): tx results,       → tx status into txStatusQueue
                  retries, next frame per peer
                └ rx frames → claims, PONG, events
              BlockManager::run()
  Peripheral: button.update(), link.service(),
              rx frames → state machine
```

- **No blocking calls** in the game path. Delays, waiting for presses and waiting for
  radio frames all return to the loop. The only blocking spots are the 2 s boot animation
  and a 0.5 s white flash when pairing is cleared.
- **Effects** (firmware ≥ 2.8) are computed on each pod from the synchronised clock, so pods
  with the same start time change their LEDs in the same loop pass (± clock sync error).
  Without a running effect `LEDManager::service()` returns at once. While a smooth effect
  runs on an armed pod, a press can be seen up to one `show()` (~0.6 ms) later; the
  reaction time is still measured from the first LED update of the activation.
- **LEDs are only rewritten on changes.** The peripheral no longer refreshes its LEDs every
  pass, so its loop runs in the µs range and polls the button and the radio queue very often.
- **Busy loop**: `loop()` still never sleeps. WiFi power save is off, so the radio is
  always receiving. This trades battery for latency. A ~1 h runtime target is acceptable.

### 1.1 Typical loop pass duration

Measured on the central in RUN (ADR 0005): longest loop gap 7.6 ms without BLE; with the phone
connected 15–17 ms, gaps > 10 ms about 4 per minute (the BLE controller and host share the one core).
The table below is estimated.

| Situation | Dominant cost | Approx. pass time |
|---|---|---|
| Peripheral, idle / waiting for press | button read + empty queues | a few µs |
| Peripheral, pass with an LED change | one `NeoPixel::show()` (18 LEDs ≈ 0.54 ms + latch) | ~0.6–1 ms |
| Any pod, effect animating, frame unchanged | compute one frame (18 LEDs, a few colour scalings) | a few µs more |
| Any pod, effect animating, new frame | one `show()`, at most every 16 ms (smooth effects: `dim`, `colorShift`, `pulse`) | ~0.6–1 ms |
| Central, RUN, waiting block | button, `network.service()`, one `execute()` | µs range |
| Central, RUN, block chain | instant blocks in one pass (max 32), one `show()` per LED block | ~0.6–1 ms per LED block |
| Any `Serial.print` / `ESP_LOGx` | USB-CDC output (Arduino log level INFO, ESP-IDF INFO) | variable |

## 2. Constants

### 2.1 Link

| Where | Constant | Value | Effect |
|---|---|---|---|
| PeripheralRole | HELLO interval | 250 ms | discovery speed (unclaimed pods only) |
| | PING interval | 200 ms | heartbeat + clock sync sample rate |
| | central timeout | 2 s without PONG | back to UNCLAIMED |
| | pairing reset | hold 3 s while unclaimed | set id cleared |
| PodNetwork | pod timeout | 1.5 s without frames | game PAUSED |
| | claim timeout | 0.5 s | try the next HELLO |
| EspNowLink | tx timeout | 100 ms without send callback | counted as failed attempt |
| | retries | ARM/RESET/EFFECT 5, PRESSED 8, CLAIM 3, PING/PONG 0 | |
| | queue | 8 frames per peer | oldest non-sent frame dropped when full |
| ClockSync | window | 8 samples (1.6 s), min-delay sample used | |
| `remoteMultiPress` | `syncStartMs` | 20 ms (per block) | lead time for synchronous start |

### 2.2 User interaction

| Where | Constant | Value | Effect |
|---|---|---|---|
| `main.cpp` | boot battery gauge | 2000 ms, loop every 10 ms (static ring) | role decision at the end |
| `Battery.cpp` | battery sample | 16 × `analogReadMilliVolts`, refresh every 3000 ms | |
| `ErrorAnimation.h` | blink | 1000 ms on / 1000 ms off | |
| `LEDManager` | `MIN_FRAME_US` | 16 ms | minimum time between two effect frames |
| | default period | 1000 ms | `blink`, `pulse`, `spin` with `periodMs` 0 |
| `CentralRole::runModelSelector` | ramp step | counter +1 every ~10 ms while held | |
| | short press | release after ≤ 1.0 s | next program |
| | dead zone | release after 1.0 … 1.8 s | nothing |
| | long press | held > ~1.8 s | program selected |
| `Input/Button` | lockout | 20 ms after each accepted edge | debounce. The first edge is accepted immediately |
| `button` block | `shortMs` | default 1000 ms | short/long on release |

### 2.3 Programs (JSON, `firmware/data/prog/`)

| File | Constant | Value |
|---|---|---|
| `solo.json` | random wait / result display | 800 … 5000 ms / 2500 ms |
| `lib/loop.json` | blue pause after `MAX_LOOPS` rounds | 3000 ms |
| `lib/star.json`, `lib/random.json` | `EnterProgram` | 0 ms (no artificial gap) |
| `lib/multi.json` | pause between rounds / red flash | 3000 ms / 1000 ms |

## 3. Reaction-time measurement

### 3.1 On a peripheral

```
ARM arrives (or scheduled start time reached)
  → setLEDColors(colorActive)          LED data written (~0.6 ms)
  → t0 = esp_timer_get_time()          reference point: LEDs just updated
  ... user reacts ...
  button.update() sees LOW (first edge, then 20 ms lockout)
  → reaction = pressTimeUs - t0        sent in PRESSED (µs)
```

- **Reference point** is right after the LED data was sent, so it is within ~0.3 ms of
  the visible LED change (WS2812 latch). Earlier firmware started the timer one loop pass
  (~1 ms) before the LEDs changed.
- **Resolution**: the button is polled every pass. The peripheral loop is now in the µs
  range, so press detection adds well under 1 ms.
- **Accuracy overall**: about **±0.5 ms** (estimate). The radio does not affect it, because
  the time is measured locally.

### 3.2 On the central

The `button` block with a `pressed` port continues on the press edge. With `"record"` it
measures *press time − block entry time*. The block is entered in the same pass, right
after the LED block that lit the central, so the accuracy is similar (≤ ~1 ms).

`remoteMultiPress` measures the central's own reaction from the moment it lit its LEDs at
the synchronised start time.

### 3.3 Holds and releases (firmware ≥ 2.9)

The `charge` and `release` blocks measure on the pod that owns the button, from the button edge
timestamps (the same `Button` code as above), not from when a frame arrives:

- **Hold time** (`heldMs` in RELEASED) = release edge − press edge. Accuracy as a press: well under 1 ms plus the 20 ms
  debounce lockout after an edge (a release within 20 ms of the press is not seen).
- **Start reaction** (`release`, `signal`) = release edge − the moment the pod updated its LEDs to the go colour
  (`HoldSession::doSwitch`, reference point as in §3.1). A release before the switch time is a false start.
- The central sees PRESSED / RELEASED a few ms later (§4). The `trigger` mode leaves the block at the central's receive time of
  RELEASED, so a `timerStart` on the next block starts a few ms after the physical release, as for remote presses.
- Timeouts (`maxHoldMs`, signal `timeoutMs`, `noHold`) run on the central's clock and include that latency; the charge of an
  accumulating block at its time limit is taken on the pod.

## 4. Latency between pods

ESP-NOW frames are sent immediately; there is no connection interval to wait for.

Measured (ADR 0005): **0 of 60 000 frames lost or retried** in three 30 min runs, with and without a
phone. Ack round trip (send → ack received on the central, `ackUsAvg` / `ackUsMax`, worst pod)
**1.6–1.8 ms average, 10.7 ms maximum**. This round trip covers T2 + the peripheral's receive + the ack
back, so the estimates for T2 / R2 hold.

| Step | What happens | Estimate |
|---|---|---|
| T1 | Central loop decides (block chain in the same pass) | < 0.1 ms + LED shows of instant blocks |
| T2 | `esp_now_send` → air → peripheral receive callback (≤ 64 byte frame at 1 Mbit/s) | ~0.5–2 ms |
| T3 | Peripheral loop picks the frame up, updates LEDs | ≤ ~1 ms |
| R1 | Press edge → PRESSED sent | < 0.1 ms |
| R2 | Air → central receive callback | ~0.5–2 ms |
| R3 | Central loop: event → block → next ARM | < 0.1 ms + LED shows |
| retry | lost frame, resent after the failed send callback | + ~1–3 ms each |

**Remote press → next remote pod lit** (random mode): `R1 + R2 + R3 + T2 + T3` ≈ **2–5 ms**.
With BLE (firmware 1.x) this was estimated at ~60–200 ms.

**Remote press → central lit** (star mode): `R1 + R2 + R3` ≈ **1–3 ms**.

**Start skew in RUN modes**: all pods light at the same network time, `syncStartMs`
(20 ms) after the block started. Measured (ADR 0005): clock sync offset jitter about **0.9 ms**
(worst pod 1.1 ms), with and without the phone; no late ARM in 1 564 starts, every ARM arrived at least
9.7 ms before its start time; the latest peripheral LED start was **2.7 ms** (no phone) and **3.7 ms**
(phone) after the scheduled time. If an ARM needs so many retries that it arrives after the start time,
that pod lights late but measures correctly from its own LED onset. The total spread including the
central is not measured yet (§4.1, §6).

### 4.1 The central's own ring (firmware ≥ 2.12)

The central lights its ring from an esp_timer at the start time (`LEDManager::playEffect`
arms a one-shot timer for a future start; the timer runs in the esp_timer task). Before, the
central drew its first frame in the next loop pass, so with BLE on (loop gaps up to 17 ms,
[ADR 0005](../decisions/0005-live-results-over-ble.md) *Findings*) the start was up to one
loop gap late. The loop pass still draws the frames after the first one, at most every 16 ms.
The output is guarded by a mutex, because the loop and the timer both write the LEDs.
Blocks that light the central at a synchronous start (`remoteMultiPress`, `toggle`, `effect`,
`delay` countdown) arm it on enter, so the timer is set before the start time.

Measured values of the BLE + ESP-NOW test (ADR 0005, 3 pods, interval 100 ms): loop gaps > 10 ms about
4 per minute with the phone connected, longest gap 17 ms; central start lateness before this change
was the loop gap (up to 17 ms), so the estimated spread was 9.3 ms (no phone) and 18.8 ms (phone).
With the timer start the central's term should be gone; this is still to confirm on a logic analyser (§6).

## 5. Set-up timing

| Phase | Estimate |
|---|---|
| Program selected → radio up | ESP-NOW start (BLE stays on from firmware 2.12), ~0.2–0.5 s |
| Per peripheral | waits for its next HELLO (≤ 250 ms) + CLAIM/ACK (a few ms). Claims are sequential |
| 7 peripherals | ≈ 1–2 s until green |
| Clock synchronised | first PING right after the claim; several samples before a game starts |

Before, BLE needed 2 s scan windows plus about 0.5–2 s per connection.

## 6. How to verify on hardware

Done: frame loss, ack round trip, clock sync jitter, ARM margins and loop gaps (ADR 0005); BLE
through a 30 min game with heap and interval (firmware 2.12 soak: minimum free heap 80 KB, interval
100 ms, no disconnect). Still open: the total start spread on a logic analyser (step 2, #24) and the
reaction accuracy (step 3). Procedures: [testing.md](testing.md) §8.

1. **Link latency**: log `rxTimeUs` of PRESSED events against the central's ARM send
   time over a few hundred activations (CSV on serial). Or toggle a spare GPIO on ARM
   send (central) and on LED update (peripheral) and measure with a logic analyser.
2. **Start skew**: RUN5, connect the WS2812 data lines of two pods to a logic analyser,
   compare the start of the LED frames.
3. **Reaction accuracy**: LED data line vs. button line on one pod, compare with the `RESULT` value.
4. **Loss**: count `frame type … lost` warnings over a 30 min session, or read
   `status.pods[].link` (`txLost`, `txRetries`, `ackUsAvg`, `ackUsMax`).

The measured values replace the estimates in this document.

## 7. Timing-related risks

- **2.4 GHz congestion** (gyms with many WiFi networks) adds retries and jitter. The
  channel is fixed (`ESPNOW_CHANNEL`). Choosing a less used channel can help.
- **Serial logging** in hot paths can add delays when the console buffer
  fills. Use a lower log level for timing measurements.
- **No pre-arming yet**: pod → pod always goes through the central (2 hops). A direct
  pod-to-pod trigger would save one hop (~1–2 ms). See [improvement-plan.md](../archive/improvement-plan.md).
