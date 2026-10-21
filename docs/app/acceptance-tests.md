# Acceptance tests – Config App v1

Test procedures on real hardware. Each test lists its setup, its steps and the expected
result. Record the result (pass / fail, browser + version, firmware version, notes) in the
table at the end.

**Standard setup:** a set of at least 3 pods (1 central + 2 peripherals), charged, firmware
2.0. The central is in the program menu (switch it on and hold the button during the blue
boot animation). Desktop Chrome with a USB-C cable, and an Android phone with Chrome.

Before a test session: run `python tools/reactpod_serial.py` → `info` to note the
generation and store hash.

---

## S – USB serial (desktop Chrome)

| ID | Steps | Expected |
|---|---|---|
| AT-S1 | Plug in the central (in the menu), app → Pod → USB, pick the port | connected, **the pod does not reset** (no boot animation), `info` shown |
| AT-S2 | Same with a peripheral | connected, role "peripheral" shown, push / restore / delete disabled (read-only) |
| AT-S3 | Unplug the cable while connected | app shows "disconnected" within 2 s, no frozen UI |
| AT-S4 | Open Settings → Advanced → debug console | firmware log lines appear, separate from API responses |


## B – BLE (Android Chrome, desktop Chrome)

Needs firmware ≥ 2.1 (change request CR-0, archived in `docs/archive/changerequest/config-app-api.md`). With firmware 2.0 the app connects, then reports "The pod did not answer" (timeout). AT-B5…B7 need firmware ≥ 2.6.

| ID | Steps | Expected |
|---|---|---|
| AT-B1 | App → Pod → Bluetooth | chooser lists "ReactPod xxxx" (last 4 digits of the set id), connecting works, `info` shown |
| AT-B2 | Central not in the menu (game running) | the app does not find it and shows the hint how to open the menu |
| AT-B3 | Read all programs of the default set | completes. Note the duration and the MTU (`info.mtu`, debug console) |
| AT-B4 | Select a program on the pod (long press) while connected | app shows "disconnected" (BLE off), no data loss locally |
| AT-B5 | Two centrals in the menu at the same time | the chooser shows two different names; each suffix matches the set id in the Pod tab |
| AT-B6 | Pod tab → rename the set to "Halle 2", disconnect, connect again | the chooser and the Pod tab show "ReactPod Halle 2" / "Halle 2" |
| AT-B7 | Set a PIN over USB (`reactpod_serial.py set-pin 1234`), then rename over BLE | the app asks for the PIN; a wrong PIN shows "Wrong PIN", the right one saves. Clear the PIN over USB afterwards |

## P – Sync and push

| ID | Steps | Expected |
|---|---|---|
| AT-P1 | Fresh pod with default programs, connect | all files "in sync" or "pod only", library read-only |
| AT-P2 | Create a new program in the app (2 peripherals, uses preset `loop`), add it to the menu, push | plan shows program + `/programs.json`; upload ok; `validate` ok; the pod menu shows the new pattern |
| AT-P3 | Select the new program on the pod with all pods on, play it | it behaves like in the simulator |
| AT-P4 | Then switch on a pod of the set that was off during P2, start a program | the new program spreads to it (check with `list` over serial) |
| AT-P5 | Edit a program, push a version with a type error (forced through serial / test hook) | app shows the pod's `invalid_program` message on the right block |
| AT-P6 | Change a program on the pod via `tools/reactpod_config.py` and in the app, connect | conflict shown, "keep pod" and "keep mine" both work |
| AT-P7 | Push while the central runs a game (serial) | `busy` explained, nothing half written (old file intact, CRC unchanged) |
| AT-P8 | Upload a program with umlauts in name / description (`Übung`) | CRC ok, file identical when read back |
| AT-P9 | Restore defaults on a pod with a user program | default menu restored, user program file still present (`list`) |
| AT-P10 | Delete a file via Settings → Advanced | needs the extra confirmation, library and menu are not offered |
| AT-P11 | Programs → Export set, then on another browser / after clearing site data: Import set, push | the same programs and menu arrive on the pod; files identical (`list` CRCs) |
| AT-P12 | PIN set over USB, push over BLE | the push dialog asks for the PIN; a wrong PIN stops with "Wrong PIN" before anything is written |
| AT-P13 | Push a program with an unknown block type to a pod (firmware ≥ 2.4, e.g. edit the JSON and import it) | the pod's dry run reports it, "Nothing was changed", `list` unchanged |

