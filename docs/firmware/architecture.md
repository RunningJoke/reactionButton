# Firmware architecture

## 1. Hardware and quick facts

| Item | Value |
|---|---|
| MCU | ESP32-C3 (single-core RISC-V, 160 MHz), board `esp32-c3-devkitm-1`, 4 MB flash |
| Framework | PlatformIO, `framework = arduino, espidf` (Arduino as ESP-IDF component) |
| Button | GPIO 3, active LOW (external pull-up, `pinMode INPUT`); RTC pin, wakes from deep sleep |
| LEDs | 18 × WS2812 (GRB, 800 kHz) on GPIO 7 |
| Battery | GPIO 5, ADC2 (`analogReadMilliVolts`) through a 1:1 divider (2 × 100 k) |
| Random seed | GPIO 0 ADC read once |
| Pod link | ESP-NOW, WiFi channel 1, ≤ 7 peripherals (`CentralRole::MAX_PERIPHERALS`); shipped programs use ≤ 4 |
| Phone | BLE (Bluedroid), central only |
| Libraries | Adafruit NeoPixel ^1.12.0, ArduinoJson ^7.4.2 |

Sources: `hardware/pcb` (KiCad), `hardware/casing` (FreeCAD).

## 2. Build configuration

| File | Purpose |
|---|---|
| `platformio.ini` | single env `NewBoard`, USB-CDC console |
| `sdkconfig.NewBoard` | WiFi + SW coexistence, Bluedroid, `FREERTOS_HZ=1000`, task WDT off, C++ exceptions off, `-Os`, log level INFO (`CONFIG_LOG_MAXIMUM_LEVEL=3`), assertions on, `CONFIG_ADC_ONESHOT_FORCE_USE_ADC2_ON_C3`. BLE limits are changed here (`pio run -d firmware -t menuconfig`) |
| `partitions.csv` | nvs 20 KB, otadata, **one** app slot `ota_0` 2 MB, SPIFFS 1.9 MB, coredump 64 KB |
| `CMakeLists.txt`, `src/CMakeLists.txt` | ESP-IDF glue (globs `src/`) |

**Serial port:** with `arduino, espidf` the core is built without `ARDUINO_USB_CDC_ON_BOOT`, so `Serial` is
UART0 (GPIO 20/21). The firmware uses its own USB console (`Config/Console`), which also gets the ESP-IDF
log. Do not add `ARDUINO_USB_CDC_ON_BOOT`/`ARDUINO_USB_MODE` to `platformio.ini` (they only reach `src/`,
`Serial` would mean two objects). Panic dumps still go to UART0; the `boot` event (reset reason + last
step) replaces them.

## 3. Modules (`src/`)

```
main.cpp            setup(): battery gauge, role; loop(): battery, role
_Definitions.h      FW_VERSION_*, pins, ESP-NOW channel, BLE UUIDs, LED_BRIGHTNESS_CAP, AUTO_POWER_OFF_MINUTES
Roles/              RoleManager (role at boot), IRole (run, idle, powerOffAllowed)
  Central/          CentralRole (menu, discovery, confirm, run, pause), PodNetwork (claims, heartbeats,
                    ARM/RESET/EFFECT, events; implements Link/IPodNetwork), PhoneConfig (BLE config API)
  Peripheral/       PeripheralRole (announce, claim, clock sync, arm/measure/report, identity)
Link/               Protocol.h (wire format), EspNowLink (reliable ordered unicast, dedupe, tx timestamps,
                    idleWait), ClockSync.h, IPodNetwork.h, HoldSession (hold measuring + animation)
Config/             ConfigApi (JSON requests, shared by BLE and USB), SerialConsole, Console
Diagnostics/Diag    reset reason + last step across reboots
Settings/           NVS: set id, store generation, boot role, set name, PIN
Power/AutoPowerOff  idle timer, goodbye animation, deep sleep (§8)
Battery/            cell voltage, percent, low-battery thresholds
Store/              ProgramStore (files, CRC, manifest, atomic commit, generation), StoreSync (pod-to-pod)
BlockManager/       loads programs, runs the block graph (§6)
Block/              Block base (configure / enter / execute / exit / resume, named ports), BlockContext,
                    Value (constant or variable), JsonUtil, BlockFactory (type → class), EffectTarget,
                    Countdown, RandomUtil, one folder per block type
Program/ProgramCatalog  menu from /programs.json
Input/Button        debounced, edge counters, µs timestamps
Results/            Results (records, statistics, RESULT/SUMMARY lines), Reports (log + report buffer)
VariableManager/    int64 variables, names resolved to ids at load
LEDManager/         NeoPixel wrapper, patterns, effect player, Identity.h, EffectJson
ColorSet/           RGB + colour constants
```

