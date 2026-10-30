# Programs (JSON)

Game programs are JSON files on SPIFFS, not compiled into the firmware. Edit `firmware/data/`, then
`python tools/validate_programs.py` and `pio run -d firmware -e NewBoard -t uploadfs` (USB), or
`python tools/reactpod_config.py push firmware/data` (BLE, central in the menu); the set syncs them.
`-t upload` does not write `firmware/data/`: after a fresh flash run `uploadfs` once, else the central
shows the error blink.

## 1. Files

```
firmware/data/programs.json     menu: list and order
firmware/data/prog/*.json       programs (inline or metadata + includes)
firmware/data/prog/lib/         loop.json (round counter, cycle timer, summary, report), star.json,
                                random.json, multi.json (run / avoid)
```
Paths ≤ 31 characters incl. the leading `/`.

### 1.1 `programs.json`
`{ "programs": ["/prog/solo.json", …] }`: menu order (short press = next, long press = start).

### 1.2 Program file
```json
{ "version": 1, "name": "Dreieck", "description": "ignored by the firmware", "peripherals": 2,
  "menu": [ { "leds": [7, 9, 11], "color": "blue" } ], "variables": { "MAX_LOOPS": 12 },
  "include": ["/prog/lib/loop.json", "/prog/lib/random.json"], "start": "StartCycle", "blocks": [ ] }
```

| Field | Meaning |
|---|---|
| `version` | file layout (1), not the program format (§6) |
| `peripherals` | pods the central claims before the game; sets `REQUIRED_PERIPHERALS` and `NODE_COUNT` (+1) |
| `menu` | LED groups in the menu: `leds` (0–17), `color` |
| `variables` | integer start values; override those of includes |
| `include` | fragments with more `variables` / `blocks`, loaded first in order, depth ≤ 3 |
| `start` | first block (default: the first block) |

Block names are unique over the program and its includes; a fragment may link to blocks it does not
define (`lib/star.json` ends in `EndLoop` from `lib/loop.json`).

### 1.3 Pod ids
Peripherals `0 … peripherals − 1` in claim order; the central is `peripherals` (= `REQUIRED_PERIPHERALS`).
Results use the same ids.

## 2. Blocks

Every block has `name`, `type` and ports (key = port, value = target block name):
`{ "name": "Wait", "type": "button", "pressed": "FalseStart", "timeout": "Go" }`.

- An unconnected port falls back to `next` if the type has `next`; no target at all = program ends
  (validator note). Instant blocks chain in one pass; waiting blocks never block the loop (§7).
- *value* fields take a number or a variable name, read when the block uses them (§7.2).
- Colours: `"red"`, `"#FF8800"`, `[255,136,0]`; named: off/black, red, green, blue, yellow, magenta, cyan,
  white. Colours for **peripherals** must be named (the link carries colour indices only).

### Timers – any block (`programFormat` ≥ 2)

| Field | |
|---|---|
| `timerStart` | timer name; starts when the block is **entered** |
| `timerStop` | when the block is **left**, records *now − start* (ms) as metric `<name>` for the central's id, then clears |

≤ 16 timer names per program. Recorded like `record`. On waiting blocks the stop is the moment the block
is left (remote: when the central receives the press). Same name on one block = its own duration. §7.9.

### Countdown – timed blocks (`programFormat` ≥ 3)

`delay`, `button`, `remotePress`, `remoteMultiPress`, `charge`, `release`, `toggle` (≥ 4):

| Field | | Default |
|---|---|---|
| `countdown` | `secret`, `drain`, `fill`, `dim`, `colorShift`, `trafficLight` | `secret` (none) |
| `countdownColor` | named end colour of `colorShift` | red |
| `countdownTarget` | `delay` only: `"central"`, `"all"`, `"peripherals"`, pod id (value) | `"central"` |
| `countdownFrom` | `delay`, `button` only: named start colour | green |

Runs over the block's time limit, starting in the lit colour. A `button`, `remotePress` or
`remoteMultiPress` with a countdown but no time limit is rejected. A press stops it; reaction times are
unchanged. Pods without `effects` stay lit (`secret`). Exact behaviour per block: §7.12–§7.15.