## M – Simulator (no hardware needed, compare with hardware)

| ID | Steps | Expected |
|---|---|---|
| AT-M1 | Simulate `duo.json`, press the pods as they light | central + 1 peripheral shown, current block highlighted, metric `reaction` and `MISSES` update |
| AT-M2 | Step mode through `dreieck.json`, 3 rounds | every entered block is shown one by one, `SELECTED` never repeats |
| AT-M3 | `run5.json`, press a red pod | `avoidHit` → `Fail` path |
| AT-M4 | Same seed twice | identical block sequence |
| AT-M5 | Compare: run `solo.json` on the pod with `trace on` (serial) and in the simulator with the same presses | same block sequence |

## R – Athletes and results (#47, #48)

AT-R1 … AT-R5 run with the demo pod (it emits sample reports: **Demo: send a report** on the Pod
tab). On real pods they need the firmware features `reports` (#41) and `remote` (#42); pods without
them must work exactly as before (AT-R6).

| ID | Steps | Expected |
|---|---|---|
| AT-R1 | Results: add an athlete. Pod: connect, choose the athlete under *Training*, send 3 reports, **Repeat** after the 2nd | one session with 3 reports, the 2nd marked discarded and not counted in the statistics |
| AT-R2 | Reload the app, then restart the phone | athletes, sessions and reports are still there |
| AT-R3 | Results → athlete → **Export CSV**, open it in a spreadsheet (de: `;`, en: `,`) | one row per measurement, umlauts readable |
| AT-R4 | A report arrives while IndexedDB is blocked (private window) | warning on the Results tab; the pod keeps the report (no `ack`) |
| AT-R5 | Settings → Platform: server of a test platform, sign in with the mail code, choose a club; link the athlete (new profile, consent); go offline, record reports, go online | the reports appear in the profile once; **Upload now** again creates no duplicates; discarding a report later updates only its flag |
| AT-R6 | Real central without `reports` (firmware 2.7) | Pod tab says it sends no results yet; sync, push and all programs work as before |

## E – Block builder (P8, [editor-ux.md](editor-ux.md))

Demo pod or no pod unless stated; phone width (360 px) unless stated. "Format 1 pod" = a
central with firmware before 2.8 (or the demo pod set to `programFormat` 1).

| ID | Steps | Expected |
|---|---|---|
| AT-E1 | (P8a) Simulate a program with a `repeat` block (count 3) and a `timerStart` / `timerStop` pair; run the same program on a pod with firmware 2.8 and `trace on` | 3 passes through `body`, then `done`; one timer measurement per pass; same block sequence as the pod |
| AT-E2 | (P8a) Editor: open a `button` step | only essentials and the switches *Time limit*, *Record reaction time*, *Long press*; no raw keys, no port selects |
| AT-E3 | (P8a) Turn *Time limit* on, set 2 s, choose "If too slow → count a miss"; turn it off again | fields and the miss branch appear; turning off removes the fields and the branch; undo brings them back |
| AT-E4 | (P8a) Set a random pause with shortest > longest | the problem shows in words on the card and at the top of the step sheet |
| AT-E5 | (P8b) Open `solo.json`, `stern.json`, `run5.json` in the editor | numbered steps in sentences, the round loop as one "Repeat … rounds" bracket, branches as chips; no block or port names |
| AT-E6 | (P8b) Move a step up and down inside the round, delete a step, tap Undo on the toast | links follow the move; the program still validates and simulates; undo restores the step and its links |
| AT-E7 | (P8c) Programs → + → Start from a game: make each of the 5 games with the defaults | each finishes in ≤ 6 screens, the Ready screen tells the program as a short story, Try it runs it in the simulator |
| AT-E8 | (P8c) Wizard with a format-2 pod connected, then with a format-1 pod | format 2: a `repeat` block; format 1: the `lib/loop` counter pattern; both show the same Repeat bracket in the editor and run the same in the simulator |
| AT-E9 | (P8c) Save and add to menu, push to a real set, play a round | the program is in the pod's menu and runs like in the simulator |
| AT-E10 | (P8d) + in the step list: add "Wait for a press" after a light, and the recipe "Count a miss when too slow" | the step gets values from the round (colour, time limit), never a placeholder variable; the recipe adds the counter and its branch |
| AT-E11 | (P8e) Program sheet: change "Rounds" and "Shortest pause" | labelled steppers in seconds, not raw variable names; values in the file change |
| AT-E12 | (P8e) Programs → Adjust on a local, a shipped and a pod program (also on a read-only pod), change rounds, Try it, Save | a local copy with the same path; the read-only case says the copy stays on this phone; the pod's program is unchanged until a push |
| AT-E13 | (P8e) Turn on expert mode (Settings → Advanced), reload | today's block view, port selects and raw keys are back; the switch is remembered |
| AT-E14 | Language de ↔ en on every new screen | all texts translated |

## U – Usability and platform

| ID | Steps | Expected |
|---|---|---|
| AT-U1 | (once hosted) Phone, airplane mode, open the installed PWA. Before hosting: desktop, `npm run preview`, DevTools offline, reload | app works, local programs, editor and simulator available |
| AT-U2 | Phone (360 px wide): create a 5-block program without drag and drop | possible, nothing cut off |
| AT-U3 | Switch language de ↔ en | all texts translated, no missing keys |
| AT-U4 | iPhone Safari | editor + simulator work, connecting explains that Bluetooth needs the app |
| AT-U5 | Compare the menu pattern of each program in the app (Programs list) with the pod's menu | same LEDs lit at the same positions. The app assumes LED 0 at the top, clockwise; if not, tell the developer the position of LED 0 and the direction |
| AT-U6 | Programs: open every shipped program and the 4 library parts, tap blocks | graphs readable on a phone, block details match the JSON file |

---

## Results

| ID | Date | Device / browser | Firmware | Result | Notes |
|---|---|---|---|---|---|
| AT-S1 | 2026-10-18 | desktop Chrome / Edge, USB | 2.0 | pass | reported by Patrick Stähle |
| AT-S2 | 2026-10-18 | desktop Chrome / Edge, USB | 2.0 | pass | reported by Patrick Stähle |
| AT-S3 | 2026-10-18 | desktop Chrome / Edge, USB | 2.0 | pass | reported by Patrick Stähle |
| AT-S4 | 2026-10-18 | desktop Chrome / Edge, USB | 2.0 | pass | reported by Patrick Stähle |
| AT-B1 … AT-B5 | – | – | 2.0 | blocked | firmware 2.0 lacks CR-0 |
| AT-B1 … AT-B7 | – | – | 2.7 | open | firmware with CR-0 … CR-7 builds, not yet run |
| AT-P1 … AT-P13 | 2026-10-19 | – | 2.7 | accepted | P5 confirmed as implemented by Patrick Stähle |
| AT-M1 … AT-M5 | 2026-10-19 | – | 2.7 | accepted | P6 confirmed as implemented by Patrick Stähle |
| AT-R1 … AT-R6 | – | – | – | open | P7; real pods wait for #41 / #42 |
| AT-E1 … AT-E14 | – | – | – | open | P8 in progress |
