# Writing Programs (JSON)

Game programs are JSON files on the central's file system (SPIFFS). They are not compiled
into the firmware. To add or change a game, you edit files in `data/`, check them, and
upload the file system image:

```sh
python tools/validate_programs.py   # checks types, fields, links, colours, path lengths
pio run -e NewBoard -t uploadfs     # writes data/ to the SPIFFS partition
```

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

Ports: `next` (pressed), `timeout` (also taken if the pod does not exist)

### `remoteMultiPress` – light several pods at once
| Field | | Default |
|---|---|---|
| `pods` | value, number of peripherals | all connected |
| `avoid` | value, number of red "do not press" pods (central included in the draw) | 0 |
| `includeCentral` | central takes part | true |
| `hitColor`, `avoidColor` | named colours | green, red |
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

`BlockContext` gives access to variables, LEDs, the button, results and the connected
peripherals. Blocks should not use the singletons directly.
