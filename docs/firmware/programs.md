# Writing Programs (JSON)

Game programs are JSON files on the central's file system (SPIFFS). They are not compiled
into the firmware. To add or change a game, you edit files in `firmware/data/`, check them, and
upload the file system image:

```sh
python tools/validate_programs.py   # checks types, fields, links, colours, path lengths
pio run -d firmware -e NewBoard -t uploadfs     # writes firmware/data/ to the SPIFFS partition (USB)
python tools/reactpod_config.py push firmware/data   # or: upload over BLE to a central in the menu
```

Programs uploaded over BLE spread to all pods of the set automatically. See
[config-api.md](config-api.md).

> Flashing the firmware (`-t upload`) does **not** update `firmware/data/`. After a fresh flash run
> `uploadfs` once, otherwise the central shows the red error blink ("No programs found").

## 1. Files

```
firmware/data/
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

### Timers – fields of every block

`programFormat` ≥ 2 (§6). Any block, of any type, may also carry:

| Field | | Default |
|---|---|---|
| `timerStart` | timer name. Starts the timer when the block is **entered** | – |
| `timerStop` | timer name. When the block is **left**, records *now − start* (ms) as the metric `<name>` with the central's pod id, then clears the timer | – |

```json
{ "name": "Go",     "type": "remotePress", "pod": 0, "timerStart": "lap", "next": "Back" },
{ "name": "Finish", "type": "button", "timerStop": "lap", "next": "Report" }
```

- A timer name is a non-empty string, like a metric name. A program (with its includes)
  may use at most 16 different timer names.
- The time is recorded exactly like `record`: `RESULT` line, statistics, `summary`.
- On a waiting block (`button`, `remotePress`, …) the stop time is the moment the block
  is left, i.e. the press. For remote blocks that is when the central receives the press
  (a few ms after the press on the peripheral).
- A block with both fields and the same name measures its own duration.
- Engine details (restart, orphan stops, pause): §7.9.

### Countdown – option of the timed blocks

`programFormat` ≥ 3 (§6). `delay`, `button`, `remotePress`, `remoteMultiPress`, `charge`, `release` and `toggle` (≥ 4) may show how
much of their time limit is left on the LED ring:

| Field | | Default |
|---|---|---|
| `countdown` | `secret`, `drain`, `fill`, `dim`, `colorShift` or `trafficLight` | `secret` (no animation, as before) |
| `countdownColor` | named colour, end colour of `colorShift` | red |
| `countdownTarget` | `delay` only: `"central"`, `"all"`, `"peripherals"` or a pod id (value) | `"central"` |
| `countdownFrom` | `delay` and `button` only: named start colour (these blocks have no lit colour of their own) | green |

```json
{ "name": "Hit", "type": "remotePress", "pod": "P", "timeoutMs": 1500, "countdown": "drain", "next": "Ok", "timeout": "Miss" },
{ "name": "Ready", "type": "delay", "minMs": 2000, "maxMs": 4000, "countdown": "trafficLight", "countdownTarget": "all", "next": "Go" }
```

- The countdown runs over the block's **time limit**: the duration of a `delay` (`ms`, or the
  random duration), the timeout of the others (`timeoutMs`, or the random timeout of `button`).
  It starts with the lit colour of the block (`color` of `remotePress`, `hitColor` / `avoidColor`
  of `remoteMultiPress`, `countdownFrom` of `delay` and `button`).
- Styles: `drain` = the ring is full and empties LED by LED (empty at the end); `fill` = it starts
  empty and fills up; `dim` = full brightness fades to dark; `colorShift` = the lit colour blends
  into `countdownColor`; `trafficLight` = green, yellow, red, one third of the time each (the lit
  colour is not used).
- A `button`, `remotePress` or `remoteMultiPress` without a time limit and with `countdown` ≠
  `secret` is rejected (validator and firmware).
- On peripherals the countdown runs on the pod itself (ARM carries the effect), so it ends
  with the pod's timeout. On `remoteMultiPress` all lit pods and the central count down together.
- With a countdown `timeoutMs` is read **once when the block is entered** (§7.2).
- A press stops the countdown. `colorAfter`, press handling and reaction times are unchanged
  (reaction times count from the first lighting).
- Pods with older firmware (no `effects`) count down `secret`: they stay lit with the lit colour.
- `charge`: the countdown runs over `timeoutMs` on the idle ring and ends with the first hold. `release`: over
  `maxHoldMs` from the start of the hold (trigger), or over `timeoutMs` from the colour switch (signal);
  `countdownFrom` is not used. Details: §7.13, §7.14.
- `toggle`: the countdown runs over the whole game on every pod and the central, in the colour of the pod's current team (a flip
  changes the colour, the animation goes on). Details: §7.15.
- Details: §7.12.

### `effect` – ring effect
`programFormat` ≥ 3 (§6). Plays an animation on the ring of the central and / or the peripherals.

| Field | | Default |
|---|---|---|
| `target` | `"central"`, `"all"` (central + all peripherals), `"peripherals"` or a pod id (value; the central's own id = the central) | `"central"` |
| `effect` | `solid`, `fill`, `drain`, `dim`, `colorShift`, `trafficLight`, `blink`, `pulse`, `spin`, `off` | required |
| `color`, `color2` | named colours | white, off |
| `durationMs` | value, length of the effect. For `blink`, `pulse`, `spin`: 0 / missing = endless (until the next LED change) | – |
| `periodMs` | value, one cycle of `blink`, `pulse`, `spin` | 500 |
| `brightness` | value 0 … 255 | 255 |
| `leds` | LED indices, **central only** (ignored on pods) | all 18 |
| `syncStartMs` | value: all targets start together this long after the block starts | 20 |
| `wait` | `false`: start the effect and continue at once. `true`: continue when the effect has ended | `false` |

Ports: `next`

```json
{ "name": "Ready", "type": "effect", "target": "all", "effect": "pulse", "color": "blue",
  "periodMs": 500, "durationMs": 2000, "wait": true, "next": "Go" }
