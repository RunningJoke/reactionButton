# Writing Programs (JSON)

Game programs are JSON files on the central's file system (SPIFFS). They are not compiled
into the firmware. To add or change a game, you edit files in `data/`, check them, and
upload the file system image:

```sh
python tools/validate_programs.py   # checks types, fields, links, colours, path lengths
pio run -e NewBoard -t uploadfs     # writes data/ to the SPIFFS partition (USB)
python tools/reactpod_config.py push data   # or: upload over BLE to a central in the menu
```

Programs uploaded over BLE spread to all pods of the set automatically. See
[config-api.md](config-api.md).

> Flashing the firmware (`-t upload`) does **not** update `data/`. After a fresh flash run
> `uploadfs` once, otherwise the central shows the red error blink ("No programs found").

## 1. Files

```
data/
├── programs.json          menu: list and order of programs
└── prog/
    ├── solo.json          complete program, all blocks inline
    ├── weiche.json        small programs: metadata + includes
    ├── …
    └── lib/
        ├── loop.json      shared round counter + summary
        ├── star.json      star game logic
        ├── random.json    random game logic
        └── multi.json     run / avoid game logic
```

SPIFFS paths (including the leading `/`) must be at most 31 characters long.

### 1.1 `programs.json`

```json
{ "programs": ["/prog/solo.json", "/prog/weiche.json", "..."] }
```

The order in this list is the order in the menu. Short press = next entry, long press = start.

### 1.2 Program file

```json
{
  "version": 1,
  "name": "Dreieck",
  "description": "free text, ignored by the firmware",
  "peripherals": 2,
  "menu": [ { "leds": [7, 9, 11], "color": "blue" } ],
  "variables": { "MAX_LOOPS": 12 },
  "include": ["/prog/lib/loop.json", "/prog/lib/random.json"],
  "start": "StartLoop",
  "blocks": [ ]
}
```

| Field | Meaning |
|---|---|
| `peripherals` | Number of peripherals the central connects before the game. Sets the variables `REQUIRED_PERIPHERALS` (= peripherals) and `NODE_COUNT` (= peripherals + 1) |
| `menu` | LEDs lit in the program menu. Each group has `leds` (indices 0–17) and `color` |
| `variables` | Initial values (integers). Override values from included files |
| `include` | Fragment files with more `variables` and `blocks`. Loaded first, in order. Max nesting depth 3 |
| `start` | Name of the first block. Default: the first block |
| `blocks` | The block graph (see §2) |

Block names must be unique across the program and all its includes. A fragment can link
to blocks it does not define itself. For example, `lib/star.json` ends in `EndLoop`, which
comes from `lib/loop.json`.

### 1.3 Pod ids

Peripherals have ids `0 … peripherals-1`, in connection order. The central itself has id
`peripherals` (= `REQUIRED_PERIPHERALS`). Results use the same ids.

## 2. Blocks

Every block has `name`, `type` and its output **ports**. A port is a JSON key whose
value is the name of the next block:

```json
{ "name": "Wait", "type": "button", "pressed": "FalseStart", "timeout": "Go" }
```

Rules:
- If a block leaves through a port that is not connected, the engine uses `next`
  instead, if the block has a `next` port.
- If there is no target at all, the program ends. The validator prints a note for such blocks.
- Blocks that finish immediately (LED, setVariable, if, …) run in the same loop pass as the
  following block. Waiting blocks never block the main loop.

**Values**: numeric parameters marked *value* accept a number (`12`) or a variable
name (`"MAX_LOOPS"`). Variables are read when the block runs.

**Colours**: `"red"`, `"#FF8800"` or `[255, 136, 0]`. Named colours: off/black, red, green,
blue, yellow, magenta, cyan, white. Colours sent to **peripherals** must be named
colours, because the BLE protocol only transports these 8.

### `led` – set central LEDs
| Field | | Default |
|---|---|---|
| `color` | colour | required |
| `leds` | list of LED indices | all 18 |

Ports: `next`

### `delay` – wait
| Field | | Default |
|---|---|---|
| `ms` | value | – |
| `minMs`, `maxMs` | value, random duration in [min, max] | – |

Ports: `next`

### `button` – wait for the central's button
| Field | | Default |
|---|---|---|
| `shortMs` | value, short/long threshold | 1000 |
| `timeoutMs` | value | no timeout |
| `minTimeoutMs`, `maxTimeoutMs` | value, random timeout | – |
| `record` | metric name: records *press time − block entry* | – |
| `storeAs` | variable for the same time | – |

