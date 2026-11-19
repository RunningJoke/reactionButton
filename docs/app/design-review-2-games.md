# Design review 2 – designing games (#147)

Review of 2026-11-19 on `main` (752e33c), preview build, demo pod. 360 px (light, dark) and 1200 px.
Scope: everything a coach touches to **create, change and try a game**: the new-game chooser, Quick game, the
five-step guided path, Start empty, the game page (About · Edit · Try), Game settings, the editor (step list, step
sheets, add-step sheet, sprinkles, exit picker) and the games list. Training, results, This set and onboarding
(#146) are out of scope.

Severity: **H** blocks or misleads a first-time coach · **M** costs taps, decisions or confidence · **L** polish.

## Findings

### A. Starting a new game

| # | Sev | Finding | Proposal |
|---|---|---|---|
| A1 | H | The chooser offers "Start from a game" (the five-question path) next to "Copy one of my games". Both read as "start from a game", so the coach can't tell which one builds a new game from answers. | Rename by outcome: "Answer a few questions" (guided), "Quick game", "Copy a game", "Start empty". |
| A2 | M | Four doors to the same goal. Quick game and the guided path ask the same things (game type, pods, rounds, colour), but in different layouts: a select box versus picture cards. | Merge the two: Quick game is the guided path's first screen, and "More options" continues into steps 3–5. One way of picking the game type, with picture cards. |
| A3 | M | Quick game picks the game type from a native `<select>`, without the pictures and pod requirements the guided path shows. | Use the guided path's game cards (compact, one line each). |
| A4 | M | Pod count is always asked, even when a set is connected and the app knows it. | When connected, preset the count from the connected set and say "from your set". Keep the stepper. |
| A5 | M | Guided step 5: "Count misses – Turn on a time limit first." is disabled, and the time limit is two steps back. | Turning on "Count misses" turns on a time limit with a default and says so inline, or the step offers "Add a time limit". |
| A6 | M | "Your game is ready" leads with a name field and the **menu pattern** (LED numbers 0–17, "uses 10 % of the space for one game"). The story comes third. | Order: story ("What happens") → Try / Save. The menu pattern moves to Game settings (it is only the pod-menu icon). Drop the storage percentage, or show it only when space is short. |
| A7 | L | 7 colours wrap at 360 px, leaving white alone on a second row (guided step 4, Quick game, step sheets). | Size the swatches so that 7 fit on one row at 360 px (≥ 44 px targets still fit: 7 × 44 + gaps < 328). |
| A8 | L | Start empty asks for a name in a small sheet over the dimmed games list, with small Back / Create buttons. | Full-width primary button. A default name ("My game 3") so Create works at once. |
| A9 | L | "Create and adjust" wraps onto two lines at 360 px. | Shorter label ("Create, then adjust"), or stack the two buttons. |

### B. Game page and Game settings

| # | Sev | Finding | Proposal |
|---|---|---|---|
| B1 | H | A game from Quick game shows a one-line "What happens" (the type's tagline), while the same game from the guided path shows the full numbered story. The coach can't see what the game they just made does. | Always generate the step story from the program (the same generator for every source), and show the tagline above it. |
| B2 | M | Pods are counted two ways on one screen: the subtitle says "Main pod + 3 pods", the settings row says "Pods 4". | One way everywhere: "Main pod + 3 pods". |
| B3 | M | Numbers are formatted differently: the wizard shows "0.5 s", the settings list "0.50 s", the editor "0.8–5 s". | One unit rule (as Q3b in #106): shortest form, at most 2 decimals, no trailing zeros. |
| B4 | M | Try at 360 px: the Run bar sits below the fold, under an empty "Details" card. The coach sees the pods but not how to start. | Keep the run bar sticky above the tab bar (as R4 did on desktop). Collapse Details while it is empty. |
| B5 | L | Shipped games: "No. 9 on the pods" sits between the settings and the buttons and means nothing to a coach. | Move it into This set / the pod menu, or phrase it as "9th in the pod menu". |

### C. Editor – step list

| # | Sev | Finding | Proposal |
|---|---|---|---|
| C1 | H | Every game starts with a locked step 1, "Go on right away", a technical start block that the coach can neither change nor understand. | Hide locked structural steps from the list (show them only in expert mode), and number from the first real step. |
| C2 | M | "Add 1 to Misses" appears as its own nested step under "If too slow · Count a miss", so the same thing is said twice. | Fold the counter into the exit line ("If too slow → count a miss") and hide the child step unless it was changed. |
| C3 | M | Header: "15 steps", a lone check icon and ⋮. The check (valid) is not explained, and the step count is not useful. | Replace with a status line: "Ready to send" / "1 problem: …" (tappable). Drop the step count. |
| C4 | M | The add-step and step sheets cover the lower half and leave an empty gap above, so the step being edited can scroll out of view. | Scroll the selected step into view above the sheet. Sheets anchor at the content height. |
| C5 | L | The `☰ 1` / `☰ 2` badge on steps (number of sprinkles) is unexplained. | Show the sprinkle names as small text ("records time · time limit"), or drop the badge, since the sentence already says it. |

### D. Editor – step sheets, sprinkles, add step

| # | Sev | Finding | Proposal |
|---|---|---|---|
| D1 | H | The press sheet shows raw internals: "Record reaction · reaction · Remove", "Keep result · LAST_REACTION". | Plain words: "Reaction time is recorded", "Shows as: Last reaction time" (settingLabels already has them). Show variable names only in expert mode. |
| D2 | M | "Sprinkles" is jargon (EN and DE). The sheet also has a separate "Try + Time limit + Stopwatch" row next to "+ Add sprinkle", so there are two ways to add the same thing. | Rename to "Extras" / "Extras". One "Add" list with the common ones first. |
| D3 | M | Add a step: disabled cards ("Light a pod", "Race: all pods at once") carry long orange warnings ("The game uses no pods. Set the number of pods in the game settings."). | One short reason plus a button "Use pods…" that opens Game settings at the pod count. Or hide them under "Needs pods (2)". |
| D4 | M | Exit picker ("If too slow → a step…") lists every step, including the step itself and steps that make no sense (a jump back into a false-start branch). | List only reachable targets, mark "start of the round" / "end of the game" as named targets, and leave out the step itself. |
| D5 | L | Add-step cards have coloured top stripes (Light orange, Pod blue), the stripe pattern that #106 Q5 replaced with icon tiles in the list. | Icon tiles as in the step list. |

### E. Games list

| # | Sev | Finding | Proposal |
|---|---|---|---|
| E1 | M | Most shipped games have no description (Weiche, Dreieck, Quadrat, Stern … only "Main pod + 2 pods"), and their names are German in the English UI. | A one-line description for every shipped game (en + de, the per-program game texts from P10). English display names in en. |
| E2 | M | The "My games" header holds three file buttons (Import, Export set, Import set), which are more prominent than the + for a new game. On desktop, + sits under the offline toast. | Move the file actions into one "⋯" menu. Make "New game" a visible button in the My games header (keep the FAB on phone). |
| E3 | L | On a phone, two back arrows show at the same time in the wizard result and the game page (app header ← and the screen's own ←/×). | One back control per screen. |

## Proposed order

1. **Quick wins:** A1, A7, A9, B2, B3, B5, C5, D1, D2 (wording), E3.
2. **Editor clarity:** C1, C2, C3, C4, D3, D4, D5.
3. **New game, one path:** A2–A6, A8, B1, B4.
4. **Games list:** E1, E2.

Each step on an integration branch with acceptance tests AT-D31… in acceptance-tests.md. No step changes block
semantics or the program format; C1 and C2 only change the display (the firmware program stays the same), so
`/fw-api-change` is not needed. If a decision changes that, the change goes through it, and the simulator and the demo pod follow.

## Decisions (2026-11-19)

- **A2:** merge. Quick game becomes the first screen of the one new-game flow, and "More options" continues with rounds and
  timing, colours and measure. One way to pick the game type (picture cards).
- **C1 / C2:** move both into Extras instead of showing them as steps:
  - "Go on right away" is `StartCycle` from `prog/lib/loop.json` (0 s, starts the `cycle` timer). It becomes an
    Extra on the "Repeat N rounds" group: "Measures the game time".
  - "Add 1 to Misses" is the miss-counter helper that the "If too slow → Count a miss" switch already owns
    (`switches.ts`). It is shown only inside the time-limit Extra, not as step 4.1.
  - Display only: the program file and the firmware stay the same. Expert mode still shows the raw blocks.
- **D2:** "Sprinkles" → **Extras** (en) / **Extras** (de).
- **E1:** keep the German names of the shipped games (brand names). Every shipped game still gets a one-line
  description in en + de.
