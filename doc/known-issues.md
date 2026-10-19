# Known Issues & Risks

Result of a code review of commit `70389a6`. These findings come from reading the code.
Items marked *(verify)* depend on runtime behaviour and should be confirmed on hardware.

Severity: **Critical** = crash or permanent hang · **High** = wrong game behaviour or
lost data · **Medium** = robustness, performance, power · **Low** = cleanup.

IDs (C1, H3 …) are referenced from [improvement-plan.md](improvement-plan.md).

**Status after the block system rework (JSON programs):** ✅ = fixed, ◐ = partly fixed.
The file/line references of fixed items point to the old code and are kept for history.

- H1 ◐: reaction times are now recorded and printed (`RESULT`/`SUMMARY` lines), but not
  yet shown on the ring or sent to a phone.
- M12 ◐: game presses on the central and on peripherals use the debounced `Input/Button`.
  Only the program menu still samples the pin directly.
- M13 ◐: the scan is still blocking, but failed and foreign devices are skipped and the
  scan results are cleared.
- **ESP-NOW link (firmware 2.0)** removes the BLE pod link, and with it C4 (pause + automatic
  reconnect), H9 (set pairing via a shared set id), M1 (ordered frame processing instead of
  polled values), M6/M7/M14/M15/M16 (BLE-specific), M13 (non-blocking discovery) and L3.
  L1 ◐: the placeholder UUIDs remain only for the phone BLE service.
- M9 is still open, and the radio now stays on permanently (WiFi power save off) for low
  latency. That costs battery; ~1 h runtime is the accepted target.
- M11 ✅: game randomness now uses `esp_random()` directly. `randomSeed()` in `main.cpp`
  only affects Arduino `random()`, which the blocks no longer use.

## Critical