Ports: `pressed` (press edge), `short`, `long` (on release), `next` (fallback for
short/long), `timeout`.

Only presses that **start after** the block was entered count. A button that is still
held from the previous step is ignored.

### `if` – branch
| Field | | Default |
|---|---|---|
| `left`, `right` | value | required |
| `op` | `==` `!=` `>` `<` `>=` `<=` | `==` |

Ports: `true`, `false` (no fallback)

### `setVariable` – change a variable
| Field | | Default |
|---|---|---|
| `var` | variable name | required |
| `op` | `=`, `+`, `-`, `random` (0 … value−1), `randomOther` (like random but ≠ current value) | `=` |
| `value` | value | required |

Ports: `next`

### `remotePress` – light one peripheral, wait for its press
| Field | | Default |
|---|---|---|
| `pod` | value, peripheral id | required |
| `mode` | `hit` / `avoid` | `hit` |
| `color` / `colorAfter` | named colour while waiting / after press | green (red for avoid) / off |
| `timeoutMs` | value | no timeout |
| `record`, `storeAs` | reaction time measured **on the peripheral** | – |

Ports: `next` (pressed), `timeout` (also taken if the pod does not exist).
Only the press that belongs to this activation counts. Presses of earlier activations
are ignored.

### `remoteMultiPress` – light several pods at once
| Field | | Default |
|---|---|---|
| `pods` | value, number of peripherals | all connected |
| `avoid` | value, number of red "do not press" pods (central included in the draw) | 0 |
| `includeCentral` | central takes part | true |
| `hitColor`, `avoidColor` | named colours | green, red |
| `syncStartMs` | value: all pods (and the central) light together this long after the block starts. 0 = each pod as soon as its command arrives | 20 |
| `timeoutMs` | value | no timeout |
| `record` | metric for every green pod's reaction time | – |

Ports: `next` (all green pods pressed), `avoidHit`, `timeout`. Pods that were not pressed
stay lit, so follow with `remoteResetAll`.

### `remoteResetAll` – switch peripherals off
| Field | | Default |
|---|---|---|
| `pods` | value | all connected |
| `ledsOff` | also switch the central off | true |

Ports: `next`

### `summary` – statistics of a metric
| Field | | Default |
|---|---|---|
| `metric` | metric name | required |
| `storeAverage`, `storeBest`, `storeWorst`, `storeCount` | variable names | – |
| `reset` | clear the statistics afterwards | true |

Ports: `next`

## 3. Measurements

Blocks with `record` add a measurement to a named metric. Every measurement is printed on
the serial console (115200 baud):

```
RESULT,<millis>,<metric>,<podId>,<value_ms>
SUMMARY,<metric>,<count>,<average>,<best>,<worst>
```

The shipped programs use the metric `reaction`. `lib/loop.json` prints a summary after
every `MAX_LOOPS` rounds and stores `AVG_REACTION` / `BEST_REACTION`. A program can then
branch on those, for example to show a colour by performance.

To add a new kind of measurement (e.g. press duration or misses), a block calls
`ctx.results.record("<metric>", podId, value)`. No other code needs to change.

## 4. Adding a new block type (firmware)

1. Create `src/Block/MyBlock/MyBlock.{h,cpp}` deriving from `Block`:
   - `configure(json, ctx)`: read parameters (use `Value` for numbers, `JsonUtil` for
     colours). Return `ctx.fail("…")` on bad input.
   - `enter(ctx)`: reset state, take timestamps.
   - `execute(ctx)`: return `BlockStatus::running()` while waiting, `BlockStatus::done(port)` when finished.
   - `portCount()` / `portName(i)` if the block has more than `next`.
2. Add one line to the table in [BlockFactory.cpp](../src/Block/BlockFactory/BlockFactory.cpp).
3. Add the type to `BLOCK_TYPES` in [tools/validate_programs.py](../tools/validate_programs.py)
   and document it here.

`BlockContext` gives access to variables, LEDs, the button, results and the pod network
(`IPodNetwork`: `arm`, `reset`, `pollEvent`, `nowUs`). Blocks should not use the
singletons directly.

## 5. Phone override

During the program menu the central offers a BLE characteristic `MaxLoop`. A number
> 0 written there replaces `MAX_LOOPS` of the program that is selected next. After the
selection BLE is switched off, so the value cannot be changed during a game.

## 6. Program format revisions