```

| `effect` | Shows |
|---|---|
| `solid` | the ring in `color` |
| `fill` | LEDs light one by one in `color` (background `color2`) over `durationMs`, ends with a full ring |
| `drain` | full ring in `color` that empties LED by LED over `durationMs`, ends with the background `color2` |
| `dim` | `color` fades from `brightness` to dark over `durationMs` |
| `colorShift` | `color` blends into `color2` over `durationMs` |
| `trafficLight` | green, yellow, red, one third of `durationMs` each (colours ignored) |
| `blink` | `color` and `color2` alternate, one cycle per `periodMs` |
| `pulse` | `color` fades down to dark and up again, one cycle per `periodMs` |
| `spin` | a segment of 3 LEDs in `color` turns once per `periodMs` on `color2` |
| `off` | the ring goes dark |

- `fill`, `drain`, `dim`, `colorShift` and `trafficLight` are timed: without `durationMs` they jump to
  their end frame. `blink`, `pulse` and `spin` with a `durationMs` end in a steady `color`.
- `wait: true` with an endless effect (`blink`, `pulse`, `spin` without a constant `durationMs` > 0) is an error.
- A later `led`, `remotePress`, `remoteResetAll`, … on the same ring replaces the effect.
  With `wait: false` the effect keeps running while the next blocks execute.
- Pods without effect support (older firmware) show `color` statically (`off` switches them off).
- Details: §7.11.

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
| `countdown`, `countdownColor`, `countdownTarget`, `countdownFrom` | optional ring countdown over the duration (see *Countdown*) | `secret` |

Ports: `next`

### `button` – wait for the central's button
| Field | | Default |
|---|---|---|
| `shortMs` | value, short/long threshold | 1000 |
| `timeoutMs` | value | no timeout |
| `minTimeoutMs`, `maxTimeoutMs` | value, random timeout | – |
| `record` | metric name: records *press time − block entry* | – |
| `storeAs` | variable for the same time | – |
| `countdown`, `countdownColor`, `countdownFrom` | optional ring countdown over the timeout, needs a timeout (see *Countdown*) | `secret` |

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
| `countdown`, `countdownColor` | optional countdown on the pod, needs `timeoutMs` (see *Countdown*) | `secret` |
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
| `countdown`, `countdownColor` | optional countdown on all lit pods and the central, needs `timeoutMs` (see *Countdown*) | `secret` |
| `record` | metric for every green pod's reaction time | – |

Ports: `next` (all green pods pressed), `avoidHit`, `timeout`. Pods that were not pressed
stay lit, so follow with `remoteResetAll`.

### `charge` – hold the button to charge
`programFormat` ≥ 3 (§6). The ring shows how long the button has been held. Needs the `hold` link feature on
peripherals (firmware ≥ 2.9, [link-protocol.md](link-protocol.md) §2.2).

| Field | | Default |
|---|---|---|
| `pod` | `"central"` or a peripheral id (value). The central's own id also means the central | `"central"` |
| `onsetMs` | value. Minimum hold before charging starts | 0 |
| `maxMs` | value, ≥ 1. Hold time (after the onset) for a full charge | required |
| `style` | `fill`, `brightness`, `trafficLight`, `colorShift` | `fill` |
| `color` | named colour while charging | green |
| `color2` | `colorShift` only: end colour | red |
| `mode` | `release`: releasing ends the block. `accumulate`: releasing pauses (or drains, see `decayMs`) the charge, the block ends at `full` / `timeout` | `release` |
| `decayMs` | value, `accumulate` only: time to drain a full charge while released. 0 = keep the charge | 0 |
| `timeoutMs`, or `minTimeoutMs` + `maxTimeoutMs` | value, from the entry of the block (random like `button`). 0 / missing = none. `countdown` applies | none |
| `countdown`, `countdownColor` | optional countdown over the timeout on the idle ring (see *Countdown*); needs a timeout | `secret` |
| `storeAs` | variable: charge in ms (0 … `maxMs`) | – |
| `storePercent` | variable: charge 0 … 100 | – |
| `record` | metric for the charge in ms | – |

Ports: `released` (released after the onset), `early` (released before the onset; falls back to `released`
with charge 0), `full` (maximum reached: the block ends at once, the ring flashes), `timeout`, `next` (fallback
for the others).

```json
{ "name": "Charge", "type": "charge", "pod": "central", "onsetMs": 200, "maxMs": 2000, "style": "fill", "color": "green",
  "storeAs": "CHARGE", "record": "charge", "released": "Score", "full": "Overcharged", "timeout": "Missed" }