Managers are lazily created singletons (`getManager()`), allocated once, never freed. Blocks use
`BlockContext`, not the singletons.

## 4. Boot

Power on → Serial, SPIFFS, pins → battery gauge 2 s (ring filled to the charge) → button held at the end?
yes: `CentralRole` (BLE `ReactPod xxxx`), no: `PeripheralRole` (ESP-NOW, HELLO). The role changes only by
reboot. Wake from deep sleep is a normal boot.

## 5. State machines

### 5.1 Peripheral

| State | Enter / behaviour |
|---|---|
| UNCLAIMED | yellow + a MAC-derived 2-LED segment (fw ≥ 2.13); HELLO every 250 ms; hold the button 3 s → set id cleared (white flash) |
| READY | CLAIM from a central of its set (or any, if unpaired); PING every 200 ms; identity number for 1.5 s, then spins while the central sets the identify flag (link-protocol §2.4) |
| SCHEDULED | ARM with a start time; → ACTIVE when the synced clock reaches it |
| ACTIVE | LEDs updated, then `t0` taken; only presses that start after count; reaction = press edge − `t0` (µs) |
| DONE | press reported (PRESSED); → READY on RESET |
| HOLDING | CHARGE / RELEASE activation running (`HoldSession`) |

RESET from any armed state → READY. No PONG for 2 s → UNCLAIMED. Frames are handled on arrival, in send
order. An EFFECT takes the ring until it ends; ARM or RESET gives the ring back to the activation.

### 5.2 Central

| State | Enter / behaviour |
|---|---|
| MENU | menu from `/programs.json`, current pattern shown at once; the boot hold is ignored until released; short press (< 1 s) = next program, long press (~1.8 s, white group ramps up) = load it; MaxLoop override read now |
| ERROR | no programs or load error: red blink (1 s on/off), reboot needed. Programs can still be uploaded |
| DISCOVERY | non-blocking, one claim per HELLO; SOLO (0 peripherals) never starts ESP-NOW |
| CONFIRM | all required pods claimed (blue progress bar); a press that starts after entering starts the game (LEDs green); earlier events dropped |
| RUN | the game |
| PAUSED | a pod silent > 1.5 s (all yellow) or phone `pause` (`phonePaused`). Pod loss resumes by itself when all are back; a phone pause only with `resume` (config-api §5). The current block is left and re-entered (re-arms its pods) |

BLE (fw ≥ 2.12, `liveBle`, ADR 0005) stays connected in every state; `PhoneConfig::service()` runs in
`CentralRole::run()`, responses go out from a sender task (link-protocol §6). Lights with a start time
(`syncStartMs`) are armed on an esp_timer by `LEDManager::playEffect` (timing §4.1).

## 6. Block engine

### 6.1 Loading (`BlockManager::loadProgram`)

1. Clear blocks and variables. 2. Read the file; load `include`s first (recursive, depth ≤ 3), then its
`peripherals`, `variables`, `blocks`. 3. Per block `BlockFactory::create(type)` → `configure(json)`
(variable names → `VarId`). 4. Resolve port targets to indices. Unknown names, duplicates, unknown types
and bad parameters abort with a message naming file and block → error blink.

### 6.2 Execution (`BlockManager::run`, once per `loop()`, after `button.update()` and `network.service()`)

```
repeat up to 32 times:
    status = current.execute(ctx);  if running: return
    next = target[status.port];  if unconnected and block has "next": next = target[next]
    current.exit(); timerStop
    if no next: program ends
    current = next; timerStart; current.enter()
```

Semantics in detail: programs.md §7.

| JSON `type` | Class | Ports |
|---|---|---|
| `led` | `LEDBlock` | next |
| `delay` | `DelayBlock` | next |
| `button` | `ButtonBlock` | next, short, long, pressed, timeout |
| `if` | `IfBlock` | true, false |
| `setVariable` | `SetVariableBlock` | next |
| `remotePress` | `RemotePressBlock` | next, timeout |
| `remoteMultiPress` | `RemoteMultiplePressBlock` | next, avoidHit, timeout |
| `remoteResetAll` | `RemoteResetAllBlock` | next |
| `summary` | `SummaryBlock` | next |
| `repeat` | `RepeatBlock` | next, body, done |
| `effect` | `EffectBlock` | next |
| `charge` | `ChargeBlock` (on `HoldBlock`) | next, released, early, full, timeout |
| `release` | `ReleaseBlock` (on `HoldBlock`) | next, noHold, falseStart, timeout |
| `toggle` | `ToggleBlock` | next, allA, allB |
| `communicate` | `CommunicateBlock` | next, pressed, timeout, repeat, stop |

### 6.3 New block type