The config API reports the revision of the program format a firmware understands as
`programFormat` in `info` ([config-api.md](config-api.md) §5). It is increased whenever a
block type gets new fields, ports or semantics, so configuration software can tell whether a
pod supports a program before it uploads it. The firmware constant is
`BlockFactory::PROGRAM_FORMAT` ([BlockFactory.h](../src/Block/BlockFactory/BlockFactory.h)),
the validator's is `PROGRAM_FORMAT` in [tools/validate_programs.py](../tools/validate_programs.py).

`"version": 1` in a program file is the file layout (§1.2), not this revision.

| `programFormat` | Firmware | Changes |
|---|---|---|
| 1 | 2.0 | first JSON program format: block types `led`, `delay`, `button`, `if`, `setVariable`, `remotePress`, `remoteMultiPress`, `remoteResetAll`, `summary` as described in §2 |

Firmware before 2.3 does not report `programFormat`; treat a missing field as revision 1.

## 7. Engine semantics

Exact runtime behaviour of the block engine, for simulators (e.g. the Config App) that must
behave like the pod. Code references are relative to `src/`. When one of these details
changes, increase `programFormat` (§6).

### 7.1 Loop passes and step limit

- The central calls `BlockManager::run()` once per loop pass (`loop()` never sleeps, a pass
  takes µs while blocks wait, see [timing.md](timing.md) §1.1).
- In one pass the engine executes the current block. If it finishes, the block is left
  (`exit`), the next block is entered (`enter`) and executed **in the same pass**, and so on.
- At most `MAX_STEPS_PER_PASS = 32` blocks are executed per pass
  ([BlockManager.h](../src/BlockManager/BlockManager.h), `BlockManager::run`). When the limit is
  reached, the block that was entered last is executed in the next pass. Nothing is lost
  or skipped. An endless loop of instant blocks therefore never hangs the pod: it runs 32
  steps per pass, and the button, the radio and the serial console keep working.
- `enter()` is called every time a block becomes current, also when a block links to
  itself. Times (entry time, random durations, random timeouts) are taken in `enter()`.
- Port selection (`BlockManager::run`): the block's result port is used if it is connected.
  Otherwise, if the block's port 0 is called `next` (every type except `if`), `next` is used.
  If that is not connected either, the program ends (`running = false`, no error).
- After a pause (a peripheral was lost, state PAUSED) the central re-enters the current
  block (`BlockManager::restartCurrentBlock`: `exit` + `enter`). Its timers restart and
  random values are drawn again.
- Values that name a variable are read when the block uses them (see the table below).
  An unknown variable reads as 0 (`VariableManager::resolve` creates it with 0).

### 7.2 Instant and waiting blocks

| Type | Finishes | Value read |
|---|---|---|
| `led`, `if`, `setVariable`, `remoteResetAll`, `summary` | immediately, in the pass it is entered | on execute |
| `delay` | when `millis() ≥ entry + duration` (checked once per pass). A duration of 0 finishes in the entry pass | on enter |
| `button` | on press / release / timeout | timeout on enter, `shortMs` on release |
| `remotePress` | on the peripheral's press / timeout. Immediately through `timeout` if the pod does not exist | `pod` on enter, `timeoutMs` every pass |
| `remoteMultiPress` | when all green pods are pressed / an avoid pod is pressed / timeout | `pods`, `avoid`, `syncStartMs` on enter, `timeoutMs` every pass |

### 7.3 Random numbers

All random numbers come from `esp_random()` ([Block/RandomUtil.h](../src/Block/RandomUtil.h)).

- `setVariable` `random`: uniform in **[0, value − 1]**. `value` ≤ 1 gives 0.
- `setVariable` `randomOther` ([SetVariableBlock.cpp](../src/Block/SetVariableBlock/SetVariableBlock.cpp)):
  - `value` ≥ 2 and the current value is in [0, value − 1]: uniform among the other
    `value − 1` numbers, never the current one.
  - `value` ≥ 2 and the current value is outside that range: like `random`.
  - `value` ≤ 1: always 0 (there is no other number to choose).
- `delay` `minMs`/`maxMs` and `button` `minTimeoutMs`/`maxTimeoutMs`: uniform in
  **[min, max], both inclusive** (`RandomUtil::between`). A negative `min` counts as 0.
  If `max` ≤ `min`, the result is `min`. `ms` / `timeoutMs` is the same with min = max.

### 7.4 `button`

Code: [ButtonBlock.cpp](../src/Block/ButtonBlock/ButtonBlock.cpp), [Input/Button.h](../src/Input/Button.h).