| ID | Issue | Location | Failure scenario |
|---|---|---|---|
| C1 ✅ | A failed `connect()` still counts as a connected peripheral | [CentralMode.cpp:132-136](../src/BLEManager/CentralMode/CentralMode.cpp#L132-L136), [Peripheral.cpp:16](../src/Peripheral/Peripheral.cpp#L16) | Connection times out (pod out of range, already taken). The `Peripheral` object has uninitialised characteristic pointers. The first `activate()` dereferences garbage and the central crashes |
| C2 ✅ | `remoteService` is used before its null check. Missing characteristics are never checked | [Peripheral.cpp:18-21](../src/Peripheral/Peripheral.cpp#L18-L21) | A device advertises the service UUID but has a different layout. Example: another **central** in config mode, which advertises the same UUID. Result: null-pointer crash |
| C3 ✅ | `std::stoll()` on phone input with C++ exceptions disabled | [CentralMode.cpp:80-81](../src/BLEManager/CentralMode/CentralMode.cpp#L80-L81) | Phone writes `""` or `"abc"` to MaxLoop. The exception cannot be caught, so `abort()` and reboot |
| C4 ✅ | No recovery from a disconnect | [CentralMode.cpp:89-94](../src/BLEManager/CentralMode/CentralMode.cpp#L89-L94), `ServerMode` (no server callbacks) | One pod drops out (battery, range). The central goes to ERROR forever. The peripheral never advertises again. The whole set must be power-cycled |
| C5 ✅ | Unknown block name → index `0xFF` → `blockList[255]` is `nullptr` | [BlockManager.cpp:47-55](../src/BlockManager/BlockManager.cpp#L47-L55), [BlockFactory.cpp:28-31](../src/Block/BlockFactory/BlockFactory.cpp#L28-L31) | A typo in a block name, a `nullptr` next name, or a `COUNTDOWN` block crashes the central |
| C6 ✅ | Uninitialised members `modelSelectorPressStart`, `modelSelectorCounter`, `selectedModel` (also `centralTimer`, `waitingForPeripheral`) | [CentralMode.h:40-44](../src/BLEManager/CentralMode/CentralMode.h#L40-L44) | Undefined starting program / ramp state. Usually zero by chance on fresh heap, but not guaranteed |

## High

| ID | Issue | Location | Failure scenario |
|---|---|---|---|
| H1 ◐ | Measured reaction times are thrown away | [Peripheral.cpp:111](../src/Peripheral/Peripheral.cpp#L111) | The main value of the product (the time) never reaches the user |
| H2 ✅ | `peripheralQueue` (`std::queue`) is written by the BLE task and read by the loop task without a lock | [CentralMode.cpp:331](../src/BLEManager/CentralMode/CentralMode.cpp#L331), [RemotePressBlock.cpp:30-32](../src/Block/RemotePressBlock/RemotePressBlock.cpp#L30-L32) | Concurrent push/pop (e.g. several pods pressed at once in RUN mode) can corrupt the deque → lost events or crash *(verify)* |
| H3 ✅ | `RemotePressBlock` accepts a notification from *any* pod. The queue is never flushed between rounds. There is no timeout | [RemotePressBlock.cpp:28-40](../src/Block/RemotePressBlock/RemotePressBlock.cpp#L28-L40) | A late or stale event from another pod completes the wrong round. If the activation write is lost, the game waits forever |
| H4 ✅ | The confirm press leaks into the first game block: CONFIRM → RUN fires on button *down*, and the next `ButtonBlock` fires on *release* | [CentralMode.cpp:69-74](../src/BLEManager/CentralMode/CentralMode.cpp#L69-L74) | Star/random: the first central target is skipped automatically. SOLO: instant "false start" (red) *(verify)* |
| H5 ✅ | The boot hold leaks into the model selector. The current program is not shown until the first short press | [CentralMode.cpp:146-281](../src/BLEManager/CentralMode/CentralMode.cpp#L146-L281) | User releases after the boot animation, as the manual says. That release counts as a short press → program #1 instead of #0. Holding > 1.8 s selects #0 without the user noticing |
| H6 ✅ | `ButtonBlock` dead zone: a release between 1 s and 2 s is ignored. The block stays PRESSED and only the *next* release is counted | [ButtonBlock.cpp:52-60](../src/Block/ButtonBlock/ButtonBlock.cpp#L52-L60) | A slow press on the central "does nothing", then the next press advances |
| H7 ✅ | Underflow guard checks `254` instead of `255` | [RemoteMultiplePressBlock.cpp:101](../src/Block/RemoteMultiplePressBlock/RemoteMultiplePressBlock.cpp#L101), [:115](../src/Block/RemoteMultiplePressBlock/RemoteMultiplePressBlock.cpp#L115) | The last remote hit and the central hit are processed in the same pass. The count goes 0 → 255 and the round never ends |
| H8 ✅ | Avoid selection loops forever if `AVOID_COUNT > pods`. It uses a VLA of size `avoidCount` | [RemoteMultiplePressBlock.cpp:29-42](../src/Block/RemoteMultiplePressBlock/RemoteMultiplePressBlock.cpp#L29-L42) | A misconfigured program hangs the central |
| H9 ✅ | No set pairing: TeamID is the constant `"TEAM123"` and is not checked | [Peripheral.cpp:24](../src/Peripheral/Peripheral.cpp#L24) | Two sets in one room steal each other's pods. Combined with C2 this can crash |
| H10 ✅ | RUN modes give no success/failure feedback. `MAX_LOOPS` is ignored. Parameter named `maxLoops` in the header is really `avoidCount` | [BlockConfigs.cpp:333](../src/BlockConfigs.cpp#L333), [BlockConfigs.h:21](../src/BlockConfigs.h#L21) | Confusing gameplay and API |

## Medium

| ID | Issue | Location | Notes |
|---|---|---|---|
| M1 ✅ | Peripheral handles Reset *after* the state switch in the same pass, and clears ActionMode | [ServerMode.cpp:87-94](../src/BLEManager/ServerMode/ServerMode.cpp#L87-L94) | If Reset and a new activation for the same pod arrive within one pass, the activation is lost. Latent with current programs |
| M2 ✅ | `DelayBlock` blocks the loop (`vTaskDelay`, up to 3 s) | [DelayBlock.cpp:17-25](../src/Block/DelayBlock/DelayBlock.cpp#L17-L25) | During the delay there is no connection check, no queue handling and no button. `enterBlock` already stores a timestamp for a non-blocking version |
| M3 ✅ | `enterBlock()` is not called for the start block or for self-transitions | [BlockManager.cpp:57-71](../src/BlockManager/BlockManager.cpp#L57-L71) | Any program that starts with a Button/Remote block behaves incorrectly |
| M4 ✅ | `IfBlock` compares `int64` variables as `uint64_t` | [IfBlock.cpp:14-15](../src/Block/IfBlock/IfBlock.cpp#L14-L15) | `<`/`>` are wrong for negative values (e.g. MaxLoop `-1`) |
| M5 ✅ | `SetVariable '!'` loops forever if `changeSize ≤ 1` | [SetVariableBlock.cpp:22-27](../src/Block/SetVariableBlock/SetVariableBlock.cpp#L22-L27) | Random mode with a single pod |
| M6 ✅ | `BLEDevice::init("ReactPod Running")` is called every pass but has no effect (already initialised). The config server keeps advertising the shared UUID during the game | [CentralMode.cpp:43](../src/BLEManager/CentralMode/CentralMode.cpp#L43) | Makes C2/H9 more likely |
| M7 ✅ | `BLEDevice::deinit(true)` releases controller memory permanently. It is only harmless because BLE is not initialised yet at that point | [CentralMode.cpp:291](../src/BLEManager/CentralMode/CentralMode.cpp#L291) | Would break BLE if code is reordered |
| M8 ✅ | JSON loader: stores `c_str()` of temporary `String`s (dangling). `randomDelay` config is overwritten by a Button config (leak + wrong type). Button `next*` fields are read but ignored | [BlockManager.cpp:74-125](../src/BlockManager/BlockManager.cpp#L74-L125) | Must be rewritten before use |
| M9 | Busy loop at 100 % CPU, LEDs re-sent every pass, full brightness, no sleep, BT modem sleep off | `main.cpp`, `ServerMode::runMode` | Short battery life. 18 LEDs at full white draw ≈ 1 A |
| M10 | DEBUG log level, `Serial.print` in hot paths. ERROR state prints every pass | e.g. [VariableManager.cpp:29-33](../src/VariableManager/VariableManager.cpp#L29-L33), [CentralMode.cpp:108](../src/BLEManager/CentralMode/CentralMode.cpp#L108) | Timing jitter, possible stalls on USB-CDC *(verify)* |
| M11 ✅ | `randomSeed(analogRead(0))`: in arduino-esp32 ≥ 2.0 a non-zero seed switches `random()` from the hardware RNG to `rand()` | [main.cpp:29](../src/main.cpp#L29) | Worse randomness than leaving it out |
| M12 ◐ | No button debouncing / filtering | `ButtonBlock`, `ServerMode`, `CentralMode` | A spike can trigger a press. A bounce on release can produce extra short presses |
| M13 ✅ | Blocking scan + connect loop: button and LEDs unresponsive for seconds. No way to cancel | [CentralMode.cpp:116-143](../src/BLEManager/CentralMode/CentralMode.cpp#L116-L143) | UX |
| M14 ✅ | `CONFIG_BT_GATTC_NOTIF_REG_MAX=5` | `sdkconfig.NewBoard` | If this limit applies per stack rather than per client app, only 5 peripherals can notify *(verify before going to 7 pods)* |
| M15 ✅ | Multi-pod activation is sent sequentially with blocking writes | [RemoteMultiplePressBlock.cpp:44-61](../src/Block/RemoteMultiplePressBlock/RemoteMultiplePressBlock.cpp#L44-L61) | Pods light up staggered by several connection intervals |

| M16 ✅ | New: a `Peripheral` object whose connection failed is not freed, and its `BLEClient` stays registered. Repeated failed connects may exhaust Bluedroid GATT client slots *(verify)* | [CentralMode.cpp](../src/BLEManager/CentralMode/CentralMode.cpp) `clientScanForPeripherals` | Only after many failed attempts in one session |
| M17 ◐ | New: programs come from SPIFFS. After flashing only the firmware (without `uploadfs`), the central has no programs and shows the error blink | [ProgramCatalog.cpp](../src/Program/ProgramCatalog.cpp) | ◐ Now also uploadable over BLE (config API); an empty central waits for an upload |

| M18 | New: pod-to-pod traffic always goes through the central (no direct pre-armed trigger). That costs one extra hop (~1–2 ms) | [link-protocol.md](link-protocol.md) | Design limitation, see improvement plan |
| M19 | New: ESP-NOW frames are not encrypted. Set id filtering prevents accidental mix-ups, but a deliberate fake sender is possible | [Protocol.h](../src/Link/Protocol.h) | Acceptable for a training device |
| M20 | New: the ESP-NOW channel is fixed at compile time. A busy 2.4 GHz channel adds retries | [_Definitions.h](../src/_Definitions.h) | Make it configurable via the phone |

## Low / cleanup

| ID | Issue |
|---|---|
| L1 ◐ | Placeholder UUIDs `12345678-1234-…`. These could collide with other hobby devices. Generate a random 128-bit base UUID |
| L2 | `static ColorSet* X = new …` in a header: every translation unit gets its own copies ([ColorSet.h](../src/ColorSet/ColorSet.h)) |
| L3 ✅ | `setMinPreferred(0x06)` is immediately overwritten by `setMinPreferred(0x12)`. This is a copy-paste from the Arduino example; `setMaxPreferred` was probably intended |
| L4 | Dead code / stubs: `Peripheral::setLedColor`, `peripheralId`, `findNextBlockIndex`, `phoneOverride*`, `centralTimer`, COUNTER/COUNTDOWN, `esp_task_wdt.h`, SPIFFS + `homepage.html`, empty `customPartitions.csv`, `IBuzzerMode.cpp`, `ColorSet.cpp` |
| L5 | Flash config says 2 MB (`CONFIG_ESPTOOLPY_FLASHSIZE_2MB`), but `partitions.csv` uses 4 MB. Only one app slot, so OTA is impossible *(verify actual flash size)* |
| L6 ✅ | `BlockManager::runBlocks` builds `String` objects for name lookups on every pass (heap churn) |
| L7 | Naming is inconsistent: ServerMode = peripheral role, "model" = program, "buzzer" = pod. Some comments are out of date (e.g. "more than 2 seconds") |
| L8 | No automated tests, no CI build |
