# Acceptance tests – Config App

On real hardware unless stated. Standard setup: ≥ 3 charged pods (main pod + 2 pods), main pod in the
menu (button held during the boot gauge), desktop Chrome with USB-C, Android phone with Chrome. Note
generation and store hash first (`reactpod_serial.py` → `info`). Record results in the table at the end;
mark "pass" only when the user reported it.

## S – USB serial (desktop Chrome)
| ID | Steps | Expected |
|---|---|---|
| AT-S1 | main pod in the menu, connection dialog → USB cable | connected, **no reset** (no boot gauge), `info` shown |
| AT-S2 | same with a pod | role "peripheral", send / Reset menu / delete disabled |
| AT-S3 | unplug while connected | "disconnected" within 2 s, UI responsive |
| AT-S4 | Settings → Advanced → debug console | firmware log separate from API responses |

## B – BLE (Android and desktop Chrome; fw ≥ 2.1, B5–B7 ≥ 2.6)
| ID | Steps | Expected |
|---|---|---|
| AT-B1 | connection dialog → Bluetooth | chooser lists "ReactPod xxxx", connect, `info` shown |
| AT-B2 | main pod not in the menu (fw < 2.12, game running) | not found; hint how to open the menu |
| AT-B3 | read all games of the default set | completes; note duration and `info.mtu` |
| AT-B4 | select a game on the pod while connected | fw < 2.12: "disconnected", nothing lost locally; fw ≥ 2.12: stays connected |
| AT-B5 | two main pods in the menu | two names; each suffix matches the set id on This set |
| AT-B6 | rename the set to "Halle 2", reconnect | chooser and This set show it |
| AT-B7 | PIN over USB (`reactpod_serial.py set-pin 1234`), rename over BLE | PIN asked; wrong → "Wrong PIN", right → saved; clear the PIN afterwards |

## P – Sync and send
| ID | Steps | Expected |
|---|---|---|
| AT-P1 | fresh pod with defaults, connect | all "in sync" or "on the pod", library read-only |
| AT-P2 | new game (main pod + 2 pods, preset `loop`), Save and add to menu, send | Review changes lists the game + `/programs.json`; upload, validates ok; Games on the pods shows the pattern |
| AT-P3 | play it on the pods | behaves like Try |
| AT-P4 | switch on a pod that was off during P2, start a game | the game spreads to it (`list` over serial) |
| AT-P5 | send a version with a type error (test hook / serial) | pod's `invalid_program` shown on the right block |
| AT-P6 | change a game via `reactpod_config.py` and in the app | conflict; "keep pod" and "keep mine" work |
| AT-P7 | send while a game runs | `busy` explained, old file intact (CRC unchanged) |
| AT-P8 | umlauts in name / description (`Übung`) | CRC ok, identical when read back |
| AT-P9 | Reset menu with a user game on the pod | default menu, user file still there |
| AT-P10 | delete a file (Settings → Advanced) | extra confirmation; library and menu not offered |
| AT-P11 | Export set, Import set in a fresh browser, send | same games and menu, identical CRCs |
| AT-P12 | PIN set, send over BLE | PIN asked; wrong PIN stops before any write |
| AT-P13 | send a game with an unknown block type (fw ≥ 2.4) | the check on the pods reports it, "Nothing was changed", `list` unchanged |

## M – Try (compare with hardware)
| ID | Steps | Expected |
|---|---|---|
| AT-M1 | Try `duo.json`, press as they light | main pod + 1 pod, current block, `reaction` and `MISSES` update |
| AT-M2 | step through `dreieck.json`, 3 rounds | every entered block one by one, `SELECTED` never repeats |
| AT-M3 | `run5.json`, press a red pod | `avoidHit` → `Fail` |
| AT-M4 | same seed twice | identical sequence |
| AT-M5 | `solo.json` on the pod with `trace on` vs Try, same presses | same block sequence |

## R – Athletes and results (demo pod: "Demo: send a report"; real pods need `reports` / `remote`)
| ID | Steps | Expected |
|---|---|---|
| AT-R1 | add an athlete, choose it under *Train*, 3 reports, **Repeat** after the 2nd | one session, 3 reports, the 2nd discarded and not counted |
| AT-R2 | reload, restart the phone | everything still there |
| AT-R3 | athlete → Export CSV, open in a spreadsheet | one row per measurement, `;` (de) / `,` (en), umlauts readable |
| AT-R4 | report while IndexedDB is blocked (private window) | warning; the pod keeps the report (no `ack`) |
| AT-R5 | platform preview: test server, mail code, club, link athlete (consent), record offline, go online | reports appear once; *Upload now* again: no duplicates; a later discard updates only its flag |
| AT-R6 | main pod without `reports` (fw 2.7) | This set says no results yet; everything else as before |

