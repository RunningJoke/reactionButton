# Acceptance tests – Config App

On real hardware unless stated. Standard setup: ≥ 3 charged pods (central + 2 peripherals), central in the
menu (button held during the boot gauge), desktop Chrome with USB-C, Android phone with Chrome. Note
generation and store hash first (`reactpod_serial.py` → `info`). Record results in the table at the end;
mark "pass" only when the user reported it.

## S – USB serial (desktop Chrome)
| ID | Steps | Expected |
|---|---|---|
| AT-S1 | central in the menu, Pod → USB | connected, **no reset** (no boot gauge), `info` shown |
| AT-S2 | same with a peripheral | role "peripheral", push / restore / delete disabled |
| AT-S3 | unplug while connected | "disconnected" within 2 s, UI responsive |
| AT-S4 | Settings → Advanced → debug console | firmware log separate from API responses |

## B – BLE (Android and desktop Chrome; fw ≥ 2.1, B5–B7 ≥ 2.6)
| ID | Steps | Expected |
|---|---|---|
| AT-B1 | Pod → Bluetooth | chooser lists "ReactPod xxxx", connect, `info` shown |
| AT-B2 | central not in the menu (fw < 2.12, game running) | not found; hint how to open the menu |
| AT-B3 | read all programs of the default set | completes; note duration and `info.mtu` |
| AT-B4 | select a program on the pod while connected | fw < 2.12: "disconnected", nothing lost locally; fw ≥ 2.12: stays connected |
| AT-B5 | two centrals in the menu | two names; each suffix matches the set id on the Pod tab |
| AT-B6 | rename the set to "Halle 2", reconnect | chooser and Pod tab show it |
| AT-B7 | PIN over USB (`reactpod_serial.py set-pin 1234`), rename over BLE | PIN asked; wrong → "Wrong PIN", right → saved; clear the PIN afterwards |

## P – Sync and push
| ID | Steps | Expected |
|---|---|---|
| AT-P1 | fresh pod with defaults, connect | all "in sync" or "pod only", library read-only |
| AT-P2 | new program (2 peripherals, preset `loop`), add to menu, push | plan = program + `/programs.json`; upload, `validate` ok; pod menu shows the pattern |
| AT-P3 | play it on the pods | behaves like the simulator |
| AT-P4 | switch on a pod that was off during P2, start a program | the program spreads to it (`list` over serial) |
| AT-P5 | push a version with a type error (test hook / serial) | pod's `invalid_program` shown on the right block |
| AT-P6 | change a program via `reactpod_config.py` and in the app | conflict; "keep pod" and "keep mine" work |
| AT-P7 | push while a game runs | `busy` explained, old file intact (CRC unchanged) |
| AT-P8 | umlauts in name / description (`Übung`) | CRC ok, identical when read back |
| AT-P9 | restore defaults with a user program on the pod | default menu, user file still there |
| AT-P10 | delete a file (Settings → Advanced) | extra confirmation; library and menu not offered |
| AT-P11 | export set, import in a fresh browser, push | same programs and menu, identical CRCs |
| AT-P12 | PIN set, push over BLE | PIN asked; wrong PIN stops before any write |
| AT-P13 | push a program with an unknown block type (fw ≥ 2.4) | dry run reports it, "Nothing was changed", `list` unchanged |

## M – Simulator (compare with hardware)
| ID | Steps | Expected |
|---|---|---|
| AT-M1 | simulate `duo.json`, press as they light | central + 1 peripheral, current block, `reaction` and `MISSES` update |
| AT-M2 | step through `dreieck.json`, 3 rounds | every entered block one by one, `SELECTED` never repeats |
| AT-M3 | `run5.json`, press a red pod | `avoidHit` → `Fail` |
| AT-M4 | same seed twice | identical sequence |
| AT-M5 | `solo.json` on the pod with `trace on` vs simulator, same presses | same block sequence |

## R – Athletes and results (demo pod: "Demo: send a report"; real pods need `reports` / `remote`)
| ID | Steps | Expected |
|---|---|---|
| AT-R1 | add an athlete, choose it under *Training*, 3 reports, **Repeat** after the 2nd | one session, 3 reports, the 2nd discarded and not counted |
| AT-R2 | reload, restart the phone | everything still there |
| AT-R3 | athlete → Export CSV, open in a spreadsheet | one row per measurement, `;` (de) / `,` (en), umlauts readable |
| AT-R4 | report while IndexedDB is blocked (private window) | warning; the pod keeps the report (no `ack`) |
| AT-R5 | platform preview: test server, mail code, club, link athlete (consent), record offline, go online | reports appear once; *Upload now* again: no duplicates; a later discard updates only its flag |
| AT-R6 | central without `reports` (fw 2.7) | Pod tab says no results yet; everything else as before |

