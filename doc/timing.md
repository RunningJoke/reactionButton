# Timing Structures

This document lists every place where the firmware deals with time: the main loop,
fixed constants, user-interaction timing, BLE latencies and how accurate the reaction
time measurement is.

All times come from `millis()` (1 ms resolution, per device, never synchronised between
pods). `CONFIG_FREERTOS_HZ=1000`, so `vTaskDelay` also has 1 ms granularity.

## 1. Execution model

```
Arduino loopTask (core 0, prio 1)            Bluedroid tasks (higher priority)
──────────────────────────────────           ─────────────────────────────────
loop() { BLEManager::runCurrentMode(); }     BTC/BTU: GATT events, notify callbacks
   │ no delay / yield                           │
   ├─ Peripheral: ServerMode::runMode()         └─ CentralMode::notifyCallback()
   └─ Central:    CentralMode::runMode()             → peripheralQueue.push()
                    └─ BlockManager::runBlocks()
```

- **Busy loop**: `loop()` never sleeps. The only places that give up the CPU are the
  blocking BLE calls (scan, connect, write) and `delay(10)` during the boot animation.
  `DelayBlock` is non-blocking since the JSON rework: it stores a deadline and returns
  `running` until it is reached.
- **Single core**: ESP32-C3 has one core. BLE tasks preempt the loop task, so the BLE
  stack still runs. The idle task gets almost no time. That prevents automatic light
  sleep. The task watchdog is disabled in `sdkconfig`, so it does not reset the chip.
- **Polling everywhere**: the button, characteristic values and block conditions are
  all polled once per loop pass. There are no interrupts. On the central, peripheral
  notifications reach the loop through a FreeRTOS queue (`PodEvent`).

### 1.1 Typical loop pass duration

| Situation | Dominant cost | Approx. pass time |
|---|---|---|
| Peripheral, any state | one `NeoPixel::show()` of 18 LEDs (18 × 24 bit × 1.25 µs ≈ 0.54 ms + latch) | ~0.6–1 ms → **~1 kHz polling** |
| Central, RUN, waiting block | `isConnected()` per pod + `button.update()` + one `execute()` | µs range |
| Central, RUN, block chain | instant blocks run in the same pass (max 32 steps), one `show()` per LED block | ~0.6–1 ms per LED block |
| Central, WAITING_FOR_PERIPHERALS | `turnOff()` + up to 2×N single-pixel `show()` + **2 s blocking scan** + blocking connects | ≥ 2 s |
| Central, CONFIRM | `show()` + `std::stoll` | ~1 ms |
| Any `Serial.print` / `ESP_LOGx` | USB-CDC output (log level DEBUG) | variable; can block if the TX buffer is full |

The numbers are estimates from the code. They have not been measured on hardware.
Measuring them is part of [improvement-plan.md](improvement-plan.md) WP-T1.

## 2. Fixed timing constants

| Where | Constant | Value | Effect |
|---|---|---|---|
| `main.cpp` | boot animation | 2000 ms, refresh every 10 ms | role decision at the end |
| `BootupAnimation.h` | step | 50 ms per LED → 900 ms per revolution (~2.2 rounds) | |
| `ErrorAnimation.h` | blink | 1000 ms on / 1000 ms off | |
| `CentralMode::runModelSelector` | ramp step | counter +1 every ~10 ms while held | white LEDs 16,17,0,1,2 brighten (value = counter) |
| | short press | release after ~10 ms … 1.0 s (counter 1–100) | next program |
| | dead zone | release after 1.0 … 1.8 s | nothing happens |
| | long press | held > ~1.8 s (counter > 180) | program selected (while still held) |
| `CentralMode::clientScanForPeripherals` | scan window | 2 s active scan, blocking | repeated until enough pods |
| `Input/Button` | lockout | 20 ms after each accepted edge | debounce. The first edge is accepted immediately |
| `button` block | `shortMs` | default 1000 ms | release < shortMs → `short`, otherwise `long` (no dead zone) |
| `solo.json` | random wait | 800 … 5000 ms, uniform, inclusive | time until green |
| | result display | 2500 ms (`ShowResult`) | |
| `lib/loop.json` | blue pause | 3000 ms | after `MAX_LOOPS` rounds |
| `lib/star.json`, `lib/random.json` | `EnterProgram` | 10 ms | gap before each round |
| `lib/multi.json` | `EnterProgram` / `FailDelay` | 3000 ms / 1000 ms | pause between rounds / red flash |
| `MAX_LOOPS` | rounds per cycle | 12 / 18 / 255 by program; phone override | |