## L – Train and reconnect (P9; fw 2.12; L1, L2, L8 on hold with #46; L3, L13–L17 specified in #87, L3 needs its firmware)
| ID | Steps | Expected |
|---|---|---|
| AT-L1 | *(on hold)* connect set A, then B | two cards |
| AT-L2 | *(on hold)* both at a *Report* block, *Continue* on B | only B leaves *Waiting for you* |
| AT-L3 | pod in CONFIRM (READY), start card: *Rounds* (`MAX_LOOPS`) = 20, *Start with these values* | card shows the pod's value before *Start with these values*; first round already uses 20; a value outside 1–50 is refused on the card, nothing sent |
| AT-L4 | *Pause*, 10 s, *Resume* | PAUSED (all yellow), then the same round goes on |
| AT-L5 | switch the main pod off 20 s in a game, on again, do not touch the app | *Reconnecting…* → *Connected*; reports from the drop appear, none lost or doubled |
| AT-L6 | reload with the set in reach | picked again with one tap; kept reports shown |
| AT-L7 | Train open, 3 min unattended (screen on) | screen stays on; after a lock BLE drops and reconnects after unlock (document only) |
| AT-L8 | *(on hold)* two demo sets | two independent cards |
| AT-L9 | main pod fw 2.10 (no `reports`) | card says no results; no Continue / Pause; athlete selectable |
| AT-L10 | main pod fw 2.11 (no `liveBle`, `pause`) | note that Bluetooth goes off in a game; no Pause; Continue / Repeat / Stop work |
| AT-L11 | 360 px, light and dark | nothing cut off, no horizontal scroll, buttons ≥ 44 px, readable |
| AT-L12 | connect another set (or the same again) | the first connection ends; one card |
| AT-L13 | main pod without `startVars` (fw before #87), in CONFIRM: start card; then the same without `remote` | no steppers; *Start* sends `start` only (no `setVariables`); without `remote`: text "Press the main pod to start." |
| AT-L14 | during a round (no *Waiting for you*) press *Continue*; wait for the next *Waiting for you* | card shows *Queued: Continue*; no `command` sent before the wait; then exactly one `command` (continue); queue empty |
| AT-L15 | during a round press *Continue*, then *Stop*; then *Continue* again and *Cancel* | *Queued: Stop* (newer press replaces); *Cancel* removes it; at the next wait nothing is sent |
| AT-L16 | slow link (weak signal or distance); press *Pause* in RUN, then *Resume* in PAUSED | a timed-out command never shows an error for an applied command; card shows the real state after the status read (PAUSED or RUN), no stale error |
| AT-L17 | This set with a connected main pod | no Continue / Repeat / Stop / Pause / Start controls; a link opens Train |

## E – Block builder (P8; demo or no pod, 360 px; "format-1 pod" = fw < 2.8 or demo pod with `programFormat` 1)
| ID | Steps | Expected |
|---|---|---|
| AT-E1 | Try a `repeat` (3) + timer pair; same game on fw 2.8 with `trace on` | 3 × `body`, `done`; one timer value per pass; same sequence |
| AT-E2 | open a `button` step | essentials, "+ Add sprinkle" with *Time limit*, *Record reaction*, *Long press* (Rules / Measure / Flow); no raw keys or port selects |
| AT-E3 | add the Sprinkle *Time limit*, 2 s, exit "If too slow" → "Count a miss, then continue"; Remove; undo | fields + miss branch appear / disappear; undo restores |
| AT-E4 | random pause with shortest > longest | problem in words on the card and the sheet |
| AT-E5 | open `solo`, `stern`, `run5` | one line per numbered step (number, tile, sentence), one Repeat bracket, exit lines under steps ("If too slow · Count a miss"), sliders badge only for advanced Sprinkles, no block / port names |
| AT-E6 | move a step, delete one, Undo on the toast | links follow; still validates and runs in Try; undo restores step and links |
| AT-E7 | guided wizard (Start from a game): each of the 5 games with defaults | ≤ 6 screens, short story, Try it runs the game |
| AT-E8 | guided wizard with a format-2 pod, then format-1 | `repeat` / `lib/loop` pattern; same bracket and same Try run |
| AT-E9 | Save and add to menu, send, play | in Games on the pods, runs like Try |
| AT-E10 | + "Wait for a press" after a light; recipe "Count a miss when too slow" | values from the round, no placeholder variable; counter + branch added |
| AT-E11 | game settings panel: "Rounds", "Shortest pause" | labelled steppers in seconds; file values change |
| AT-E12 | shipped and pod game (also read-only pod): About → Make my copy; in the copy's game settings change Rounds; Try | local copy, same path; read-only note on the original; pod unchanged until send |
| AT-E13 | expert mode on, reload | block view, port selects, raw keys; remembered |
| AT-E14 | de ↔ en on every new screen | all translated |
| AT-E15 | step sheet of every block type (360 px, both themes) | essentials, Sprinkle rows, "+ Add sprinkle"; "More options" has at most 3 entries, none of them a Sprinkle field; rows open one at a time; nothing cut off; no animation with reduced motion |
| AT-E16 | add and remove every Sprinkle on every block it applies to; Undo | fields, exit and helper blocks appear and go; nothing else changes; "Turn pods off afterwards" adds / removes one step; opening a shipped game changes nothing |
| AT-E17 | normal mode: set every exit of Decide, Repeat, Hold to charge, Let go, Domination, Report and the time-out of a press with the exit picker, incl. "A new step here…" and a target that would loop without waiting | steps named by number and sentence; the instant loop is greyed out with the reason; no expert mode needed |
| AT-E18 | Report: results as checkboxes, time limit, "Phone can change settings" (include / coach may change with min and max) | `metrics`, `timeoutMs`, `vars`, `editable` change; limit 8 per list; raw lists only in expert mode |
| AT-E19 | Add a step: tiles | grouped Light / Wait / Think / Results; a format-1 pod greys out the Sprinkles it cannot run |

## D – Design review rework (#106, PR #110; phone first; all "open" until the user reports them)
| ID | Steps | Expected |
|---|---|---|
| AT-D1 | tap each tab; type `#/programs`, `#/editor`, `#/simulate`, `#/training`, `#/pod`, `#/menu` in the address bar | tab bar shows **Train · Games · Results** only, Settings from the header gear; old links open Games, the game page in Edit or Try, Train, This set, the menu; query strings kept; `#/editor` with no game opens the Games list |
| AT-D2 | desktop ≥ 900 px: open a session from an athlete, Back; open a game, Back; open the menu, Back | side rail with Train, Games, Results, Settings, no tab bar; Back goes to the athlete, to Games and to This set (never a history jump); the parent tab stays highlighted |
| AT-D3 | connected: tap the connection chip; disconnect; tap the chip again | connected: opens **This set**; not connected: opens the connection dialog |
| AT-D4 | connected: change a step in a game (Edit), do not send, look at the chip; open This set; send; look again | chip has a dot and "Changes not on the pods yet"; This set names the changes in words with one **Send to pods**; after sending, dot and text are gone |
| AT-D5 | not connected: open Train; dismiss the keep-open hint, reload | puck, "Connect a set", three numbered steps, one primary button; the hint appears once and stays dismissed |
| AT-D6 | connected set (fw 2.12, main pod READY): open Train | state header in the pod-light colour with the state in words; athlete chips (4, then "More (n)") and "Add athlete"; no athlete chosen: "Results are only saved for a named athlete." |
| AT-D7 | after round results arrive | "Last round result" with big Best and Average figures, "faster / slower / same than the round before", "All rounds today"; a round without values says "This round has no values." |
| AT-D8 | in CONFIRM: press + and − on a value up to its limit; press Start | the stepper changes the value; at min / max its button is disabled; label "Changed – applied with Start"; Start applies the values, then starts (see AT-L3, AT-L13) |
| AT-D9 | during a round, at *Waiting for you*: tap Continue, Repeat, Pause, Stop (fw ≥ 2.11) | the four controls sit together at the bottom, Stop in the danger style; each sends its command once; Pause missing on fw < 2.12 is noted in words (AT-L10) |
| AT-D10 | open Games | each row: name, description, "Main pod + n pods" or "Main pod only"; a normal row has no chip; a problem ("not in menu", "Needs pod software …") is a chip with words |
| AT-D11 | open a shipped game: About, then Edit, then **Make my copy** | About: story, settings summary, pod status, Try / Edit actions; Edit: "This game comes with the app and cannot be changed." with **Make my copy**; the copy opens in Edit; the shipped game is unchanged |
| AT-D12 | open a game (pod or demo), **Try**, tap a pod | pods are tappable; current step as a sentence ("Step n of m: …"); results in seconds; details collapsed; bottom bar Pause, Skip pause, Start over |
| AT-D13 | open a random-pod step, a round-result step, a results step, a locked step, and the LED colour choice | plain words, no block or port names (outside expert mode); a locked step says why; colours by name, with presets; sheet footer **Done** |
| AT-D14 | two athletes with trainings: Results, then an athlete, then a training | athletes sorted by last training; athlete: trend, change, personal best with date; training: summary (best, average) above the rounds |
| AT-D15 | training with 3 rounds: tap **Discard** on one; then Undo in the notice | round marked "Not counted", summary and average recount, round count changes; Undo restores the round and the numbers |
| AT-D16 | switch de ↔ en on Train, Games, This set, a game page, Results | de: Spiele, Zentrale, "Auf die Pods hochladen", Runde; en: game, main pod, Send to pods, round; durations in seconds in both; variables and metrics with human labels; no missing keys |
| AT-D17 | visit every page without a platform sign-in; then Settings → Advanced | platform only as "Platform (preview)" under Advanced; nothing about the platform on Train, Games, This set or Results |
| AT-D18 | open online once; go offline; reload; later, online again | "Ready to work offline." as a bottom toast above the tab bar, gone by itself, not shown again in this browser; a new version shows a top toast "A new version is available." and waits for *Update* |
| AT-D19 | 360 px, light and dark, every page of AT-D1–D18 and D20–D25 (1200 px and desktop: spot check, #107) | nothing cut off, no horizontal scroll, touch targets ≥ 44 px, + button and toasts clear of the tab bar; screenshots looked at |
| AT-D20 | open a shipped game and a pod game: About, then Edit | About: no **Change settings**, the action is **Make my copy**; Edit: "This game comes with the app and cannot be changed." with **Make my copy**, no panel |
| AT-D21 | open a game of mine: About → **Change settings**; set Rounds, pods besides the main pod, name and a time limit; Undo after each change | Edit opens with the **Game settings** panel; About's summary and the game follow each change; each Undo reverts exactly that change |
| AT-D22 | in the panel, "For the whole game": switch Time limit on, set Seconds to press and "if too slow"; switch Record reaction times and Show results at the end on and off; then open a game built from library parts (Stern or Run5) | each switch changes the game and its steps; the time limit shows in About; the library game shows the shared-pieces note instead of switches |
| AT-D23 | Games → **+** → Quick game: pick game, pods, rounds and colour on one screen; tap **Create game**; repeat and tap **Create and adjust** | one screen with those four fields, a name field and both buttons; Create game opens About of the new game; Create and adjust opens Edit with the **Game settings** panel open |
| AT-D24 | Quick game: pods at 0, pick **All at once** (needs 2 pods besides the main pod) | the pods stepper rises to 2 and its minus stops there; with Solo or Duo no pods stepper is shown |
| AT-D25 | Games → **+** → **Start from a game** (the guided wizard) | reached from the chooser as "Start from a game"; the five questions (game, pods, rounds and timing, colours, measure) and the Ready screen (Try it, Change steps, Save and add to menu) as before |

## U – Usability
| ID | Steps | Expected |
|---|---|---|
| AT-U1 | installed PWA in airplane mode (or `npm run preview` + DevTools offline) | local games, Edit and Try work |
| AT-U2 | 360 px: 5-block game without drag and drop | possible, nothing cut off |
| AT-U3 | de ↔ en | no missing keys |
| AT-U4 | iPhone Safari | Edit + Try; connecting explains Bluetooth needs the app |
| AT-U5 | menu pattern in the app vs the pod | same LEDs (LED 0 top, clockwise) |
| AT-U6 | open every shipped game and the 4 library parts | readable, details match the JSON |

## Results (reported by Patrick Stähle)
| IDs | Date | Firmware | Result |
|---|---|---|---|
| AT-S1–S4 | 2026-10-18 | 2.0 | pass |
| AT-B1–B7 | 2026-10-26 | 2.9 | pass (2.0 blocked: no indications) |
| AT-P1–P13, AT-M1–M5 | 2026-10-19 | 2.7 | accepted (P5, P6) |
| AT-R1–R6, AT-E1–E14, AT-U1–U6 | 2026-10-26 | 2.9 | pass (P7, P8) |
| AT-E2, E3, E5, E15–E19 | – | – | open (#88, step sheet and step list rebuilt, ready for test) |
| AT-E11, E12 | – | – | open (#106, rewritten for the Game settings panel; the 2026-10-26 pass was for the Adjust sheet) |
| AT-L1–L12 | – | 2.12 | open (P9, ready for test; L3 changed by #87) |
| AT-L13–L17 | – | – | open (#87, specified, not built) |
| AT-D1–D25 | – | – | open (#106, PR #110 merged; for the user to test) |