```

- As with `button`, a hold that started before the block was entered does not count: the button must be
  released and pressed again.
- Ring: `fill` lights the LEDs one by one, `brightness` fades from dim to full, `trafficLight` goes green,
  yellow, red, `colorShift` blends `color` into `color2`. Before the first hold the ring shows the start frame
  (`fill`: dark, `brightness`: dim, `trafficLight`: green, `colorShift`: `color`) or the countdown.
- The hold is measured and shown on the pod itself (it reports PRESSED when a hold starts and RELEASED when it
  ends), so the charge is exact to about 1 ms and the ring is smooth.
- A pod that does not exist, or has older firmware (no `hold` link feature), makes the block take `timeout` at once.
- Details: §7.13.

### `release` – the release is the event
`programFormat` ≥ 3 (§6). Two modes. Needs the `hold` link feature on peripherals.

1. `trigger`: the athlete holds the pod, letting go is the event, e.g. the start of a run.
2. `signal`: the athlete holds, the colour switches after a fixed or random time, and the athlete must let go as
   fast as possible (start reaction with false-start detection).

| Field | Mode | | Default |
|---|---|---|---|
| `mode` | both | `trigger` or `signal` | `trigger` |
| `pod` | both | `"central"` or a peripheral id (value) | `"central"` |
| `holdColor` | both | named colour while waiting for the hold | yellow |
| `heldColor` | both | named colour once the hold is detected ("you're set") | = `holdColor` |
| `allowHeld` | both | a hold that is already active on entry counts (it starts on entry) | `true` for `trigger`, `false` for `signal` |
| `holdTimeoutMs` | both | value. No hold within this time from the entry → `noHold`. 0 / missing = none | none |
| `maxHoldMs` | trigger | value. Held longer than this (from the start of the hold) → `timeout`. 0 / missing = none. `countdown` applies | none |
| `storeAs` | trigger | variable: hold duration in ms | – |
| `goColor` | signal | named colour of the switch | green |
| `goMs`, or `minGoMs` + `maxGoMs` | signal | value. Time from the start of the hold to the switch; random in [min, max] (inclusive), drawn once on entry. Required | – |
| `timeoutMs` | signal | value. Not released this long after the switch → `timeout`. 0 / missing = none. `countdown` applies | none |
| `record`, `storeAs` | signal | reaction = release − switch, measured **on the pod** (ms) | – |
| `countdown`, `countdownColor` | both | optional countdown (see *Countdown*): trigger over `maxHoldMs` from the start of the hold, signal over `timeoutMs` from the switch | `secret` |

Ports: `next` (released; in `signal` released after the switch, reaction recorded), `noHold`, `falseStart`
(`signal` only: released before the switch), `timeout` (`trigger`: held too long, `signal`: released too late).
Unconnected `noHold`, `falseStart` and `timeout` fall back to `next`.

```json
{ "name": "Go",    "type": "release", "mode": "trigger", "pod": 0, "holdColor": "yellow",
  "storeAs": "HOLD_MS", "next": "Run", "noHold": "Idle" },
{ "name": "Start", "type": "release", "mode": "signal", "pod": 0, "holdColor": "yellow", "goColor": "green",
  "minGoMs": 1500, "maxGoMs": 3000, "timeoutMs": 1000, "record": "start",
  "next": "Run", "falseStart": "Foul", "noHold": "Idle", "timeout": "Late" }
```

- `trigger` leaves the block at the release (the central's receive time of RELEASED, as for remote presses), so a
  `timerStart` on the next block starts at the release.
- A pod that does not exist, or has older firmware, makes the block take `timeout` at once (`next` if unconnected).
- Details: §7.14.

### `toggle` – pods change team on every press
`programFormat` ≥ 4 (§6). Team and capture games ("domination"): the pods stay lit and every press flips a pod between
two team colours. Needs the `toggle` link feature on peripherals (older ones are left out of the game).

| Field | | Default |
|---|---|---|
| `pods` | value, number of peripherals | all connected |
| `includeCentral` | the central's own button takes part | true |
| `colors` | the two team colours `[A, B]` (named) | `["red", "blue"]` |
| `start` | `a`, `b`, `alternate` (every other pod, A first), `random` (each pod), `off` (unowned and dark until the first press, which makes the pod A) | `alternate` |
| `durationMs`, or `minDurationMs` + `maxDurationMs` | value. Game length; random in [min, max], drawn once on entry. Required | – |
| `cooldownMs` | value. Minimum time between two flips of one pod (0 … 65535) | 300 |
| `syncStartMs` | value. All pods and the central start this long after the block was entered (as `remoteMultiPress`) | 20 |
| `countdown`, `countdownColor` | optional countdown over the game, see *Countdown* | `secret` |
| `storeA`, `storeB` | variables: number of pods per team at the end | – |
| `storeTimeA`, `storeTimeB` | variables: owned time per team at the end, summed over all pods (ms) | – |
| `storeFlips` | variable: total number of flips | – |

Ports: `next` (time over), `allA`, `allB` (every pod and the central has team A / B, `allA` / `allB` are optional: an
unconnected one does **not** fall back to `next`, the game goes on). After the block the pods stay lit in their final
colour and a press no longer changes it; follow with `remoteResetAll`.

```json
{ "name": "Domination", "type": "toggle", "pods": "NODE_COUNT", "includeCentral": true,
  "colors": ["red", "blue"], "start": "alternate", "durationMs": 60000, "cooldownMs": 500, "countdown": "secret",
  "storeA": "RED_PODS", "storeB": "BLUE_PODS", "storeTimeA": "RED_MS", "storeTimeB": "BLUE_MS", "storeFlips": "FLIPS",
  "next": "Result", "allA": "RedWins", "allB": "BlueWins" }
