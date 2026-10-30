# Block builder UX – simple by default, everything reachable

Implemented in P8 (AT-E* passed 2026-10-26). Extends [spec.md §7](spec.md#7-editor). Clickable prototype:
[prototypes/editor-flow.html](prototypes/editor-flow.html) (page fragment, opens in any browser).

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

**S** = simple view, **T** = behind a switch or "More options", **E** = expert mode only.

- **Start:** game wizard S · copy a program S · import `.json` S · start empty E.
- **Adjust:** rounds (`MAX_LOOPS` / `repeat.count`) S · pause fixed or random S · time limit and what
  happens when it runs out T · colours S · number of red pods T · pods needed S · catch false starts T.
- **Flow:** add a step by intent S · add into a branch S · move up / down S · delete with undo, duplicate S ·
  repeat N times (bracket) S · `if` in words T · short vs long press T · rename, change type, set start,
  connect any port E.
- **Measure** (off unless the recipe turns it on): record reaction T · count misses (`setVariable MISSES +1`
  on `timeout` / `avoidHit`) T · show results at the end (`summary` + `store…`) S · keep the last time
  (`storeAs`) T · stopwatch (`timerStart`/`timerStop`) T · metric name E.

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
Numbered step list in plain language (`editor/sentence.ts`): "Light all LEDs green", "Wait 1–3 s (random)",
"Wait for a press · max 2 s · records time". Loops = "Repeat 12 rounds" bracket (from `repeat` or the
`lib/loop` pattern, `editor/structure.ts`). Branches = chips under the step ("If too slow → count a miss");
tapping opens the branch. No block names, port names or file paths; badges for a problem, "records time",
"not supported by your pod". One floating **+** adds after the selected step or at the end of the round.

### D. Step sheet (replaces the inspector in the simple view)
Top to bottom: 1. **Problems** in words. 2. **Essentials**: 1–3 large controls (swatches, LED ring, "which
pod" chips Pod 1…n / random pod / random never the same twice (`editor/podChoice.ts`), pause with Fixed |
Random). 3. **Feature switches** (`editor/switches.ts`): fields only when on; off removes the fields and the
branch it created: *Time limit* (seconds, "If too slow → go on | count a miss | end the round"), *Record
reaction time*, *Count a miss* (with a time limit or red pods), *Red "don't touch" pods* (count, colour, "If
a red pod is hit → …"), *Catch early presses* (pause becomes the button-with-random-timeout pattern of
`solo.json`), *Long press does something else* (hold time, second chip). 4. **More options** (collapsed):
§5 "More". 5. **Actions**: add after, move up / down, duplicate, delete (undo toast). 6. **Expert** (expert
mode): name, type, raw keys, a "go to" select per port, raw JSON.

### E. "Add a step" by intent (`editor/AddStepSheet.tsx`, `stepRecipes.ts`)
Tiles: Light up the central, Pause, Wait for a press, Light a pod, Race: all pods at once, Count or remember,
Decide, Repeat, Show results, Turn all pods off. Above them recipes that add several blocks: "Count a miss
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

**Essential** = step sheet, **Switch** = behind the named switch, **More** = More options, **Expert** = expert
mode only. Metadata: `level` and `group` on `FieldDef` in `packages/program-model/src/blockTypes.ts` (shared
with the platform), port labels per type.

| Block | Essential | Switch | More | Expert |
|---|---|---|---|---|
| `led` | `color`, `leds` | – | timers | name |
| `delay` | `ms` or `minMs`+`maxMs` | *Catch early presses* (→ `button`) | timers | |
| `button` | – | *Time limit* `timeoutMs`, `timeout`; *Record* `record`; *Long press* `shortMs`, `short`, `long` | `storeAs`, timers | `pressed` vs `next`, metric |
| `remotePress` | `pod`, `color` | *Time limit*; *Don't touch* `mode: avoid`; *Record* | `colorAfter`, `storeAs`, timers | metric |
| `remoteMultiPress` | `hitColor`, `pods` | *Red pods* `avoid`, `avoidColor`, `avoidHit`; *Time limit*; *Record* | `includeCentral`, `syncStartMs`, timers | metric |
| `remoteResetAll` | – | – | `pods`, `ledsOff` | |
| `setVariable` | `var` (pick / "new setting…"), `op` in words, `value` | – | – | raw op |
| `if` | `left`, `op` in words ("is at least"), `right` | – | – | raw op |
| `summary` | average / best / worst / count (each creates its `store…` variable) | – | `reset` | `metric` |
| `repeat` | `count` | – | `storeIndex` | |

Newer blocks (`effect`, `charge`, `release`, `toggle`, `communicate`) have their own steps
(`editor/effectStep.ts`, `holdStep.ts`, `toggleStep.ts`, `ListFields.tsx`, `countdown.ts`).

**Port names** (in words): pressed / next "Then", timeout "If too slow" (avoid pod: "If left alone"), short
"Short press", long "Long press", avoidHit "If a red pod is hit", true / false "If yes" / "If no", body
"Each round", done "After the last round"; app-only role `ifPressedEarly` for the false-start press.

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