1. `src/Block/MyBlock/MyBlock.{h,cpp}` deriving from `Block`: `configure(json, ctx)` (use `Value`,
   `JsonUtil`; `ctx.fail("…")` on bad input), `enter(ctx)` (reset, take times), `execute(ctx)`
   (`BlockStatus::running()` / `done(port)`), `portCount()`/`portName(i)`, `onProgramStart()` for state
   across entries, `resume()` if a pause must not re-run `enter()`.
2. One line in `BlockFactory.cpp`. 3. Then the `/fw-api-change` skill (validator, program model, app).

### 6.4 System variables

| Variable | Set from | Used by |
|---|---|---|
| `REQUIRED_PERIPHERALS` | `peripherals` | CentralRole (pods to claim), programs; also the central's pod id |
| `NODE_COUNT` | `peripherals + 1` | programs |
| `MAX_LOOPS` | program variables; MaxLoop characteristic overrides it at selection | `lib/loop.json` |

Unknown variables read 0.

### 6.5 Events and measurements

- ESP-NOW receive callbacks (WiFi task) only queue frames; `PodNetwork::service()` turns them into
  `PodEvent`s in the loop: PRESSED `{podId, cmdSeq, result, reactionUs, rxTimeUs}` (+ `owner`, `flipCount`
  for TOGGLE), RELEASED `{flags, heldMs, chargeMs}`.
- `IPodNetwork::arm()` returns the `cmdSeq`; a remote block accepts only events with its pod and `cmdSeq`.
- `record` / `timerStop` → `Results`: `RESULT,…` line, per-metric statistics for `summary`, and the
  measurement log (48 values) that `communicate` turns into reports (8 in RAM until `ack`).

## 7. LEDs (`LEDManager`)

- Colour index on the wire: `0 red, 1 green, 2 blue, 3 yellow, 4 magenta, 5 cyan, 6 white, 7 orange, 8 violet,
  255 off`; 7 and 8 are identity colours, pods only. Other values ignored.
- Static calls: `setLEDColors(ColorSet*)`, `(colorId)`, `(index, ColorSet*)`, `(LEDPattern*)` (≤ 8 palette
  colours, 3 bits × 18 in a `uint64_t`, optional animation), `setSegment(first, count, colorId, restId)`.
  Every static call stops a running effect.
- `playEffect(EffectDesc, startUs, ledMask)` (fw ≥ 2.8): one effect at a time, frames = f(time since
  start) (link-protocol §2.1), shown only when changed, ≤ every 16 ms; first frame inside `playEffect`
  or from an esp_timer at a future start. `service()` runs after the role every pass and returns at once
  when nothing animates.
- Every driver write goes through `present()`: `show()` only if the buffer differs (fw ≥ 2.14).
- `setBrightnessCap(0…255)` scales all output; default `LED_BRIGHTNESS_CAP` 255.
- Other pods: `IPodNetwork::effect(pod, desc, startAtUs)`, `ArmCommand::waiting`; check
  `supportsEffects(pod)`, older pods get static colours. `Block/EffectTarget` and `Block/Countdown` build
  `EffectDesc`s from block fields; `LEDManager/EffectJson` parses the `effect` test op.
- Identity (fw ≥ 2.13): palette and timings in `LEDManager/Identity.h`, drawn by
  `PeripheralRole::updateIdentity`; the central's own `blink` is white (`CentralRole::opBlink`); the menu
  flag goes out through `PodNetwork::setIdentify`.

## 8. Power (fw ≥ 2.14, #21)

### 8.1 Idle loop
In idle states (peripheral UNCLAIMED / READY, central MENU / CONFIRM / ERROR) the loop waits ≤ 1 ms for a
radio frame (`IRole::idle()`, `EspNowLink::idleWait`; a frame wakes it at once). Armed activations and
games never wait (timing §1).

### 8.2 Auto power-off
`AutoPowerOff::service(IRole::powerOffAllowed())` every pass. Allowed: peripheral UNCLAIMED; central MENU
without a phone (`PhoneConfig::connected()`). Not allowed: any claimed peripheral, central with a phone or
in DISCOVERY / CONFIRM / RUN / PAUSED / ERROR. A press (or held button) and a USB host
(`HWCDC::isPlugged()`; a plain charger is no host) restart the idle time. `status.powerOff {idleMs,
limitMs, usbHost}` counts `idleMs` as if no host were connected. After `AUTO_POWER_OFF_MINUTES` (10): white
drain 1.2 s, `sleep` event, deep sleep with GPIO 3 LOW wake-up → normal boot.

Limits: the WS2812s keep drawing ≈ 0.5–1 mA each unless their supply is switched (check the schematic
for an LED power switch); the power switch cuts everything. A sleeping pod cannot answer HELLO: press
each waiting pod before the discovery.

### 8.3 Light sleep: not used
ESP-NOW must keep receiving; a claimed pod always listens for ARM / EFFECT.
