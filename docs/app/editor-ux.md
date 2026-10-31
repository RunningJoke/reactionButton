# Block builder UX – simple by default, everything reachable

Implemented in P8 (AT-E1–E14 passed 2026-10-26). The step sheet and the step list were rebuilt in #88 around
**Sprinkles** (German: Streusel; code id `behaviour`, `app/src/editor/behaviours.ts`): §3, §4 C–E, §5 and §7
describe the result, AT-E15–E19 test it. Extends [spec.md §7](spec.md#7-editor). Clickable prototype:
[prototypes/editor-flow.html](prototypes/editor-flow.html) (page fragment, opens in any browser; shows the P8 sheet).

## 1. Problems the design solves

Numbered, referenced from the code. The old editor (now expert mode, §4 H):
1. showed every field and port at once; 2. put exclusive fields side by side (`ms` vs `minMs`/`maxMs`);
3. showed raw keys, port names and operators; 4. used jargon (peripherals, metric, pods from 0, bytes);
5. gave new blocks placeholder values that silently created variables and metrics; 6. connected by
picking generated names; 7. created variables / metrics from typos; 8. showed problems only in the Check
sheet; 9. dropped fields and links without asking; 10. had no guided start.

## 2. Users

| Persona | Sees blocks? | Main path |
|---|---|---|
| First-timer ("3 pods, a reaction game, now") | no | chooser → wizard → Try → add to menu |
| Coach ("same drill, 20 rounds, 1–3 s pause, 2 s limit") | steps in words | Programs → Adjust; simple editor with switches |
| Tinkerer (must keep working) | yes | expert mode |

Phone in one hand, gloves or sweaty fingers, nothing lost by accident.

## 3. Capability levels

**S** = simple view, **T** = a Sprinkle or "More options", **E** = expert mode only.

- **Start:** game wizard S · copy a program S · import `.json` S · start empty E.
- **Adjust:** rounds (`MAX_LOOPS` / `repeat.count`) S · pause fixed or random S · time limit and what
  happens when it runs out T · colours S · number of red pods T · pods needed S · catch false starts T.
- **Flow:** add a step by intent S · add into a branch S · move up / down S · delete with undo, duplicate S ·
  repeat N times (bracket) S · `if` in words S · short vs long press T · **every exit with one picker S**
  (steps named by number and sentence) · rename, change type, set start, raw port selects E.
- **Measure** (off unless the recipe turns it on): record reaction T · count misses (picker choice "Count a
  miss, then continue" on `timeout` / `avoidHit` / `noHold` / `early` / `falseStart`) S · show results at the end
  (`summary` + `store…`) S · keep the result (`storeAs`, `storePercent`, toggle `store…`) T · stopwatch
  (`timerStart`/`timerStop`, [spec §9.6](spec.md#96-measurement-87)) T · show average bar T · report to phone (§4 D) S ·
  metric name E.

### 3.5 Settings (variables)
Program numbers as labelled controls ("Rounds: 12") S · a setting instead of a fixed number in a step T ·
create / rename / delete settings, built-ins E.

- **Reuse:** recipes in "Add a step" S · library as preset or copy, convert to editable copy E.
- **Menu entry, check and try:** name, description, LED pattern S · problems on the step in words S ·
  simulator from anywhere S · undo / redo S · size as "uses 23 % of the space" S · steps the pod cannot run
  marked S. "Save and add to menu" S; push stays on the Pod page.

## 4. Flow

Programs → **+** → chooser (A) → wizard (B) → Ready: *Try it* (simulator), *Change steps* (editor C),
*Save and add to menu*. Programs → *Adjust* (G). Editor: tap a step → step sheet (D); **+** → add a step
(E); title → program sheet (F); More → expert mode (H).

### A. "New program" chooser
Three cards: **Start from a game** (recommended), **Copy one of my programs**, **Start empty** ("for people
who know blocks").

### B. Game wizard
One question per screen, Back / Next, prefilled, ≤ 6 screens:
1. Game: solo, star, random pod (never twice), all at once (with red pods), duo; animated LED preview and
   the pod count. 2. Pods: stepper; games that need more are explained, not hidden. 3. Rounds and timing:
   pause fixed / random between (seconds), time limit switch. 4. Colours: 8 named; red pods and their count
   for "all at once". 5. Measure: record reaction (on), count misses (on with a time limit), show average and
   best (on), catch false starts (solo only).

Ready screen: name (editable), menu pattern, the program as a short story ("12 rounds: pause 1–3 s, light a
random pod green, wait for the press (max 2 s)…"). Generated programs are self-contained (templates), follow
the shipped `star`, `random`, `multi`, `solo`, `duo`, use only blocks the firmware has, and write answers into
variables (`ROUNDS`, `PAUSE_MIN_MS`, …) and fields so Adjust can change them. Loop (decision 2): a `repeat`
block (`count: "ROUNDS"`, `storeIndex: "RUNS"`, `body` = first round step, `done` = first step after; the last
round step and early exits link back) if `info.programFormat` ≥ 2; otherwise (older or no pod) the `lib/loop`
pattern (`setVariable RUNS +1`, `if RUNS >= MAX_LOOPS`). Both show as the same Repeat bracket.

### C. Editor, simple view (default)
Numbered step list in plain language (`editor/sentence.ts`), **one line per step**: number, category tile
(icon, no coloured stripe), the sentence ("Light all LEDs green", "Wait 1–3 s (random)", "Wait for a press · max
2 s · records time"). Simple facts (time limit, record) are part of the sentence. A **sliders badge with a count**
shows only for advanced Sprinkles (`advancedCount`): long press, keep result, then go to…, average bar, countdown;
time limit and record alone show none. Exits that leave the normal flow are **lines under the step**
("↳ If too slow · Count a miss", "↳ Then · step 1 · Light the central blue"; `editor/exits.ts` decides what is
"normal": the exit goes where the main exit goes); tapping a line opens its target. Loops = "Repeat 12 rounds"
bracket (from `repeat` or the `lib/loop` pattern, `editor/structure.ts`). No block names, port names or file
paths; a badge for a problem and "not supported by your pod". One floating **+** adds after the selected step or
at the end of the round.

### D. Step sheet, layout A "quiet list" (replaces the inspector in the simple view)
One surface: groups are separated by space and a faint hairline, never by a box inside a box. Top to bottom:
1. The step as one read-only sentence, then **problems** in words. 2. **Essentials**: 1–3 large controls
(swatches, LED ring, "which pod" chips Pod 1…n / random pod / random never the same twice
(`editor/podChoice.ts`), a time with `FixedOrRandomTime`: Fixed | Random between, `editor/sheetParts.tsx`).
3. **Exits** (blocks that own exits: Decide, Repeat, Hold to charge, Let go in signal mode, Domination, Report):
a row per exit "If yes → Step 5 · …" that opens the exit picker. 4. **Sprinkles** (`editor/behaviours.ts`,
`Sprinkles.tsx`): optional things as rows (icon, name, value, chevron); a row opens in place (one at a time) and
shows only its settings and "Remove"; a Sprinkle without settings (Record reaction, Turn pods off afterwards)
has no body and carries "Remove" on its row; a step that only partly matches shows a "Custom" row that points to
expert mode. "+ Add sprinkle" opens a second page grouped **Rules / Measure / Flow** with a one-line description,
only what this block supports and does not have; what the pod's `programFormat` cannot run is greyed out with the
reason. Two unused Sprinkles appear as plain suggestions ("Try + Time limit"). 5. **More options** (collapsed):
at most 3 entries, none of them owned by a Sprinkle (§5). 6. **Actions**: move up / down, duplicate, delete (undo
toast). 7. **Expert** (expert mode): name, type, raw keys, a raw "go to" select per port, raw JSON.

| Sprinkle | Owns | Blocks | Exit |
|---|---|---|---|
| Time limit | `timeoutMs`, `minTimeoutMs`+`maxTimeoutMs`, `maxHoldMs`, countdown fields (a pause or game has its own *Countdown* row) | button, remotePress, remoteMultiPress, charge, release, communicate | `timeout` |
| Red pods | `avoid`, `avoidColor`, or `mode: avoid` | remotePress, remoteMultiPress | `avoidHit` |
| Long press | `shortMs` | button | `short`, `long` |
| Catch early presses | the pause becomes the button with a random time of `solo.json` | delay | `pressed` |
| Hold first | `onsetMs` (charge), `holdTimeoutMs` (release) | charge, release | `noHold` |
| Drains over time | `decayMs` (charge in accumulate mode) | charge | – |
| Central takes part | `includeCentral` (on by default; removing writes `false`) | remoteMultiPress, toggle | – |
| Record reaction | `record` | button, remotePress, remoteMultiPress, charge, release (signal) | – |
| Keep result | `storeAs`, `storePercent`, toggle's five `store…` | button, remotePress, charge, release, toggle | – |
| Phone can change settings | `vars`, `editable` | communicate | – |
| Show average bar | `show`, `targetMs`, `showMs` | summary | – |
| Stopwatch | `timerStart`, `timerStop` (suggested names `cycle`, `lap`; max 16) | all | – |
| Then go to… | the main exit (`next` / `pressed` / `released`) | every block with a main exit | the main exit |
| Turn pods off afterwards | a bare `remoteResetAll` right after the step (a reset with fields, or one other steps use, is "Custom") | remoteMultiPress, toggle, charge, release, effect on pods | – |

**Exit picker** (second page of the sheet, one for every exit; `editor/exits.ts`, `ExitPicker.tsx`): a radio list
"Next step" (on an exit with a fallback this removes the link) · "Count a miss, then continue" (failure exits only) ·
"Next round" and "Leave the loop" (inside a Repeat only) · "The game goes on" (Domination's team exits) · **A
step…**: every step named by number and sentence, never by block name; steps that would make the program go round
without a waiting step are greyed out with the reason (the engine runs 32 blocks per pass, programs.md §7.1) ·
"A new step here…" (opens Add a step, connected to the exit). Labels: "If too slow →" ("If left alone →" for a
don't-touch pod), "After a short / long press →", "If a red pod is hit →", "If nobody holds →", "Then →", "If yes /
no →", "Each round →", "After the last round →", "If released early →", "When full →", "If released too early →",
"When everyone is team A / B →", "If the button was pressed / you choose repeat / stop →".

**Report to phone** (`communicate`, spec §9.6): *Results* as checkboxes of the recorded metrics ("All results" =
`metrics` unset), *Time limit* (time-out in seconds), the Sprinkle *Phone can change settings* with checkboxes for
*Settings to include* (`vars`) and *Coach may change while it waits* (`editable`, each with min and max); at most 8
per list. Raw lists stay in expert mode.

Values are plain text that opens its control. Rows 48 px, buttons 44 px, tabular numerals for times. A row
expands in place in under 200 ms with a CSS animation, none under `prefers-reduced-motion`.

### E. "Add a step" by intent (`editor/AddStepSheet.tsx`, `stepRecipes.ts`)
Tiles in four groups: **Light** (Light up the central, Light effect, Light a pod, Race: all pods at once, Turn
all pods off), **Wait** (Pause, Wait for a press, Hold to charge, Let go, Domination), **Think** (Count or
remember, Decide, Repeat), **Results** (Show results, Report and answer). Above them recipes that add several blocks: "Count a miss
when too slow", "Pause between rounds", "Flash red on a false start". Values come from the context (problem 5):
colour of the previous light, the round's time limit; a value field never creates a variable by itself
("new setting…" asks for a name). Expert mode shows block types and library parts last.

### F. Program sheet
**Basics**: name, description, pods besides the central (picture stepper), menu pattern. **Settings you can
tweak**: variables as labelled steppers; labels from a table in the app (decision 1,
`editor/settingLabels.ts`, texts in en/de): `MAX_LOOPS`/`ROUNDS` → "Rounds", `PAUSE_MIN_MS` → "Shortest
pause", a known `_MS` suffix → seconds; unknown names as is. **Expert**: start block, library parts,
convert to editable copy, raw variables.

### G. Adjust sheet (Programs page)
The program's settings (F) and whole-program switches (time limit, record times, results at the end), with
**Try it** and **Save** at the bottom; for every program: mine, pod (also a read-only pod), shipped
(decision 3). Non-local programs are saved as a local copy with the same path; the pod's file stays until the
next push. On a read-only pod the sheet says the copy stays on this phone.

### H. Expert mode
Switch under More (editor) and Settings → Advanced, remembered per device (`editor/expertMode.ts`): block
names and port arrows (spec §7.1 column), expert sections in sheets, block types in the palette. Nothing is
removed.

## 5. Field levels per block type

**Essential** = step sheet, **Sprinkle** = behind the named Sprinkle (§4 D), **More** = More options (at most 3),
**Expert** = expert mode only. Metadata: `level` and `group` (a `BehaviourId`) on `FieldDef` in
`packages/program-model/src/blockTypes.ts` (shared with the platform), port labels per type. A field with level
`switch` always names its Sprinkle; every raw field stays editable in expert mode.

| Block | Essential | Sprinkle | More | Expert |
|---|---|---|---|---|
| `led` | `color`, `leds` | Stopwatch | – | name |
| `delay` | `ms` or `minMs`+`maxMs`; *Countdown* row (`countdown…`, `countdownTarget`) | Catch early presses (→ `button`), Stopwatch | – | |
| `button` | – | Time limit `timeoutMs`…, `timeout`, countdown; Record `record`; Keep result `storeAs`; Long press `shortMs`, `short`, `long`; Then go to; Stopwatch | – | `pressed` vs `next`, metric |
| `remotePress` | `pod`, `color` | Time limit; Red pods `mode: avoid`; Record; Keep result; Then go to; Stopwatch | – | `colorAfter`, metric |
| `remoteMultiPress` | `hitColor`, `pods` | Red pods `avoid`, `avoidColor`, `avoidHit`; Time limit; Record; Central takes part; Turn pods off afterwards; Stopwatch | – | `syncStartMs`, metric |
| `remoteResetAll` | – | Stopwatch, Then go to | `pods`, `ledsOff` | |
| `setVariable` | `var` (pick / "new setting…"), `op` in words, `value` | Stopwatch, Then go to | – | raw op |
| `if` | `left`, `op` in words ("is at least"), `right`; exits `true`, `false` | Stopwatch | – | raw op |
| `summary` | average / best / worst / count (each creates its `store…` variable) | Show average bar `show`, `targetMs`, `showMs`; Stopwatch | – | `metric` (+ read-only "of: reaction"), `reset` |
| `repeat` | `count`; exits `body`, `done` | Stopwatch | – | `storeIndex` |
| `effect` | `target`, `effect`, `color`, `durationMs`, `periodMs` ("Cycle time", blink / pulse / spin), `wait` | Turn pods off afterwards (pods as target); Stopwatch; Then go to | `color2`, `brightness`, `leds` | `syncStartMs` |
| `charge` | `pod`, `maxMs`, `style`, `color`, `mode`; exits `early`, `full` | Time limit; Hold first `onsetMs`; Drains over time `decayMs` (accumulate); Record; Keep result `storeAs`, `storePercent`; Turn pods off afterwards | `color2` when colour shift shows it above | |
| `release` | `mode`, `pod`, `holdColor`, `goColor`, `goMs` or `minGoMs`+`maxGoMs` (signal); exit `falseStart` (signal) | Time limit `maxHoldMs` (trigger) / `timeoutMs` (signal); Hold first `holdTimeoutMs`, `noHold`; Record (signal); Keep result `storeAs`; Turn pods off afterwards | – | `heldColor`, `allowHeld` |
| `toggle` | `colors`, `start`, `durationMs` or `minDurationMs`+`maxDurationMs`; exits `allA`, `allB`; *Countdown* row | Keep result (five `store…`); Central takes part; Turn pods off afterwards | `cooldownMs`, `pods` | `syncStartMs` |
| `communicate` | Report to phone: results (`metrics`); exits `pressed`, `repeat`, `stop` | Time limit `timeoutMs`, `timeout`; Phone can change settings `vars`, `editable`; Then go to; Stopwatch | `color` | |

`timerStart` / `timerStop` are Stopwatch fields on every block (expert: raw). `storeIndex`, `syncStartMs`,
`colorAfter`, `heldColor`, `allowHeld`, `reset` and `metrics` were "More" in P8 and moved to expert (#88).
`effect.periodMs` and `charge.mode` became essentials, `toggle.cooldownMs` went to More.

**Port names** (in words, `editor.exit.role.*`): pressed / next "Then", timeout "If too slow" (avoid pod: "If left
alone"; report: "If nobody answers"), short / long "After a short / long press", avoidHit "If a red pod is hit",
true / false "If yes" / "If no", body "Each round", done "After the last round", early "If released early", full
"When full", noHold "If nobody holds", falseStart "If released too early", allA / allB "When everyone is team A /
B", communicate next / pressed / repeat / stop "If you choose continue / If the button was pressed / If you choose
repeat / If you choose stop"; app-only role `ifPressedEarly` for the false-start press.

## 6. Decisions (2026-10-21)
1. Setting labels live in the app (name table); the program file gets no new key.
2. The wizard uses `repeat` with `programFormat` ≥ 2, else the `lib/loop` pattern.
3. Adjust is offered on a read-only pod too; it saves a local copy and says it cannot be pushed there.

## 7. As built – deviations

| Topic | As built | Reason |
|---|---|---|
| false-start press | own port role `ifPressedEarly` (app only) | the model's roles describe the block, not the pattern |
| time limit of a press | fixed only; existing random limits show both values | a random limit without a recorded time marks a false-start pause |
| "Don't touch" on one pod | on: also sets a time limit, stops recording; off: does not restore exactly | a red pod without a limit waits forever |
| "End the round" when too slow | not for "all at once" | its pods stay lit after a timeout |
| Adjust with unsaved changes | "Save and try" | the simulator opens saved programs only |
| Adjust switches | none for programs built only from library parts (Stern, Run5); Duo has no results switch | switches edit the program's own steps |
| Add a step | "Light a pod" / "Race" off without pods; "Race" adds "Turn all pods off"; "Repeat" adds 3 rounds with 1 s pause; recipes do not reset Misses between series | valid and runnable after every tap |
| reversed range | validator warning `rangeReversed` (app and `validate_programs.py`) | the firmware then always uses the shortest time (programs.md §7.3) |
| Sprinkles (#88) | UI name Sprinkles (Streusel), code id `behaviour`; the six feature switches are the first entries | one concept for everything optional on a step |
| Central takes part | a Sprinkle that is *on* by default (the firmware default); removing it writes `includeCentral: false` | the field exists with default true; the row exists to switch it off |
| Turn pods off afterwards | exact only for a bare reset that only this step uses; anything else is "Custom" and left alone | removing a shared or configured reset would change other steps |
| Then go to… | on when the main exit jumps (a step that does not follow in the list, or back); "Next step" links the step after, else the end of the round | a main exit that goes to the next step is the list itself |
| Catch early presses | not offered on a pause that has a field the button lacks (`countdownTarget`) | turning it on would drop the field silently |
| Instant loops | exit picker greys out targets that make the program go round without a waiting step (an effect without `wait` and a summary without `show` do not wait) | the engine runs 32 blocks per pass (programs.md §7.1) |