### Block reference

| Type | Fields (default) | Ports |
|---|---|---|
| `led` | `color` (req.), `leds` (all 18) | next |
| `delay` | `ms`, or `minMs` + `maxMs` (random); countdown fields | next |
| `button` | `shortMs` (1000), `timeoutMs` or `minTimeoutMs` + `maxTimeoutMs` (none), `record`, `storeAs` (press − entry), countdown fields (needs a timeout) | pressed, short, long, next, timeout |
| `if` | `left`, `right` (req.), `op` `==` `!=` `>` `<` `>=` `<=` (`==`) | true, false (no fallback) |
| `setVariable` | `var`, `value` (req.), `op` `=` `+` `-` `random` `randomOther` (`=`) | next |
| `remotePress` | `pod` (req.), `mode` `hit`/`avoid`, `color` (green / red for avoid), `colorAfter` (off), `timeoutMs` (none), `countdown`, `countdownColor`, `record`, `storeAs` (reaction measured on the pod) | next (pressed), timeout (also: pod missing) |
| `remoteMultiPress` | `pods` (all), `avoid` (0, central in the draw), `includeCentral` (true), `hitColor`, `avoidColor` (green, red), `syncStartMs` (20; 0 = on arrival), `timeoutMs`, `countdown`, `countdownColor`, `record` (every green pod) | next (all green pressed), avoidHit, timeout. Unpressed pods stay lit: follow with `remoteResetAll` |
| `remoteResetAll` | `pods` (all), `ledsOff` (true: central too) | next |
| `summary` | `metric` (req.), `storeAverage`, `storeBest`, `storeWorst`, `storeCount`, `reset` (true); format ≥ 6: `show` (false), `targetMs` (1…60000, req. with `show`), `showMs` (3000, 0…60000) | next |
| `repeat` (≥ 2) | `count` (req.), `storeIndex` (pass 1…count) | body, done (both fall back to `next`) |
| `effect` (≥ 3) | see below | next |
| `charge` (≥ 3) | see below | released, early, full, timeout, next |
| `release` (≥ 3) | see below | next, noHold, falseStart, timeout |
| `toggle` (≥ 4) | see below | next, allA, allB |
| `communicate` (≥ 5) | see below | next, pressed, timeout, repeat, stop |

A pod with an older format rejects a program with new block types (`validate`); for new fields of known
types older firmware ignores them (validator warning `fieldNeedsFormat`), except fields marked
`rejectedByOlder` in the program model, e.g. `summary.show` (error `fieldFormatTooOld`). Check `programFormat`.