## L – Training view and reconnect (P9; fw 2.12; L1, L2, L8 on hold with #46; L3, L13–L17 specified in #87, L3 needs its firmware)
| ID | Steps | Expected |
|---|---|---|
| AT-L1 | *(on hold)* connect set A, then B | two cards |
| AT-L2 | *(on hold)* both at a *Report* block, *Continue* on B | only B leaves *Waiting for you* |
| AT-L3 | pod in CONFIRM (READY), start card: *MAX_LOOPS* = 20, *Start* | card shows the pod's value before *Start*; first round already uses 20; a value outside 1–50 is refused on the card, nothing sent |
| AT-L4 | *Pause*, 10 s, *Resume* | PAUSED (all yellow), then the same round goes on |
| AT-L5 | switch the central off 20 s in a game, on again, do not touch the app | *Reconnecting…* → *Connected*; reports from the drop appear, none lost or doubled |
| AT-L6 | reload with the set in reach | picked again with one tap; kept reports shown |
| AT-L7 | training view open, 3 min unattended (screen on) | screen stays on; after a lock BLE drops and reconnects after unlock (document only) |
| AT-L8 | *(on hold)* two demo sets | two independent cards |
| AT-L9 | central fw 2.10 (no `reports`) | card says no results; no Continue / Pause; athlete selectable |
| AT-L10 | central fw 2.11 (no `liveBle`, `pause`) | note that Bluetooth goes off in a game; no Pause; Continue / Repeat / Stop work |
| AT-L11 | 360 px, light and dark | nothing cut off, no horizontal scroll, buttons ≥ 44 px, readable |
| AT-L12 | connect another set (or the same again) | the first connection ends; one card |
| AT-L13 | central without `startVars` (fw before #87), in CONFIRM: start card; then the same without `remote` | no steppers; *Start* sends `start` only (no `setVariables`); without `remote`: text "Press the central to start" |
| AT-L14 | during a round (no *Waiting for you*) press *Continue*; wait for the next *Waiting for you* | card shows *Queued: Continue*; no `command` sent before the wait; then exactly one `command` (continue); queue empty |
| AT-L15 | during a round press *Continue*, then *Stop*; then *Continue* again and *Cancel* | *Queued: Stop* (newer press replaces); *Cancel* removes it; at the next wait nothing is sent |
| AT-L16 | slow link (weak signal or distance); press *Pause* in RUN, then *Resume* in PAUSED | a timed-out command never shows an error for an applied command; card shows the real state after the status read (PAUSED or RUN), no stale error |
| AT-L17 | Pod tab with a connected central | no Continue / Repeat / Stop / Pause / Start controls; a link opens the Training tab |

## E – Block builder (P8; demo or no pod, 360 px; "format-1 pod" = fw < 2.8 or demo pod with `programFormat` 1)
| ID | Steps | Expected |
|---|---|---|
| AT-E1 | simulate a `repeat` (3) + timer pair; same program on fw 2.8 with `trace on` | 3 × `body`, `done`; one timer value per pass; same sequence |
| AT-E2 | open a `button` step | essentials and *Time limit*, *Record reaction time*, *Long press*; no raw keys or port selects |
| AT-E3 | *Time limit* on, 2 s, "count a miss"; off again; undo | fields + miss branch appear / disappear; undo restores |
| AT-E4 | random pause with shortest > longest | problem in words on the card and the sheet |
| AT-E5 | open `solo`, `stern`, `run5` | numbered sentences, one Repeat bracket, branch chips, no block / port names |
| AT-E6 | move a step, delete one, Undo on the toast | links follow; still validates and simulates; undo restores step and links |
| AT-E7 | wizard: each of the 5 games with defaults | ≤ 6 screens, short story, Try it simulates |
| AT-E8 | wizard with a format-2 pod, then format-1 | `repeat` / `lib/loop` pattern; same bracket and simulation |
| AT-E9 | save and add to menu, push, play | in the pod's menu, runs like the simulator |
| AT-E10 | + "Wait for a press" after a light; recipe "Count a miss when too slow" | values from the round, no placeholder variable; counter + branch added |
| AT-E11 | program sheet: "Rounds", "Shortest pause" | labelled steppers in seconds; file values change |
| AT-E12 | Adjust on a local, shipped and pod program (also read-only pod), Try, Save | local copy, same path; read-only note; pod unchanged until push |
| AT-E13 | expert mode on, reload | block view, port selects, raw keys; remembered |
| AT-E14 | de ↔ en on every new screen | all translated |

## U – Usability
| ID | Steps | Expected |
|---|---|---|
| AT-U1 | installed PWA in airplane mode (or `npm run preview` + DevTools offline) | local programs, editor, simulator work |
| AT-U2 | 360 px: 5-block program without drag and drop | possible, nothing cut off |
| AT-U3 | de ↔ en | no missing keys |
| AT-U4 | iPhone Safari | editor + simulator; connecting explains Bluetooth needs the app |
| AT-U5 | menu pattern in the app vs the pod | same LEDs (LED 0 top, clockwise) |
| AT-U6 | open every shipped program and the 4 library parts | readable, details match the JSON |

## Results (reported by Patrick Stähle)
| IDs | Date | Firmware | Result |
|---|---|---|---|
| AT-S1–S4 | 2026-10-18 | 2.0 | pass |
| AT-B1–B7 | 2026-10-26 | 2.9 | pass (2.0 blocked: no indications) |
| AT-P1–P13, AT-M1–M5 | 2026-10-19 | 2.7 | accepted (P5, P6) |
| AT-R1–R6, AT-E1–E14, AT-U1–U6 | 2026-10-26 | 2.9 | pass (P7, P8) |
| AT-L1–L12 | – | 2.12 | open (P9, ready for test; L3 changed by #87) |
| AT-L13–L17 | – | – | open (#87, specified, not built) |