- Only a press **edge after** the block was entered counts (the press counter is stored in
  `enter`). A button held while the block is entered is ignored until it is released and
  pressed again.
- Debounce: an edge is taken immediately, further edges within 20 ms are ignored.
- On the press edge the reaction time (*press time − entry time*, ms) is recorded
  (`record`) and stored (`storeAs`).
- If the `pressed` port is **connected**, the block leaves through `pressed` on the press
  edge. `short` / `long` are never taken then.
- Otherwise the block waits for the **release** and leaves through `short` if the press
  lasted **less than** `shortMs`, else `long` (a press of exactly `shortMs` is `long`).
  Nothing happens when `shortMs` is reached while the button is still held: `long` is
  taken only on the release. Unconnected `short` / `long` fall back to `next`.
- `timeout` is only checked **before** a new press. A held button from before the block
  does not stop the timeout. Once a new press has started, the timeout no longer applies
  and the block waits for the release, however long it takes.
- A timeout of 0 (or a random timeout that comes out as 0, or a negative one) means
  **no timeout**.

### 7.5 `remotePress`

Code: [RemotePressBlock.cpp](../src/Block/RemotePressBlock/RemotePressBlock.cpp).

- `pod` is a peripheral id `0 … connected − 1`. Any higher id, **including the central's
  own id** (`REQUIRED_PERIPHERALS`), does not exist: nothing is lit
  and the block leaves through `timeout` in the pass it is entered. The same happens in a
  program without peripherals. (`pod` is taken modulo 256, so do not use negative ids.)
- Only the press that answers this activation (command sequence number) counts.
- After the press the pod is reset (`colorAfter`); the reaction time measured on the
  peripheral is recorded / stored.
- `timeoutMs` counts from the entry. **0 means an immediate timeout** (unlike `button`).
  Without `timeoutMs` the block waits forever. On timeout the pod is reset.

### 7.6 `remoteMultiPress`

Code: [RemoteMultiplePressBlock.cpp](../src/Block/RemoteMultiplePressBlock/RemoteMultiplePressBlock.cpp).

- Number of peripherals `n` = `pods` (default: all connected), limited to
  **[0, connected peripherals]** (and 31). `pods` larger than the number of connected
  peripherals uses all connected ones, no error. Peripherals `0 … n − 1` take part.
- The central takes part as id `n` in the draw if `includeCentral` (default true); its
  results use its normal id (`REQUIRED_PERIPHERALS`). Total
  `t = n + (includeCentral ? 1 : 0)`.
- The number of avoid pods is `avoid` limited to **[0, t − 1]**, so at least one pod is
  always green. The avoid pods are drawn uniformly from all `t` ids, **the central
  included**.
- `t = 0` (no peripherals, central excluded): the block leaves through `next` immediately.
- Peripherals light at network time *entry + `syncStartMs`* (default 20 ms; 0 = when the
  command arrives). The central lights at the same time. Presses of the central before it
  is lit do not count.
- A press of an avoid pod (peripheral or central) leaves through `avoidHit` immediately.
  The other pods stay lit.
- A green peripheral is reset when pressed and its reaction time recorded. A green central
  switches its LEDs off when pressed; its reaction time is measured from the moment it lit.
- When all green pods are pressed the block leaves through `next`. `timeoutMs` counts from
  the entry, **0 means an immediate timeout**; without it there is no timeout.
- Pods that were not pressed stay lit (also after `avoidHit` / `timeout`).

### 7.7 `summary`

Code: [SummaryBlock.cpp](../src/Block/SummaryBlock/SummaryBlock.cpp), [Results.cpp](../src/Results/Results.cpp).

- Statistics are kept per metric since the last `summary` of that metric with `reset`
  (or the `results` API op with `reset`). `average` is the integer average (truncated).
- **No values** for the metric: `count` = 0, `average` = 0, `best` = 0, `worst` = 0. These
  zeros are printed (`SUMMARY,<metric>,0,0,0,0`) and stored in the `store…` variables.
- `best` is the smallest value, `worst` the largest.
- With `reset` (default true) the metric is cleared afterwards.

### 7.8 Other blocks

- `led` without `leds` sets all 18 LEDs. With `leds`, the other LEDs keep their colour.
- `if` has no `next`: an unconnected `true` / `false` ends the program.
- `remoteResetAll` resets peripherals `0 … min(pods, connected) − 1` (default all connected),
  and switches the central's LEDs off unless `ledsOff` is false.