```

- Details: §7.15.

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

### `repeat` – counted loop
`programFormat` ≥ 2 (§6).

| Field | | Default |
|---|---|---|
| `count` | value, number of passes through `body` | required |
| `storeIndex` | variable that gets the current pass (1 … `count`) | – |

Ports: `body` (one more pass), `done` (after `count` passes). Both fall back to `next`.

```json
{ "name": "Rounds", "type": "repeat", "count": "MAX_LOOPS", "storeIndex": "RUNS", "body": "OneRound", "done": "Summary" }
```

The last block of the body links back to the repeat block. Entering the block again after
`done` starts a new series of `count` passes. Details: §7.10.

## 3. Measurements

Blocks with `record` add a measurement to a named metric, and so does every `timerStop`
(metric = the timer name, pod id = the central's). Every measurement is printed on
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
   - `onProgramStart()` if the block keeps state across entries (e.g. a loop counter).
2. Add one line to the table in [BlockFactory.cpp](../../firmware/src/Block/BlockFactory/BlockFactory.cpp).
3. Add the type to `BLOCK_TYPES` in [tools/validate_programs.py](../../tools/validate_programs.py)
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
`BlockFactory::PROGRAM_FORMAT` ([BlockFactory.h](../../firmware/src/Block/BlockFactory/BlockFactory.h)),
the validator's is `PROGRAM_FORMAT` in [tools/validate_programs.py](../../tools/validate_programs.py).

`"version": 1` in a program file is the file layout (§1.2), not this revision.

| `programFormat` | Firmware | Changes |
|---|---|---|
| 1 | 2.0 | first JSON program format: block types `led`, `delay`, `button`, `if`, `setVariable`, `remotePress`, `remoteMultiPress`, `remoteResetAll`, `summary` as described in §2 |
| 2 | 2.8 | `timerStart` / `timerStop` on every block (§2 *Timers*, §7.9); block type `repeat` (§2, §7.10) |
| 3 | 2.9 | block type `effect` (§2, §7.11); `countdown`, `countdownColor`, `countdownTarget`, `countdownFrom` on `delay`, `button`, `remotePress`, `remoteMultiPress` (§2 *Countdown*, §7.12). With a countdown `timeoutMs` of `remotePress` / `remoteMultiPress` is read once on enter (§7.2). Block types `charge` (§2, §7.13) and `release` (§2, §7.14), with the hold reporting of link protocol revision 2 ([link-protocol.md](link-protocol.md) §2.2), also with `countdown`. Revision 3 is not released yet, so these were added to it without a new revision |
| 4 | 2.10 | block type `toggle` (§2, §7.15), with the toggle activations of link protocol revision 3 ([link-protocol.md](link-protocol.md) §2.3), also with `countdown` |

Programs of an older revision run unchanged on newer firmware. A program that uses fields
or block types of a newer revision is rejected by older firmware only if it uses a new
block type; unknown fields are ignored there, so check `programFormat` before uploading.

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
  ([BlockManager.h](../../firmware/src/BlockManager/BlockManager.h), `BlockManager::run`). When the limit is
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
| `led`, `if`, `setVariable`, `remoteResetAll`, `summary`, `repeat` | immediately, in the pass it is entered | on execute |
| `delay` | when `millis() ≥ entry + duration` (checked once per pass). A duration of 0 finishes in the entry pass | on enter (also the countdown fields) |
| `button` | on press / release / timeout | timeout on enter, `shortMs` on release |
| `remotePress` | on the peripheral's press / timeout. Immediately through `timeout` if the pod does not exist | `pod` on enter, `timeoutMs` every pass (on enter if `countdown` ≠ `secret`) |
| `remoteMultiPress` | when all green pods are pressed / an avoid pod is pressed / timeout | `pods`, `avoid`, `syncStartMs` on enter, `timeoutMs` every pass (on enter if `countdown` ≠ `secret`) |
| `effect` | `wait: false`: immediately. `wait: true`: when `now ≥ start + durationMs` (checked once per pass) | all fields in the entry pass (first execute) |
| `charge` | on release / full charge / timeout (§7.13). Immediately through `timeout` if the pod does not exist or cannot measure holds | everything (also the random timeout) on enter |
| `release` | on release / timeout / no hold (§7.14). Immediately through `timeout` as for `charge` | everything (also the random switch delay) on enter |
| `toggle` | when the game time is over / all pods one colour (§7.15) | everything (also the random duration) on enter |

### 7.3 Random numbers

All random numbers come from `esp_random()` ([Block/RandomUtil.h](../../firmware/src/Block/RandomUtil.h)).

- `setVariable` `random`: uniform in **[0, value − 1]**. `value` ≤ 1 gives 0.
- `setVariable` `randomOther` ([SetVariableBlock.cpp](../../firmware/src/Block/SetVariableBlock/SetVariableBlock.cpp)):
  - `value` ≥ 2 and the current value is in [0, value − 1]: uniform among the other
    `value − 1` numbers, never the current one.
  - `value` ≥ 2 and the current value is outside that range: like `random`.
  - `value` ≤ 1: always 0 (there is no other number to choose).
- `delay` `minMs`/`maxMs` and `button` `minTimeoutMs`/`maxTimeoutMs`: uniform in
  **[min, max], both inclusive** (`RandomUtil::between`). A negative `min` counts as 0.
  If `max` ≤ `min`, the result is `min`. `ms` / `timeoutMs` is the same with min = max.
- `charge` `minTimeoutMs`/`maxTimeoutMs` and `release` `minGoMs`/`maxGoMs`: the same, drawn once on enter.
  `goMs` is `minGoMs` = `maxGoMs`.

### 7.4 `button`

Code: [ButtonBlock.cpp](../../firmware/src/Block/ButtonBlock/ButtonBlock.cpp), [Input/Button.h](../../firmware/src/Input/Button.h).

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

Code: [RemotePressBlock.cpp](../../firmware/src/Block/RemotePressBlock/RemotePressBlock.cpp).

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

Code: [RemoteMultiplePressBlock.cpp](../../firmware/src/Block/RemoteMultiplePressBlock/RemoteMultiplePressBlock.cpp).

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

Code: [SummaryBlock.cpp](../../firmware/src/Block/SummaryBlock/SummaryBlock.cpp), [Results.cpp](../../firmware/src/Results/Results.cpp).

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

### 7.9 Timers (`timerStart` / `timerStop`)

Code: [BlockManager.cpp](../../firmware/src/BlockManager/BlockManager.cpp) (`enterCurrent`, `stopTimer`).

- `timerStart` is applied when the block is entered, **before** its `enter()`: the timer
  stores `millis()` and is running. A start on a running timer restarts it.
- `timerStop` is applied when the block is left, **after** its `exit()`, also when the
  program ends in that block. A running timer records *`millis()` − start* (ms) for the
  central's pod id (`REQUIRED_PERIPHERALS`) and stops. A stop on a timer that is not running
  is ignored and counted (`status.timers.orphanStops`, config-api.md §5).
- When a block is left and the next one entered, the stop of the old block comes before
  the start of the new one. A block that links to itself with both fields and the same
  name therefore records each of its passes.
- An instant block is entered and left in the same pass, so its own duration is 0 ms.
  Timer values are accurate to one loop pass.
- A pause (`restartCurrentBlock`) does not leave the block: timers keep running (the pause
  is part of the measured time) and are neither started nor stopped.
- All timers are stopped and the orphan count is 0 when the program starts.

### 7.10 `repeat`

Code: [RepeatBlock.cpp](../../firmware/src/Block/RepeatBlock/RepeatBlock.cpp).

- Every block has its own counter, 0 when the program starts (`onProgramStart`).
- On execute (once per entry) the counter is incremented and `count` is read. If
  counter ≤ `count`: `storeIndex` = counter, leave through `body`. Otherwise: counter = 0,
  leave through `done`; `storeIndex` keeps its last value.
- So `count` = 3 gives `body`, `body`, `body`, `done`, and the next entry starts again
  with pass 1. `count` ≤ 0 leaves through `done` on every entry and never sets `storeIndex`.
  A `count` lowered during the loop below the passes already made ends the loop at the
  next entry.
- Unconnected `body` or `done` fall back to `next` (§7.1). With neither connected the
  program ends.
- Nested repeats count independently: an outer `count` 2 around an inner `count` 3 runs
  the inner body 6 times.
- A pause (`restartCurrentBlock`) does not change the counter: the counter changes only on
  execute, and a re-entered block has not been executed yet.
- If the program leaves the body for good (never returns to the repeat block), the counter
  keeps its value until the block next reaches `done`. This is not detected.

### 7.11 `effect`

Code: [EffectBlock.cpp](../../firmware/src/Block/EffectBlock/EffectBlock.cpp), [EffectTarget.cpp](../../firmware/src/Block/EffectTarget.cpp),
effect player: [LEDManager.cpp](../../firmware/src/LEDManager/LEDManager.cpp) (`renderEffect`), frame formulas: [link-protocol.md](link-protocol.md) §2.1.

- **Start.** In the first `execute` after the entry (the entry pass; a pause re-enters the block
  and starts it again) all fields are read once. `durationMs` < 0 counts as 0, `periodMs` ≤ 0 as
  500 (max 65535), `brightness` is limited to [0, 255], `syncStartMs` < 0 counts as 0.
  Let `lead = syncStartMs` (default 20) and `start = entry time + lead` on the network clock
  (= the central's clock). The effect is sent to the targets with start time `start` (with
  `lead` = 0: "now", each pod as its command arrives). Until `start` the ring keeps its old
  colours; from `start` the frames are a function of `now − start` (a late pod joins the animation).
- **Target.** `central`: the central only. `peripherals`: peripheral ids 0 … connected − 1.
  `all`: both. A pod id (value, read at start): that peripheral; the central's own id
  (`REQUIRED_PERIPHERALS`) means the central; any other id is ignored (nothing shown, the
  block continues). Without peripherals only the central is affected.
- **Effect parameters.** The effect runs for the whole ring. `leds` (central only) limits the
  output to those LEDs, the others keep their colour; the geometry of `fill` / `drain` / `spin`
  stays that of the whole ring. `off` is a steady dark ring (colour off). `dim` fades from
  `brightness` to 0, for all other effects `brightness` scales the output. Colours are named
  colours for the central too.
- **`wait: false`** (instant block): continues in the same pass through `next`. The effect keeps
  running while the following blocks execute.
- **`wait: true`**: leaves through `next` when `now ≥ start + durationMs` (checked once per pass),
  so it takes `syncStartMs + durationMs` from the entry. Duration 0 (e.g. a variable that is 0)
  finishes right after `syncStartMs`. `blink`, `pulse`, `spin` with a constant `durationMs` ≤ 0 or
  none are rejected when the program is loaded. The effect is not stopped when the block is left.
- **End frames.** Timed effects stay in their end frame (`fill` full, `drain` and `off` dark,
  `colorShift` = `color2`, `trafficLight` red, `dim` dark). `blink`, `pulse` and `spin` with a
  duration end in a steady `color`. Endless effects run until the ring is changed.
- **Replacement.** On the central any static LED call (`led`, `remoteResetAll` with `ledsOff`,
  a pressed central in `remoteMultiPress`, …) or another effect replaces it. On a peripheral an
  ARM activation, a press result or RESET replaces it.
- **Old pods.** A peripheral without the `effects` link feature shows `color` statically at
  `start` (an ARM with `colorActive`; `off` is a RESET). It stays lit until the next ARM / RESET.
  The block still waits for the full duration.

### 7.12 Countdown

Code: [Countdown.cpp](../../firmware/src/Block/Countdown.cpp) (effect for a style), the four blocks.

A countdown is a ring effect (link-protocol.md §2.1) with `color` = the lit colour `L` and
`durationMs` = the playing time `D`:

| `countdown` | Effect | Ring at the end |
|---|---|---|
| `drain` | `drain`, `color` L, background off | dark |
| `fill` | `fill`, `color` L, background off | full, colour L |
| `dim` | `dim`, `color` L, brightness 255 → 0 | dark |
| `colorShift` | `colorShift`, L → `countdownColor` (default red) | `countdownColor` |
| `trafficLight` | `trafficLight` (colours ignored) | red |

`D` is the time limit `T` read on enter (minus the lead time where noted). If `T` ≤ 0 (a
timeout of 0 for `remote…`, a delay of 0, `button` without timeout) there is no countdown. `secret`
never plays an effect.

- **`delay`**: `T` = the drawn duration, `L` = `countdownFrom` (green). Central only: the effect
  starts on enter (`D = T`). If the target includes peripherals and `T` > 20 ms, it starts
  20 ms after the entry on all targets and `D = T − 20`, so that it ends with the delay.
  `countdownTarget` as for the `effect` block, pods without effect support show nothing. When the
  block is left the central stops its effect (the ring keeps the last frame).
- **`button`**: `T` = the drawn timeout, `L` = `countdownFrom`. The effect starts on enter on the
  central (`D = T`). A press (the edge that counts) or leaving the block stops it; the ring
  keeps the last frame. Timeout and reaction time are unchanged.
- **`remotePress`**: `T` = `timeoutMs` **read once on enter**, `L` = the pod's `color`
  (`colorActive`). The ARM command carries the effect (`D = T`), which the pod plays from its
  activation (the ARM command's arrival, as before). Because the central times out `T` after
  its entry, the pod's countdown ends a few ms (link latency) after the timeout is taken. On press or
  timeout the pod is reset as before (the countdown ends). A pod without effect support stays lit with `L`.
- **`remoteMultiPress`**: `T` = `timeoutMs` read once on enter, `L` per pod = its lit colour
  (`hitColor` / `avoidColor`). All lit pods (hit and avoid) and the central (if it takes part, with its
  own lit colour) start the effect at the common start time `entry + syncStartMs` and
  `D = T − syncStartMs`, so they run out together at the timeout. If `D` ≤ 0 there is no countdown.
  A pressed green pod is reset, a pressed central switches off (both end their countdown); the
  other pods keep counting down until the end frame, also after `avoidHit` / `timeout` (follow
  with `remoteResetAll` as before).
- Without a countdown `timeoutMs` is still read every pass (§7.2).
- The central's countdown uses the same effect player as the `effect` block: a later static LED
  call replaces it.

### 7.13 `charge`

Code: [ChargeBlock.cpp](../../firmware/src/Block/ChargeBlock/ChargeBlock.cpp), [HoldBlock.cpp](../../firmware/src/Block/HoldBlock.cpp),
the hold itself: [Link/HoldSession.cpp](../../firmware/src/Link/HoldSession.cpp) (the central's own button and the
peripheral run the same code), wire format: [link-protocol.md](link-protocol.md) §2.2.

**Enter.** Read once: `pod`, `onsetMs` (< 0 counts as 0), `maxMs` (< 1 counts as 1), `decayMs` (< 0 as 0; ignored
unless `accumulate`) and the timeout `T`: `timeoutMs`, or a random value in [`minTimeoutMs`, `maxTimeoutMs`] (§7.3);
`T ≤ 0` or no timeout field means **no timeout** (as `button`, unlike `remotePress`). `pod` is the central if it is
`"central"`, missing, or equals the central's own id (`REQUIRED_PERIPHERALS`). Otherwise it is a peripheral id
`0 … connected − 1`; a peripheral without the `hold` link feature, or any other id, **cannot take part**: nothing
is lit or stored and the block leaves through `timeout` in the pass it is entered. Then the idle ring is shown.

**Hold.** A hold starts at a press edge **after** the entry (the press counter is stored on enter, §7.4); a button
that is down on entry is ignored until it is released and pressed again. Let `p` be the press edge, `r` the release
edge (button timestamps, not the time a pass notices them; the debounce is 20 ms). Charge in ms:

- while held: `charge = min(maxMs, c0 + max(0, (t − p) − onsetMs))`. `c0` is the charge at `p`: 0 in `release` mode,
  in `accumulate` the charge kept from earlier holds. The onset applies to **every** hold.
- after a release in `accumulate`: `decayMs = 0`: `charge` is kept. Else it drains linearly,
  `charge(t) = max(0, c − (t − r) · maxMs / decayMs)`.
- the charge is rounded to whole ms when it is reported.

**Ring** (central and pod alike). Idle (before the first hold): `fill` dark, `brightness` the colour at brightness 40
(of 255), `trafficLight` green, `colorShift` `color`; if the block has a countdown and `T > 0`, the countdown
(§7.12, lit colour `color`, duration `T`, started on enter) instead. At the start of a hold the ring shows the frame
for the current charge (this replaces a countdown, which does not come back). From `p + onsetMs` the charge effect
runs, a function of `charge / maxMs`: `fill`: LED n lights at n/18 of the charge, `brightness`: 40 → 255, `trafficLight`:
green, yellow, red in thirds, `colorShift`: `color` → `color2` (default red). In `accumulate` a release freezes the
ring at the charge (drawn about 30 times a second while it drains).

**Ending, `release` mode.** The first of:

1. `full`: the charge reaches `maxMs`, i.e. at `p + onsetMs + maxMs`. The pod / central reports it at that moment, without
   waiting for the release (a release edge at or after that time also counts as full). The ring flashes (`color`;
   `trafficLight`: red; `colorShift`: `color2`; 600 ms, 200 ms period, dark afterwards) and is **not** reset. The
   block leaves through `full`; stored: `maxMs`, 100 %, `record` `maxMs`.
2. A release edge `r` with `r − p < onsetMs`: port `early`, if it is not connected `released`. Charge 0 is stored.
3. Any other release edge: port `released`, charge = `(r − p) − onsetMs` (0 for an exact `onsetMs`).
4. Timeout (below).

`storeAs` (ms), `storePercent` (`(charge · 100 + maxMs / 2) / maxMs`, integer) and `record` (ms, with the pod's id, or
`REQUIRED_PERIPHERALS` for the central) are written for 1, 2 and 3. After `released`, `early` and `timeout` the pod / ring
is reset (dark).

**Ending, `accumulate` mode.** Only `full` (as above, with the charge that has accumulated: the `full` moment is
`p + onsetMs + (maxMs − c0)`) and `timeout`. `released` and `early` are never taken; a release only pauses the charge.

**Timeout.** `T` counts from the entry **until the block ends, also during a hold** (checked after the events of a pass;
an event received in the same pass wins). `release` mode: leave through `timeout`, nothing is stored, the pod is reset.
`accumulate` mode: the pod (or the central's own session) stops `T` ms after its activation and reports the charge it
has then (decayed if released); the block leaves through `timeout` with that charge stored (`storeAs`, `storePercent`,
`record`). The central waits up to 300 ms after its own `T` for the pod's report; if it does not come, nothing is stored.

**Pause.** `restartCurrentBlock` ends the activation and enters again: charge 0, a new random timeout. A peripheral
that cannot be reached keeps its ring until the new ARM.

### 7.14 `release`

Code: [ReleaseBlock.cpp](../../firmware/src/Block/ReleaseBlock/ReleaseBlock.cpp), [HoldBlock.cpp](../../firmware/src/Block/HoldBlock.cpp),
[Link/HoldSession.cpp](../../firmware/src/Link/HoldSession.cpp), wire format: [link-protocol.md](link-protocol.md) §2.2.

**Enter.** Read once: `pod`, `holdTimeoutMs`, `maxHoldMs` (trigger), `goMs` / `minGoMs` + `maxGoMs` (signal: the switch
delay `G` is drawn once, §7.3, negative values count as 0), `timeoutMs` (signal), `allowHeld`; for each value `≤ 0` or
missing means none. The pod is resolved as for `charge` (§7.13): a pod that does not exist or cannot measure holds
makes the block leave through `timeout` at once (`next` if `timeout` is unconnected). Then the ring shows `holdColor`.

**Start of the hold.** A press edge after the entry. With `allowHeld` a button that is already down on entry starts the
hold **at the entry** (not at the physical press, so `storeAs` of `trigger` counts from the entry). Without it a button
that is down is ignored until released and pressed again. Let `s` be the start of the hold. The ring shows `heldColor`
(`trigger` with a countdown and `maxHoldMs > 0`: the countdown over `maxHoldMs`, lit colour `heldColor`, from `s`).
The central learns of the start when it receives PRESSED (its own button: in the pass that sees it).

**`trigger`.** A release edge `r`: leave through `next`; `storeAs` = `r − s` in ms (rounded). The block is left in the
pass in which the central receives RELEASED (the central's own button: the pass that sees the release), so a
`timerStart` on the next block starts then, a few ms after the physical release for a peripheral. The pod / ring is reset.

**`signal`.** At `s + G` the ring switches to `goColor` (or, with a countdown and `timeoutMs > 0`, the countdown over
`timeoutMs`, lit colour `goColor`). A release edge `r`:

- `r < s + G`: false start, port `falseStart`. Nothing is stored or recorded.
- otherwise: reaction = `r − switch` where `switch` is the moment the pod updated its LEDs at `s + G` (an ideal
  simulator: `s + G`); ≥ 0, rounded to ms. `record` and `storeAs` get it, port `next`.

**Timeouts** (the central's clock, a few ms of link latency are not modelled by the simulator):

- `noHold`: the hold has not started `holdTimeoutMs` after the entry. Only checked until a hold has started.
- `trigger` `timeout`: not released `maxHoldMs` after the start of the hold (where the central saw it start).
- `signal` `timeout`: not released `G + timeoutMs` after the start of the hold, i.e. `timeoutMs` after the switch.
- Events of a pass are handled before the timeouts. After `noHold` and `timeout` the pod / ring is reset, nothing is stored.

An unconnected `noHold`, `falseStart` or `timeout` falls back to `next` (§7.1). **Pause:** as `charge`.

### 7.15 `toggle`

Code: [ToggleBlock.cpp](../../firmware/src/Block/ToggleBlock/ToggleBlock.cpp), the flip on the pod:
[PeripheralRole.cpp](../../firmware/src/Roles/Peripheral/PeripheralRole.cpp) (`runToggle`), wire format:
[link-protocol.md](link-protocol.md) §2.3.

**Enter.** Read once: `pods`, `cooldownMs` (clamped to 0 … 65535), `syncStartMs` (< 0 counts as 0), the duration `D`
(`durationMs`, or random in [`minDurationMs`, `maxDurationMs`], §7.3; `D ≤ 0` ends the block at the start) and, for
`start: "random"`, one draw per participant. The participants are the peripherals `0 … pods − 1` that have the `toggle`
link feature (the others are left out, the log has "cannot toggle") and, with `includeCentral`, the central (index
`pods`). The start owner is set per participant in this order (central last): `a`, `b`, `alternate` = A for the 1st, 3rd, …
participant and B for the others, `random`, `off` = nobody. Let `t0` = entry + `syncStartMs`: all pods and the central show their
colour at `t0` (as in `remoteMultiPress`, §7.6). The game runs from `t0` to `t0 + D`.

**Flip.** A press edge after `t0` flips the pod: A → B, B → A, nobody → A. A press less than `cooldownMs` after the
last *accepted* press of that pod is ignored (button timestamps, not the time a pass notices them); the first press always
counts. Several presses noticed in one pass count once. The pod flips on its own and reports `{owner, flipCount}` (the
central's own button flips in the pass that sees the press). The ring shows the new colour at once.

**Central bookkeeping.** For every participant the central keeps `owner`, `flipCount` and the time of the last owner change.
A PRESSED event counts if pod and `cmdSeq` match the activation, `flipCount` is above the last one seen (older and
duplicate frames are dropped) and it was received no later than `t0 + D`. A skipped `flipCount` (lost frame) adds to the
flip total; if the owner differs, the time since the last change goes to the old owner, with the **central's receive
time** as the moment of the change (a few ms after the press; an ideal simulator uses the press time). Owned time per team
is the sum over all participants, so with N pods it can reach N · D.

**Ending.** Checked each pass after the events:

1. `allA` / `allB`: after a flip, every participant (also the central) has the same team and the port is connected.
   Not connected: the game goes on. At least one participant is needed. This is checked only after a flip, never on entry.
2. Time over: `now ≥ t0 + D` → `next`.

At the end the owned time of the current owners is closed at the end time (`t0 + D` for `next`, the current time for
`allA` / `allB`) and `storeA` / `storeB` (pods per team, nobody is not counted), `storeTimeA` / `storeTimeB`
(rounded ms), `storeFlips` (sum of all `flipCount`s, central included) are written. Participants then show their final
colour frozen: the central's ring is set (a countdown ends), a peripheral gets a plain activation with that colour before and
after the press (so a press changes nothing). Nothing is reset; follow with `remoteResetAll`.

**Pause.** `restartCurrentBlock` enters again: new random duration, new start owners, flips and times start from zero. A pod
that is not reached keeps its state until the new ARM.