All program timings are now in the JSON files (`data/prog/`) and can be changed without
recompiling.

## 3. Reaction-time measurement

### 3.1 On a peripheral (measured)

```
central write ActionMode ──air──► peripheral loop sees ActionMode≠0
                                   t0 = millis()          (READY → ACTIVE)
                                   next pass: LEDs on     (+1 pass ≈ 0.6–1 ms)
                                   ... user reacts ...
                                   pass with button LOW:
                                   dt = millis() - t0     → notify "dt"
```

- **Reference point**: `t0` is taken one loop pass *before* the LEDs actually light.
  The measured time is therefore ≈ 0.6–1 ms too long. LED rise time is negligible.
- **Resolution**: press is polled each pass → ≤ ~1 ms extra. `millis()` resolution 1 ms.
- **Debounce**: the first LOW sample triggers. That is the right edge for reaction
  timing, but contact bounce/EMI spikes can also trigger it.
- **Accuracy overall**: about **+1 … +2 ms systematic, ±1 ms jitter**. That is good enough for
  human reaction times (150–600 ms).
- The value reaches the central as `PodEvent.value`. Blocks with `"record"` print it as a
  `RESULT` line and add it to the statistics. It is not yet shown on the ring.

### 3.2 On the central (measured since the JSON rework)

The `button` block with a `pressed` port continues on the **press edge**. With `"record"`
it measures *press time − block entry time*:

- Reference: block entry. The block is entered in the same pass right after the LED block
  that lights the central, so the LED onset is ≈ ≤ 1 ms before the reference point.
- Press timestamp: taken by `Button::update()` at the first LOW sample, once per pass
  (≤ ~1 ms resolution).
- Accuracy is therefore in the same range as on the peripherals. This has not been verified on hardware yet.

## 4. BLE latency chain

Connection parameters are not set explicitly. The Bluedroid defaults apply. The
peripheral advertises `setMinPreferred(0x12)` (= 22.5 ms) as its preferred minimum
interval. In the formulas below *CI* is the effective connection interval, which should
be measured (WP-T1).

| Step | What happens | Cost |
|---|---|---|
| A1 | `Peripheral::setActionMode(HIT)`: write LedColor, then write ActionMode (write-without-response) | The Arduino wrapper waits for the GATTC write event → each write can block the loop ~≤ 1 CI |
| A2 | Air transfer to peripheral | ≤ 1 CI |
| A3 | Peripheral loop notices value | ≤ 1 pass (~1 ms) |
| R1 | Peripheral `notify()` after press | ≤ 1 CI |
| R2 | Central BLE task → `peripheralQueue.push` | < 1 ms |
| R3 | Central loop pops queue | ≤ 1 pass |
| R4 | `resetPeripheral()` write | ≤ 1 CI, blocking |

**Activation latency** (central decision → remote LED on) ≈ `A1 + A2 + A3` ≈ 1–3 CI.

**Multi-pod activation skew**: `RemoteMultiplePressBlock::enterBlock` sends
2 writes × N pods **sequentially**. After that the central lights itself. With N = 4 the
last pod can light up to ~8 CI after the first one. For "RUN" modes the pods do not
start simultaneously. Each pod's own `dt` is still correct, because it is measured locally.

**Round turnaround in star mode** (remote press → central green):
`R1 + R3 + R4` + 10 ms `EnterProgram` ≈ 2 CI + ~11 ms. The instant blocks in between
are chained in the same pass.

## 5. Connection set-up timing

Per scan cycle:
1. `BLEScan::start(2, false)` – 2 s blocking active scan.
2. For each matching device, sequentially: `connect()` → service discovery →
   characteristic discovery → TeamID write → CCCD write. All of these block, roughly
   0.5–2 s per pod depending on the stack.
3. The progress bar is redrawn once per cycle. The button is not checked during this time.

For a 5-pod set, expect roughly 4–10 s from program selection to green.

## 6. Timing-related risks (summary)

See [known-issues.md](known-issues.md) for details:

- ~~Blocking `DelayBlock`~~, ~~confirm press leaking into the first block~~ and ~~boot
  hold leaking into the menu~~ are fixed by the JSON block rework.
- Writes to several peripherals in sequence cause start skew in multi-pod modes.
- Serial logging in hot paths can add unpredictable delays when the console buffer fills.