### `effect`
| Field | | Default |
|---|---|---|
| `target` | `"central"`, `"all"`, `"peripherals"`, pod id (value; the central's id = central) | `"central"` |
| `effect` | `solid`, `fill`, `drain`, `dim`, `colorShift`, `trafficLight`, `blink`, `pulse`, `spin`, `off` | req. |
| `color`, `color2` | named | white, off |
| `durationMs` | value; `blink`/`pulse`/`spin`: 0 / missing = endless | – |
| `periodMs` | value, `blink`/`pulse`/`spin` cycle | 500 |
| `brightness` | value 0…255 | 255 |
| `leds` | central only | all |
| `syncStartMs` | value: common start after entry | 20 |
| `wait` | `true`: continue when the effect ended; `false`: at once | false |

Frames as link-protocol §2.1 (`spin` segment 3). Timed effects without `durationMs` jump to the end frame.
`wait: true` with an endless effect is an error. Any later light on the same ring replaces it. §7.11.

### `charge` – hold to charge (needs `hold` on peripherals)
| Field | | Default |
|---|---|---|
| `pod` | `"central"` or peripheral id (value) | `"central"` |
| `onsetMs` | value: hold before charging starts | 0 |
| `maxMs` | value ≥ 1: charging time for full | req. |
| `style` | `fill`, `brightness`, `trafficLight`, `colorShift` | `fill` |
| `color`, `color2` | named; `color2` for `colorShift` | green, red |
| `mode` | `release` (release ends) or `accumulate` (release pauses / drains) | `release` |
| `decayMs` | value, accumulate: drain time of a full charge, 0 = keep | 0 |
| `timeoutMs` or `minTimeoutMs` + `maxTimeoutMs` | value from entry, 0 = none | none |
| `countdown`, `countdownColor` | over the timeout on the idle ring | `secret` |
| `storeAs`, `storePercent`, `record` | charge ms / 0…100 / metric ms | – |

Ports: `released` (after onset), `early` (before onset; → `released` with 0), `full` (at once, ring
flashes), `timeout`, `next` fallback. §7.13.

### `release` – the release is the event (needs `hold`)
Modes: `trigger` (letting go is the event) and `signal` (hold, colour switches after a time, let go fast;
false-start detection).

| Field | Mode | | Default |
|---|---|---|---|
| `mode` | | `trigger` / `signal` | `trigger` |
| `pod` | both | `"central"` or id | `"central"` |
| `holdColor`, `heldColor` | both | waiting for the hold / hold detected | yellow, = `holdColor` |
| `allowHeld` | both | a hold already active on entry counts (from entry) | trigger true, signal false |
| `holdTimeoutMs` | both | value: no hold → `noHold` | none |
| `maxHoldMs` | trigger | value: held longer → `timeout` | none |
| `goColor` | signal | switch colour | green |
| `goMs` or `minGoMs` + `maxGoMs` | signal | hold start → switch, drawn on entry (req.) | – |
| `timeoutMs` | signal | not released after the switch → `timeout` | none |
| `storeAs` | both | trigger: hold ms; signal: reaction ms | – |
| `record` | signal | reaction (release − switch, on the pod) | – |
| `countdown`, `countdownColor` | both | trigger over `maxHoldMs` from hold start, signal over `timeoutMs` from the switch | `secret` |

Ports: `next`, `noHold`, `falseStart` (signal), `timeout`; unconnected → `next`. §7.14.

### `toggle` – pods change team on each press (needs `toggle`)
| Field | | Default |
|---|---|---|
| `pods` | value | all connected |
| `includeCentral` | | true |
| `colors` | `[A, B]` named | `["red","blue"]` |
| `start` | `a`, `b`, `alternate` (A first), `random`, `off` (dark until pressed → A) | `alternate` |
| `durationMs` or `minDurationMs` + `maxDurationMs` | value, game length (req.) | – |
| `cooldownMs` | value 0…65535: minimum between two flips of one pod | 300 |
| `syncStartMs` | value | 20 |
| `countdown`, `countdownColor` | over the game, in the pod's team colour | `secret` |
| `storeA`, `storeB`, `storeTimeA`, `storeTimeB`, `storeFlips` | pods per team, owned ms per team (sum over pods), total flips | – |

Ports: `next` (time over), `allA` / `allB` (everyone one team; **unconnected = game goes on**, no fallback).
Pods stay lit in their final colour and ignore presses: follow with `remoteResetAll`. §7.15.

### `communicate` – report and wait for the phone (central only)
| Field | | Default |
|---|---|---|
| `timeoutMs` | value; 0 = none | none |
| `metrics` | ≤ 8 metric names, `[]` = all | all |
| `vars` | ≤ 8 variable names included | – |
| `editable` | `{ name: { "min": int, "max": int } }`, ≤ 8, changeable with `setVariables` while waiting | – |
| `color` | central LEDs while waiting | `"cyan"` |

Ports: `next` (`continue`), `pressed`, `timeout`, `repeat`, `stop`; unconnected → `next`, so without a phone
the program goes on after a press or the timeout. `vars` / `editable` names must be program variables,
`min` ≤ `max`; names ≤ 32 characters. §7.16.

## 3. Measurements

`record` and `timerStop` add a value to a metric (central's id for timers). Printed as
`RESULT,<millis>,<metric>,<podId>,<ms>` / `SUMMARY,<metric>,<count>,<avg>,<best>,<worst>`. A new kind of
measurement only needs `ctx.results.record("<metric>", podId, value)`.

Shipped programs: metric `reaction` (`run`/`run5` also `lap`: lights → last press). `lib/loop.json` times
each cycle (`cycle`, `StartCycle` → end of the last round), summarises after `MAX_LOOPS` rounds, stores
`AVG_REACTION` / `BEST_REACTION`, shows the average bar 3 s (`show`), then `Report` (`communicate`, all
metrics + `RUNS`/`MAX_LOOPS`, 3 s, blue): press / `continue` = next cycle, `repeat` = cycle again (report
discarded), `stop` = `End`. Programs including it start at `StartCycle`; a reset of `RUNS` must link to
`StartCycle`, not `StartLoop`.

## 4. New block types

Firmware: architecture.md §6.3. Then the `/fw-api-change` skill.

## 5. MaxLoop override

The BLE characteristic MaxLoop (config-api §2): a number > 0 replaces `MAX_LOOPS` of the program selected
next; read at selection, so changing it during a game has no effect on that game.

## 6. Program format revisions

`info.programFormat` = the revision of block fields, ports and semantics a firmware understands
(`BlockFactory::PROGRAM_FORMAT`, `PROGRAM_FORMAT` in `tools/validate_programs.py` and
`packages/program-model/src/limits.ts`). Missing (fw < 2.3) = 1. Raise it whenever a block gets new
fields, ports or semantics, or a detail of §7 changes.

| Format | fw | Changes |
|---|---|---|
| 1 | 2.0 | `led`, `delay`, `button`, `if`, `setVariable`, `remotePress`, `remoteMultiPress`, `remoteResetAll`, `summary` |
| 2 | 2.8 | `timerStart`/`timerStop` on every block (§7.9); `repeat` (§7.10) |
| 3 | 2.9 | `effect` (§7.11); countdown fields (§7.12; with a countdown `timeoutMs` of the remote blocks is read once on enter); `charge`, `release` (§7.13, §7.14) with link revision 2 |
| 4 | 2.10 | `toggle` (§7.15), link revision 3 |
| 5 | 2.11 | `communicate` (§7.16), report buffer and its ops |
| 6 | 2.13 | `summary` `show`, `targetMs`, `showMs` (§7.7) |

Older programs run unchanged on newer firmware.

## 7. Engine semantics

Exact runtime behaviour; the app simulator (`app/src/simulator/engine.ts`) and the demo pod must follow it.
Code paths are relative to `firmware/src/`.

### 7.1 Passes and step limit
- `BlockManager::run()` once per loop pass. A finished block is left (`exit`), the next entered (`enter`)
  and executed **in the same pass**, up to `MAX_STEPS_PER_PASS = 32`; then the last entered block runs in the
  next pass. Nothing is skipped; an endless instant loop never hangs the pod.
- `enter()` runs every time a block becomes current (also self-links); entry time, random durations and
  timeouts are taken there.
- Port selection: the result port if connected; else `next` if port 0 is `next` (all types but `if`); else
  the program ends (no error).
- Pause (pod lost or phone `pause`): `restartCurrentBlock` = `exit` + `enter` (`resume()`, default
  `enter()`): times restart, random values are drawn again; `communicate` is the exception (§7.16).
- Unknown variables read 0 (created by `VariableManager::resolve`).

### 7.2 Instant and waiting blocks

| Type | Finishes | Values read |
|---|---|---|
| `led`, `if`, `setVariable`, `remoteResetAll`, `repeat` | at once | on execute |
| `summary` | at once; with `show` after `showMs` | on execute |
| `delay` | `millis() ≥ entry + duration` (checked per pass); 0 = in the entry pass | on enter (also countdown) |
| `button` | press / release / timeout | timeout on enter, `shortMs` on release |
| `remotePress` | press / timeout; at once via `timeout` if the pod does not exist | `pod` on enter, `timeoutMs` every pass (on enter with a countdown) |
| `remoteMultiPress` | all green pressed / avoid pressed / timeout | `pods`, `avoid`, `syncStartMs` on enter, `timeoutMs` every pass (on enter with a countdown) |
| `effect` | `wait: false` at once; `wait: true` at `start + durationMs` | all in the entry pass |
| `charge`, `release`, `toggle` | §7.13–§7.15; at once via `timeout` if the pod cannot take part | all on enter |
| `communicate` | command / press / timeout | `timeoutMs` on enter |

### 7.3 Random numbers (`esp_random()`, `Block/RandomUtil.h`)
- `setVariable random`: uniform in [0, value − 1]; value ≤ 1 → 0.
- `randomOther`: value ≥ 2 and current in [0, value − 1] → uniform among the other value − 1 numbers;
  current outside → like `random`; value ≤ 1 → 0.
- min/max pairs (`delay`, `button`, `charge` timeout, `release` go, `toggle` duration): uniform in
  [min, max] inclusive (`RandomUtil::between`); negative min → 0; max ≤ min → min; single fields = min = max.

### 7.4 `button`
- Only a press **edge after entry** counts (press counter stored in `enter`); a held button is ignored
  until released and pressed again. Debounce: first edge at once, further edges within 20 ms ignored.
- On the edge: `record` / `storeAs` = press − entry (ms).
- `pressed` connected → leave on the edge (`short`/`long` never taken). Else wait for the release:
  duration < `shortMs` → `short`, else `long` (exactly `shortMs` = long); reaching `shortMs` while held does
  nothing. Unconnected `short`/`long` → `next`.
- `timeout` only applies before a new press; once pressed, the block waits for the release. Timeout ≤ 0
  (also a random 0) = **no timeout**.

### 7.5 `remotePress`
- `pod` = peripheral `0 … connected − 1` (taken mod 256). Any other id, **including the central's**, or no
  peripherals: nothing lit, leave via `timeout` in the entry pass.
- Only the press answering this activation (`cmdSeq`) counts; then the pod is reset (`colorAfter`), its
  measured reaction recorded / stored.
- `timeoutMs` from entry; **0 = immediate timeout** (unlike `button`); none = forever. Timeout resets the pod.

### 7.6 `remoteMultiPress`
- `n` = `pods` (default all) clamped to [0, connected] (and 31); peripherals `0 … n − 1` take part. With
  `includeCentral` the central draws as id `n` (results use its normal id). `t = n + central`.
- `avoid` clamped to [0, t − 1] (≥ 1 green), drawn uniformly from all `t`, central included.
  `t = 0` → `next` at once.
- All light at network time entry + `syncStartMs` (0: on arrival), the central too; central presses before
  it lit do not count.
- Avoid pod pressed → `avoidHit` at once. Green peripheral pressed → reset, reaction recorded; green central
  pressed → its LEDs off, reaction from its lighting. All green pressed → `next`. `timeoutMs` from entry,
  0 = immediate, none = no timeout. Unpressed pods stay lit after every exit.

### 7.7 `summary`
- Statistics per metric since the last `summary` with `reset` (or `results` with `reset`). `average` =
  integer, truncated; `best` smallest, `worst` largest. No values → all 0, printed and stored.
- **Bar** (`show`): read once on entry, after storing, before `reset`. Average `A`, target `T` (1…60000),
  `twice = 2T`: `percent = (twice − A)·100 / twice`, 0 if `A ≥ twice`, at least **6**; lit LEDs
  `(percent·18 + 50) / 100` from LED 0, rest dark (full = 0 ms, half = `T`, empty = 2T). Colour green if
  `A < T`, yellow if `A ≤ 1.5T`, else red. A `level` effect on the central only, at once.
- Leaves via `next` `showMs` after the bar starts, then the ring is switched off; `showMs` 0 = no wait, the bar
  stays until the next light. No values → no bar, no wait. A pause keeps the bar and the original end time.

### 7.8 Other blocks
`led` without `leds` sets all 18; with `leds` the others keep their colour. `if` has no `next`
(unconnected = end). `remoteResetAll` resets peripherals `0 … min(pods, connected) − 1` and the central
unless `ledsOff: false`.

### 7.9 Timers (`BlockManager::enterCurrent`, `stopTimer`)
- `timerStart` before `enter()`: stores `millis()`; restarts a running timer.
- `timerStop` after `exit()`, also when the program ends there: records `millis() − start` for
  `REQUIRED_PERIPHERALS` and stops. A stop without a running timer is ignored and counted
  (`status.timers.orphanStops`).
- Stop of the old block before start of the new one (a self-linked block with both measures each pass).
  Instant blocks measure 0 ms; accuracy = one pass.
- A pause does not leave the block: timers keep running. All timers cleared at program start.

### 7.10 `repeat`
Own counter per block, 0 at program start. On execute: counter + 1, read `count`; counter ≤ count →
`storeIndex` = counter, `body`; else counter = 0, `done` (`storeIndex` keeps its value). `count` 3 →
body, body, body, done, then a new series. `count` ≤ 0 → always `done`. Lowering `count` below the passes
made ends at the next entry. Nested repeats count independently. A pause does not change the counter.
Leaving the body for good keeps the counter until the next `done` (not detected).

### 7.11 `effect` (`EffectBlock`, `EffectTarget`, `LEDManager::renderEffect`)
- In the entry pass all fields are read once: `durationMs` < 0 → 0, `periodMs` ≤ 0 → 500 (max 65535),
  `brightness` clamped 0…255, `syncStartMs` < 0 → 0. `start` = entry + `syncStartMs` on the network clock;
  sent with that start (`syncStartMs` 0 = now, per pod on arrival). Before `start` rings keep their colours.
- Target: `central`; `peripherals` = 0 … connected − 1; `all`; a pod id (read at start), the central's id =
  central, other ids ignored (block continues).
- `leds` (central) masks output but keeps the whole-ring geometry of `fill`/`drain`/`spin`. `off` = steady
  dark. `dim` fades `brightness` → 0; otherwise `brightness` scales.
- `wait: false`: `next` in the same pass, effect keeps running. `wait: true`: `next` at
  `now ≥ start + durationMs` (so `syncStartMs + durationMs` after entry; duration 0 → right after
  `syncStartMs`). Endless effects with `wait: true` (constant `durationMs` ≤ 0 or none) are rejected at
  load. Leaving does not stop the effect.
- End frames: `fill` full, `drain`/`off`/`dim` dark, `colorShift` `color2`, `trafficLight` red;
  `blink`/`pulse`/`spin` with a duration end steady `color`.
- Replaced by any later static light or effect on that ring (peripheral: ARM, press result, RESET).
- Pods without `effects`: `color` static at `start` (`off` = RESET) until the next ARM / RESET; the block
  still waits the full duration.

### 7.12 Countdown (`Block/Countdown.cpp`)
A ring effect with lit colour `L`, playing time `D`:

| `countdown` | Effect | End |
|---|---|---|
| `drain` | `drain`, L, background off | dark |
| `fill` | `fill`, L, background off | full L |
| `dim` | `dim`, L, 255 → 0 | dark |
| `colorShift` | L → `countdownColor` | `countdownColor` |
| `trafficLight` | colours ignored | red |

`T` = time limit read on enter; `T` ≤ 0 → no countdown; `secret` never plays.
- `delay`: L = `countdownFrom`. Central only: starts on enter, `D = T`. Target with peripherals and
  `T > 20`: starts 20 ms after entry on all targets, `D = T − 20`. Leaving stops the central's effect (last
  frame stays).
- `button`: L = `countdownFrom`, central, `D = T` from enter; the counting press or leaving stops it.
- `remotePress`: `T` = `timeoutMs` read once; L = `color`; carried by ARM (`D = T`), played from the
  activation, so it ends a few ms after the central's timeout. Press / timeout reset the pod.
- `remoteMultiPress`: all lit pods (hit and avoid) and the central (if in) start at entry + `syncStartMs`
  with `D = T − syncStartMs` (≤ 0 → none), each in its lit colour. Pressed green pod reset, pressed central
  off; the others run to the end frame, also after `avoidHit` / `timeout`.
- Without a countdown `timeoutMs` is read every pass. The central's countdown is replaced by any later light.

### 7.13 `charge` (`ChargeBlock`, `HoldBlock`, `Link/HoldSession`; wire: link-protocol §2.2)
**Enter.** Read once: `pod`, `onsetMs` (< 0 → 0), `maxMs` (< 1 → 1), `decayMs` (< 0 → 0, accumulate only),
timeout `T` (`timeoutMs` or random; ≤ 0 / missing = **none**, like `button`). `pod` = central if
`"central"`, missing or the central's id; else a peripheral `0 … connected − 1` with `hold`; anything else
**cannot take part**: nothing lit or stored, `timeout` in the entry pass. Then the idle ring.

**Hold.** Starts at a press edge after entry (a held button must be released first). `p` press, `r` release
(button timestamps, 20 ms debounce). While held: `charge = min(maxMs, c0 + max(0, (t − p) − onsetMs))`, `c0` =
0 in `release` mode, the kept charge in `accumulate`; the onset applies to **every** hold. Released in
accumulate: kept if `decayMs` 0, else `max(0, c − (t − r)·maxMs/decayMs)`. Reported in whole ms.

**Ring.** Idle: `fill` dark, `brightness` the colour at 40/255, `trafficLight` green, `colorShift` `color`;
with a countdown and `T > 0` the countdown instead (lit colour `color`, from enter). Hold start shows the
frame for the current charge (a countdown does not come back). From `p + onsetMs` the charge effect runs
on `charge / maxMs`: `fill` LED n at n/18, `brightness` 40 → 255, `trafficLight` thirds, `colorShift`
`color` → `color2`. Accumulate: a release freezes the frame (redrawn ≈ 30/s while draining).

**End, `release` mode** (first of):
1. `full` at `p + onsetMs + maxMs`, reported then without waiting (a release at or after also counts):
   flash (`color`; `trafficLight` red; `colorShift` `color2`; 600 ms, 200 ms period, then dark), **not**
   reset; stores `maxMs`, 100 %, record `maxMs`.
2. release with `r − p < onsetMs` → `early` (→ `released`), charge 0.
3. other release → `released`, charge = `(r − p) − onsetMs`.
4. timeout.

`storeAs` (ms), `storePercent` (`(charge·100 + maxMs/2) / maxMs`), `record` (pod id, central =
`REQUIRED_PERIPHERALS`) for 1–3. After `released`, `early`, `timeout` the ring is reset (dark).

**End, `accumulate`:** only `full` (at `p + onsetMs + (maxMs − c0)`) and `timeout`.

**Timeout.** `T` from entry until the block ends, **also during a hold** (checked after the pass's events;
an event in the same pass wins). `release` mode: `timeout`, nothing stored, reset. `accumulate`: the pod
stops `T` after its activation and reports its charge (decayed if released); `timeout` with that charge
stored; the central waits ≤ 300 ms after its own `T` for the report, else nothing is stored.

**Pause.** Activation ended and re-entered: charge 0, new random timeout. An unreachable pod keeps its ring
until the new ARM.

### 7.14 `release` (`ReleaseBlock`, `HoldBlock`, `Link/HoldSession`)
**Enter.** Read once: `pod`, `holdTimeoutMs`, `maxHoldMs`, go delay `G` (`goMs` or random, negative → 0),
`timeoutMs`, `allowHeld`; ≤ 0 / missing = none. Pod resolved as in §7.13; cannot take part → `timeout`
(→ `next`) at once. Ring `holdColor`.

**Hold start `s`.** A press edge after entry; with `allowHeld` a button already down starts it **at the
entry** (trigger `storeAs` counts from there); else it must be released first. Ring `heldColor` (trigger
with a countdown and `maxHoldMs > 0`: countdown over `maxHoldMs`, colour `heldColor`, from `s`). The
central learns of it from PRESSED (its own button: the pass that sees it).

**`trigger`.** Release `r` → `next`, `storeAs` = `r − s` ms. Left in the pass the central receives
RELEASED, so a `timerStart` on the next block starts then (a few ms late for peripherals). Ring reset.

**`signal`.** At `s + G` the ring switches to `goColor` (with a countdown and `timeoutMs > 0`: countdown
over `timeoutMs`, colour `goColor`). Release `r < s + G` → `falseStart`, nothing stored. Else reaction =
`r − switch` (the pod's LED update at `s + G`; simulator: `s + G`), ≥ 0, rounded → `record`, `storeAs`, `next`.

**Timeouts** (central clock; the simulator ignores link latency): `noHold` if no hold `holdTimeoutMs` after
entry (only before a hold); trigger `timeout` = not released `maxHoldMs` after `s`; signal `timeout` = not
released `G + timeoutMs` after `s`. Events before timeouts; after `noHold` / `timeout` reset, nothing
stored. Unconnected `noHold`, `falseStart`, `timeout` → `next`. Pause: as `charge`.

### 7.15 `toggle` (`ToggleBlock`, `PeripheralRole::runToggle`; wire: link-protocol §2.3)
**Enter.** Read once: `pods`, `cooldownMs` (0…65535), `syncStartMs` (< 0 → 0), duration `D` (≤ 0 ends at
the start), random start owners. Participants: peripherals `0 … pods − 1` with `toggle` (others left out,
log "cannot toggle") and, with `includeCentral`, the central (index `pods`). Start owners in that order
(central last): `a`, `b`, `alternate` (A for 1st, 3rd, …), `random`, `off` (nobody). `t0` = entry +
`syncStartMs`: everyone shows its colour at `t0`; the game runs `t0 … t0 + D`.

**Flip.** A press edge after `t0`: A → B, B → A, nobody → A. Ignored if < `cooldownMs` after the last
accepted press of that pod (timestamps; the first always counts); several presses in one pass count once.
Pods flip themselves and report `{owner, flipCount}`; the central's own button flips in its pass.

**Bookkeeping.** Per participant: owner, flipCount, time of the last change. A PRESSED counts if pod and
`cmdSeq` match, `flipCount` is higher than seen, and it was received ≤ `t0 + D`. Skipped `flipCount`s add to
the total. An owner change gives the elapsed time to the old owner, at the **central's receive time**
(simulator: the press time). Owned time per team sums over participants (up to N·D).

**End** (each pass after events): 1. `allA`/`allB`: after a flip everyone (central too) is one team and the
port is connected (unconnected: go on; never checked on entry; ≥ 1 participant). 2. `now ≥ t0 + D` → `next`.
Then owned time is closed (`t0 + D` for `next`, now for `allA`/`allB`), `storeA`/`storeB` (nobody not
counted), `storeTimeA`/`storeTimeB` (rounded ms), `storeFlips` (all flipCounts incl. central) written.
Final colours frozen: the central's ring set (countdown ends), each peripheral gets a plain activation in
its colour before and after a press. Nothing reset: follow with `remoteResetAll`.

**Pause.** Re-entered: new duration, new owners, counts and times from zero. Unreached pods keep their
state until the new ARM.

### 7.16 `communicate` (`Block/CommunicateBlock`, `Results/Reports`)
**Measurement log.** Every `record` / `timerStop` since the last report: `t` (`millis()`), metric, pod, ms;
≤ 48 values, further ones only counted (`stats`, `valuesDropped`). Cleared at program start and when a
report is built; `summary` and `results` do not touch it.

**Enter.**
1. Build a report: `id` (from 1 since boot), `program` (path), `setId`, `athlete` (if a `session` set one),
   `cycle` (reports since program start, from 1), `startMs` (previous report or program start), `endMs`
   (now), `values` (the log, oldest first, only `metrics`; all without), `stats` per listed metric with
   values (`count`, truncated `average`, `best` smallest, `worst` largest; over all values incl. dropped),
   `vars`, `valuesDropped` (if > 0).
2. Clear the log (all metrics).
3. Buffer it (8 reports, RAM); a full buffer drops the oldest (`status.reports.dropped`).
4. Emit the `report` event (USB serial; BLE indication from fw 2.12).
5. Central LEDs `color`, read `timeoutMs` once, wait.

**Wait** (each pass, first wins): 1. client `command` (`continue` → `next`, `repeat` → `repeat`, `stop` →
`stop`). 2. press edge of the central after entry → `pressed`. 3. `timeoutMs` > 0 elapsed → `timeout`.
Unconnected → `next`, none → end. `setVariables` works only while waiting. `repeat` only picks the port;
the report stays as sent (the client marks it discarded).

**Pause.** While PAUSED the block does not wait (`command`/`setVariables` → `not_ready`, no
`status.waiting`), for both pause kinds; a phone pause may start while it waits. `restartCurrentBlock`
calls `resume()`: no second report, LEDs set again, timeout restarted; the client answers after `resume`
with the same report.
