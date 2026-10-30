# Config App – specification

PWA for coaches (not developers), phone in one hand in a sports hall: connect to a set, show and build
programs, simulate them, keep them on the phone, push them to the pods, run training sessions and keep
results. Pod contract: [config-api.md](../firmware/config-api.md); program format and engine:
[programs.md](../firmware/programs.md); styling: [app/DESIGN.md](../../app/DESIGN.md); editor:
[editor-ux.md](editor-ux.md). The platform client is a preview and on hold (ADR 0007).

## 1. Scope

| # | Feature |
|---|---|
| F1 | connect to a central over BLE or USB serial; demo pod without hardware |
| F2 | read `info`, `list`, all program files, the menu |
| F3 | block palette and library (`/prog/lib/*`, read-only) |
| F4–F5 | programs as a step list / block column; editor (editor-ux.md) |
| F6 | live validation (`@reactpod/program-model`, port of `tools/validate_programs.py`) |
| F7 | simulator with all pods, run / pause / step |
| F8 | local programs (IndexedDB, offline), `.json` and set `.zip` import / export |
| F9 | push changed files, update `/programs.json`, validate on the pod |
| F10 | menu editor: order, LED pattern per program |
| F11 | restore the shipped programs |
| F12 | i18n en (primary, fallback) + de |
| F13 | installable offline PWA, mobile first |
| F14 | athletes, sessions, reports, statistics, CSV (§9.5) |
| F15 | training view: live state, `communicate` controls, pause / resume, reconnect (§9.5) |

Not planned: editing library fragments, firmware OTA (ADR 0006), several sets at once (#46, on hold).
Native shell (Capacitor) later; all platform access is behind interfaces (§4).

## 2. Platforms

| Platform | Editor / simulator / store | BLE | USB |
|---|---|---|---|
| Android Chrome (PWA) | yes | yes | – |
| Desktop Chrome / Edge | yes | yes | yes |
| iOS Safari | yes (offline) | no Web Bluetooth (explain: needs the app) | no |
| Native (Capacitor, later) | yes | native | – |

Web Bluetooth / Web Serial need HTTPS or `localhost`. Hosted on GitHub Pages
(https://runningjoke.github.io/reactionButton/), deployed by `.github/workflows/app.yml` on every push to
`main` touching `app/` or `firmware/data/` (also manual: Actions → "Config app (GitHub Pages)").

## 3. Technology

TypeScript strict · React 19 + Vite · BLE `@capacitor-community/bluetooth-le` (Web Bluetooth in the browser,
native in the app) · Web Serial (own adapter) · own column view (HTML + SVG arrows) · Zustand · IndexedDB via
`idb` · `i18next` · `lucide-react` · plain CSS + CSS modules with tokens · `vite-plugin-pwa` · Vitest.
Routing by URL hash (`#/programs`), so the build runs from any path and in a webview. A new version activates
only after the user confirms (update prompt), so an edit in progress is never reloaded away.

## 4. Architecture

Folders: CLAUDE.md "Config App". Layers: UI → `editor/`, `simulator/` (→ program model), `store/` (Storage),
`pod/` (PodClient, sync) → Transport (BLE | Web Serial | simulated pod), `results/`, `platform/`.

```ts
interface Transport {                       // line level
  connect(): Promise<void>;                 // platform device chooser
  disconnect(): Promise<void>;
  send(line: string): Promise<void>;        // one JSON object + "\n", chunked to MTU − 3 (BLE)
  onLine(cb: (line: string) => void): void; // complete lines; non-JSON lines are logs (serial)
  onDisconnect(cb: () => void): void;
  readonly kind: "ble" | "serial" | "simulated";
  readonly mtu?: number;
}
interface PodClient {                       // serialised, id-matched, timeout, resend on "overflow"
  request<T>(op: string, args?: object): Promise<T>;
  info(); list(); getFile(path); putFile(path, text); deleteFile(path); validate(path, data?);
}
interface Storage {                         // swappable later
  listPrograms(); saveProgram(p); deleteProgram(id);
  getMenu(); saveMenu(paths);
  getSyncState(setId); saveSyncState(state); // IndexedDB "meta", key sync:<setId>
}
```

The **simulated pod** (`pod/simulated/SimulatedPod.ts`) implements config-api.md in memory (files,
generation, CRC, chunking, errors, reports, `info.programFormat` and feature switches for older firmware).
Used for development, tests and demos; it must behave like the firmware.

## 5. Screens

Phone: header (title, connection chip, settings gear) + floating tab bar with five tabs; from 900 px a side
rail with all destinations. Icon first, short label.

| Tab | Content |
|---|---|
| **Pod** | set name, id, firmware, free space, generation; file list with sync state; push, restore defaults; *Training* section (athlete, live report, continue / repeat / stop with `reports` / `remote`); link to Menu and the training view. Not connected: Connect |
| **Programs** | local, pod and shipped programs + library; new (chooser), duplicate, Adjust, import, export, set export / import |
| **Editor** | one program (§7, editor-ux.md) |
| **Simulate** | pods + graph + controls (§8) |
| **Results** | athletes on this phone; statistics (counted reports only), sessions → reports → values, discard / count again, CSV (one row per measurement) |
| Menu (from Pod) | order of `/programs.json`, LED ring picker per program |
| Settings (gear) | language, expert mode, platform preview, about, advanced (debug console, delete files §9.4) |

- Touch targets ≥ 44 px, primary action in the thumb zone, every edit works without drag and drop.
- State = colour + icon + text, never colour alone.
- The connection chip is always visible; tapping it opens the connection dialog (Bluetooth / USB / demo pod,
  or the connected pod and Disconnect).
- When BLE fails, explain how to get the central into the menu (hold the button during the boot gauge).

## 6. Local data

```ts
type ProgramDoc = { id: string; path: string /* "/prog/sprint.json" */; json: ProgramJson;
                    origin: "local" | "pod" | "default"; updatedAt: number };
type SyncState  = { setId: string; files: Record<string /*path*/, { crc: string; size: number }> };
```

- No layout on the pod: the column order is computed when a program opens (`model/graph.ts`).
- Path from the name: slug ≤ 20 characters, so `/prog/<slug>.json` ≤ 31; must not collide with a local,
  pod or shipped path.
- Local programs are editable; shipped and pod programs are read-only. **Edit** (and Adjust) makes a local
  copy with the **same path** that replaces the pod file at push; an existing copy opens instead.
  **Duplicate** = new name and path. Library files are never local.
- **One local menu** = the set being built; until changed it shows the pod's menu, else the shipped one.
  Changing the pattern of a non-local program makes a local copy.
- Saved to IndexedDB on every change; undo / redo 100 steps in memory per open program.
- Set `.zip` = `programs.json` + `prog/…` (layout of `firmware/data/`). Export: local menu, its programs with
  includes, every local program. Import: menu + programs (library ignored, one top folder accepted); same
  paths replaced after confirmation.

## 7. Editor

Simple step view, step sheet, wizard, Adjust, expert mode: [editor-ux.md](editor-ux.md). This section is the
block column (expert mode) and the rules both views share.

### 7.1 Block column
- One card per block (icon, type colour, name, type; key parameters on one wrapping line), in flow order from
  `start`: loops ignored, rest topological, first port first, so the main path reads down and a short
  branch sits between its fork and its rejoin.
- One connection to the block directly below = no arrow. Every other connection is an arrow beside the
  column from the port row to the target header: down on the right, loops up on the left; a block with a
  choice shows all ports as arrows; arrows into one target share a lane.
- A card that continues down through a port other than `next` names the port. Unconnected port with `next`
  fallback → "→ next" hint. Start block flagged, ends marked, unreachable blocks dimmed, targets no loaded
  file defines are dashed "external" cards. Tapping selects and highlights its arrows.

### 7.2 Library: presets and templates
| Mode | Effect | Graph |
|---|---|---|
| **Preset** (include kept) | the program links to fragment blocks (`EnterProgram` → `EndLoop`) | fragment blocks greyed with a lock and the file name, no frame |
| **Template** (copy) | blocks and variables copied, clashes get a suffix | editable |

Programs with includes open as presets; "convert to editable copy" flattens. New programs are
self-contained. Push uploads missing preset fragments from the bundled defaults.

### 7.3 Editing
| Action | How |
|---|---|
| add block | + or "add after" → palette grouped Light, Wait, Input, Logic, Remote, Stats, library as copy |
| parameters | tap → sheet (phone) / side panel (desktop) |
| connect a port | per port a "go to" select with all names + "new block…" |
| delete, duplicate, rename, set start | sheet actions (Delete key on desktop) |
| undo / redo | header buttons, Ctrl+Z / Ctrl+Y |

Renaming a block updates every port pointing to it; renaming a variable updates every block using it.
New block: after the selected one (selected → new → old next), else at the end unconnected (first block
of an empty program = start); "new block…" connects that port. Own blocks a preset continues at cannot be
renamed or deleted. A type change keeps the fields and ports the new type has.

### 7.4 Inputs
- *value*: number with a toggle to pick a variable (program variables + `REQUIRED_PERIPHERALS`, `NODE_COUNT`).
- Colours: swatches; fields for peripherals offer only the 8 named colours, central `led.color` also `#RRGGBB`.
- LED indices (`led.leds`, `menu[].leds`): 18-LED ring picker with "all" (also in the menu editor).
  LED 0 at the top, clockwise.
- Metric names: free text with suggestions (default `reaction`).
- Program header: name, description, peripherals 0–7 (the editor prevents more), variables, start, menu
  pattern. No tap target needs drag and drop.

### 7.5 Validation
On every change, `@reactpod/program-model`: known types, required fields, unique names over program +
includes, targets and start exist, colours (named towards peripherals), values are numbers or known
variables, path length, file ≤ 16384 bytes, block types and fields supported by the connected pod
(`info.blockTypes`, `programFormat`). Problems show on the step / card and in the Check sheet (tap selects).
Errors block the push; warnings ("program ends here", unreachable, `rangeReversed`) do not.

## 8. Simulator

`simulator/engine.ts` follows programs.md §7 rule by rule: one pass per simulated ms, 32 steps per pass,
`enter` takes times and random values, fallback to `next`, unknown variables 0, `uint8_t` pod ids,
`timeoutMs: 0` = none for `button` / immediate for remote blocks, 20 ms debounce, seeded random.

- The set always has the program's `peripherals`. Peripherals behave like `PeripheralRole`: armed pods light
  (at once or at `syncStartMs`), a press shows `colorAfter` and reports; presses of earlier activations are
  dropped when polled.
- View: all pods as pucks (central + peripherals, wrapping), tap = press, hold = long press; compact graph
  with the current block and the edge just taken; panels: variables (changes flash), metrics (lit → click),
  log of entered blocks + `RESULT` / `SUMMARY`.
- Controls: run / pause (×0.25 … ×4) · **Step** = until the next block is entered (a block waiting for a
  press stays; pods that light by themselves are lit) · **Skip wait** = jump to the end of a delay / timeout;
  a block without timeout leaves via `timeout` (fallbacks apply), a pressed `button` keeps waiting for the
  release · Reset · Seed · breakpoint on a block · **Copy trace** in the pod's `trace on` format (AT-M5).
- While paused a press or release is handled at once (one step).
- Logic only, no radio timing; reaction times are click times.
- Entry points: Simulate tab (picker: own programs and the menu), play in the editor and the program view.
  Programs with errors are not simulated.

## 9. Pod connection, sync, training

### 9.1 Connect
1. BLE (chooser filtered by service UUID and `ReactPod` prefix) or USB.
2. Subscribe to Response (indications), request MTU 517 (native) / take what the browser gives.
3. `info`: firmware, `linkProtocol`, `blockTypes`, `programFormat`, `features`, limits. BLE writes
   `info.mtu − 3` bytes (fw < 2.7: 20).
4. `status` → role; `list` → files, menu, generation. 5. Changed files are read with chunked `get` (cache).

Optional fields and features: config-api §5 table; a missing one means the old behaviour (e.g. no
`listMeta` → no program names in the file list; `programFormat` newer than the app's `PROGRAM_FORMAT` → warning).

**Writes only go to a central.** A peripheral over USB is read-only (push, restore, delete disabled).
USB: lines not starting with `{` are firmware log (debug console in Settings → Advanced). **Never toggle
DTR/RTS** (resets the ESP32-C3).

### 9.2 Sync state per file
With the remembered last common CRC (`SyncState`):

| Local vs pod | State | Default |
|---|---|---|
| same CRC or equal JSON | in sync | – |
| local changed, pod = last sync | local newer | push |
| pod changed, local = last sync | pod newer | take over |
| both changed / never synced | **conflict** | "keep pod" / "keep mine" (no diff) |
| only local | new | push |
| only on pod | pod only | take over |

### 9.3 Push (`pod/sync.ts`)
1. Validate locally; errors stop. 2. Plan: changed / new programs + missing presets (from the shipped library)
   + menu entries the pod lacks (from the shipped programs), `/programs.json` **last**; the user can deselect;
   conflicts and pod-newer files are skipped and listed. 3. With `validateInline`: dry-run every program on the
   pod before writing any program or the menu (library parts first, the dry run reads includes from the
   store); without it, `validate` after the upload. 4. Upload: ≤ 2048-character chunks at character
   boundaries, UTF-8 byte offsets, CRC on the final chunk; `overflow` → resend; `busy` → stop and explain.
   5. Map pod errors to the block. 6. Save the sync state **after each file** (an interrupted push shows the
   right states; pushing again finishes it). 7. Tell the user to start any program once with all pods on.

- `pinRequired` → the push dialog asks for the PIN (`auth`) before the first write.
- Last common CRC is set after every upload, on "take over" / "keep pod", on "keep mine" (the pod's current
  CRC, so the local file wins), when a local copy is made from a pod program; an untouched copy of a
  shipped program uses the shipped file.
- Menu: a saved local menu that differs from the pod's is pushed unless the pod's changed since the last
  sync (conflict). "Keep pod" for the menu forgets the local menu.
- **Push never deletes.** Unknown pod files stay.

### 9.4 Delete and restore defaults
- Removing a program from the menu leaves the file.
- Deleting files: only Settings → Advanced: select, then a dialog naming the files with a "hold to delete"
  button. Library and `/programs.json` cannot be deleted.
- Restore defaults (Pod tab, confirmation): uploads the shipped programs, library and default menu; user
  programs stay, only leave the menu.

### 9.5 Training, results and reconnect (P7, P9)
- **One set at a time.** Sessions (`pod/session.ts`: transport, PodClient, info, status, list, files, log)
  form a list with one active session (`usePodSessions` / `usePodSession`); `connectPod` ends every existing
  session first. The list stays as the structure for several sets later (#46, on hold).
- **One session model (#87).** Connection state, sync state, training state and the athlete all come from the
  per-set session. The athlete lives in one place: the results store (`useResults.sets[setId].athleteId`),
  pushed to the pod with `session`.
- **Reconnect** (BLE, while the page lives, no chooser): after 1 s, doubling to 30 s; state *Reconnecting*.
  When up: `info`, `status`, `list`, then **`reports` → store → `ack`** (`results/podLink.ts`); `ack` only
  after the durable write. Files from the cache. User disconnect = no retry. Serial and demo pod end on a
  drop. After a reload the set is picked again with one tap; the pod still holds unacknowledged reports.
- **Results** (`results/`, IndexedDB `reactpod-results`): `ReportFeed` stores each `report` event, then
  `ack`s it (no `ack` if storing fails, e.g. IndexedDB blocked → warning). Reports grouped into sessions per
  athlete; *Repeat* marks a report discarded (not in statistics). CSV: `;` (de) / `,` (en).
- **Training view** (`pages/TrainingPage.tsx`, `/training`) is the only screen that controls a game (#87).
  The Pod tab has no game controls; it links to the Training tab. One card:
  - set name, state (`status.state` or connecting / reconnecting / not connected), *Waiting for you* while
    `communicate` waits; athlete (store value); last report with link to the session.
  - **Start** (#87): in CONFIRM (`status.state` `CONFIRM`, READY on the ring) the program's editable variables from
    `status.ready.editable` (same shape as `status.waiting.editable`) as steppers, and **Start**. Start sends
    `setVariables` (only if changed), then `start`. The app never sends `select`: the program is picked on the pod.
  - **Waiting:** **Continue / Repeat / Stop** (`command`) and one stepper per `status.waiting.editable`
    variable (`setVariables`, range checked before sending). **Pause / Resume** in RUN or during a phone pause.
    Disconnect.
  - **Queue (#87):** Continue / Repeat / Stop pressed while no communicate block waits are held by the app as
    one pending command (a newer press replaces it). The card shows *Queued: Continue* with *Cancel*. It is
    sent as soon as `status.waiting` appears (`state` / `report` event or status read). Pause / Resume are
    sent at once (firmware accepts them in RUN / phone-paused PAUSED).
  - `status` is re-read on `state` / `report` events and after each command.
- **Priority and errors (#87):** user commands (`command`, `setVariables`, `start`, `pause`, `resume`,
  `session`) go ahead of queued report fetches, acks and status reads (`pod/client.ts`: a priority lane, still
  one request in flight). A timed-out user command is never shown as failed: it may have been applied. The app
  re-reads `status` and shows the real state. Only a definite error response is shown as an error, with its
  text from `en.json` / `de.json` (every firmware error code has one).
- **Feature detection:** no `reports` → the card says the firmware sends no results; no `remote` → no
  commands; no `pause` → no pause button; no `liveBle` → note that Bluetooth goes off during a game.
  No `startVars` (#87) → no start inputs; *Start* only if the `start` op is available (`remote`), else the
  text "Press the central to start".
- **Firmware (#87, fw-request #96):** `setVariables` in CONFIRM limited to variables marked
  `editable` in the program's communicate blocks; `status.ready.editable`; feature `startVars`; fix of the
  sticky MaxLoop characteristic. A missing field means the old behaviour.
- **Wake lock** while the view is open (`navigator.wakeLock`; absent or refused → nothing). Known PWA limit:
  the screen can still lock; a hidden tab or sleeping phone drops BLE; reports wait on the pod.
- **Demo pod:** each connection gets its own set: `5f3a91c2` (no name), `9b2e7d40` "Halle 2", `c71f0a8e`
  "Halle 3", `3e6d9b15` "Halle 4". "Demo: send a report" emits a sample report; while it waits the game is in
  RUN; `stop` → MENU. It implements the #87 firmware (`startVars`, `status.ready.editable`, `setVariables` in
  CONFIRM) as soon as that is specified in config-api.md.

### 9.6 Measurement (#87)

Items 1 and 2 are built in the step editor (#88, Sprinkles: Record reaction, Stopwatch, Report to phone; `editor-ux.md` §4 D); item 3 and the training view are not. Config App only: no firmware, program format, validator or schema change. Every field
below already exists (timers since program format 2, `communicate` since 5, the summary bar since 6;
`programs.md` §6), so the editor follows the existing `programFormat` gating.

**1. What is recorded (per step)**
Two behaviours (#88). Specified here once; `editor-ux.md` refers to this section.

| Behaviour | Field | Blocks | Metric name |
|---|---|---|---|
| Record reaction | `record: "<metric>"` | button, remotePress, remoteMultiPress, charge, release | the metric (default `reaction`) |
| Stopwatch | `timerStart` / `timerStop: "<name>"` | all 15 | the timer name |

- Stopwatch, plain path: "start here" and "stop here" on the step. The name is suggested from the
  program: `cycle`, `lap`, or a new name.
- Max 16 timer names per program.

**2. Report to phone (`communicate`)**
- Fields: `metrics` (empty = all), `vars`, `editable` (`{ name: { min, max } }`), `timeoutMs` (0 = none), `color`.
- When: each time the flow reaches a `communicate` block. Shipped programs: once per cycle
  (`lib/loop.json`, block `Report`, after `Summary`).
- Settings "Report to phone", as plain choices:
  - Results: checkboxes of the metrics the program records. "All" is the default (`metrics: []`).
  - Settings to include: checkboxes of the program's variables (`vars`).
  - Coach may change while it waits: checkboxes of variables, each with min and max (`editable`).
  - Time-out: none, or seconds (`timeoutMs`).
- Raw lists stay in expert mode.

**3. Athlete's view**
- On the ring: `summary` with `show`, `targetMs`, `showMs`. Behaviour *Show average bar* (#88).
- On the phone: the training card (§9.5) gets a large-number view of the last value and the average of
  the main metric, readable from 2 m, toggled on the card. Main metric: `reaction` by default, else the
  first recorded metric.

**4. Limits** (checked against the code)

| Limit | Value | Source |
|---|---|---|
| Timer names per program | 16 | `MAX_TIMERS` (`BlockManager.h`, `blockTypes.ts`) |
| `communicate` lists (`metrics`, `vars`, `editable`) | 8 items | `MAX_LIST_ITEMS` (`blockTypes.ts`) |
| Metric and variable names | 32 characters | `MAX_NAME_CHARS` (`blockTypes.ts`), `Reports.h` `MAX_NAME` |
| Reports buffered on the pod | 8 | `Reports.h` `MAX_REPORTS` |
| Values per report period | 48 | `Reports.h` `LOG_SIZE`; further values are counted, not kept |
| Metric names per report period | 16 | `Reports.h` `MAX_METRICS` |

**5. Open points**
- Can the user choose the main metric of the phone view? Default `reaction`.
- Should "Report to phone" add a `communicate` block to a program that has none? Without one the phone gets no report.

### 9.7 Platform client (preview, on hold – keep working, do not extend)
- Upload (`platform/upload.ts`): reports the platform lacks, per session, `POST /training/upload`, by the
  auto-upload setting or *Upload now*; idempotent by the app's ids.
- Queued deletions (`PlatformDelete[]`, IndexedDB) run when online and signed in: after sign-in, at app start,
  when queued, when the connection returns; independent of auto-upload; kept while unreachable, 404 = done.
- Deleting a linked athlete on the phone (`results/athleteDeletion.ts`) removes it with sessions and reports;
  the platform gets the self-delete `DELETE /v1/orgs/{orgId}/me/athletes/{id}` if the user claimed it
  (`claimedAthleteIds` from `/v1/me`), else the coach delete `DELETE /v1/orgs/{orgId}/athletes/{id}` (403 →
  self-delete). Its queued uploads are dropped.
- Tombstones (`deletedAthletes`): later reports for that athlete are `ack`ed but not stored or uploaded.
  If it is the athlete set on a connected pod with `remote`, the app sends `session {athlete: ""}`.

## 10. i18n and accessibility
All UI text in `src/i18n/{en,de}.json`; English primary and fallback; language from the browser, switchable.
Block type and field names stay technical in expert mode, each with a translated label and help. Contrast
AA, visible focus, every icon button labelled.

## 11. Known risks
| Risk | Mitigation |
|---|---|
| Web Serial open toggles DTR/RTS → reset | never toggle; AT-S1 passed |
| simulator drifts from the firmware | engine tests on the shipped programs; AT-M5 trace comparison; change both sides together |
| small browser MTU (23) | chunking works with any MTU; progress shown |
| two pods edited separately → one store lost | show set id + generation; hint after push |

## 12. Decisions
| Topic | Decision |
|---|---|
| node positions | none; computed column order |
| hosting | GitHub Pages from `main`; own domain later |
| long press in the simulator | press and hold = held button, `shortMs` decides |
| peripherals | the editor prevents more than 7 |
| write target | only a central |
| library | read-only, preset (include) or template (copy) |
| block definitions | the app's own copy in `@reactpod/program-model`, mirrored from the firmware by `/fw-api-change` |
| push | update only, never delete unless the user asks |
| conflicts | "keep pod" / "keep mine" |
| editing a shipped / pod program | local copy, same path, replaces at push |
| menu before a push exists | one local menu from the pod's (or shipped) menu |
| new block position | after the selected block, else at the end unconnected |

## 13. Phases
The user approves each phase; acceptance tests: [acceptance-tests.md](acceptance-tests.md).

| Phase | Content | Status |
|---|---|---|
| P0 | scaffold, PWA, i18n, theme, navigation | done |
| P1 | model, validation, simulated pod, PodClient, file transfer | done |
| P2 | transports Web Serial, BLE | done (AT-S*, AT-B* pass) |
| P3 | programs list, graph view, library | done |
| P4 | editor, menu editor, LED ring picker | done |
| P5 | sync, push, validate, restore defaults | done (accepted 2026-10-19) |
| P6 | simulator | done (accepted 2026-10-19) |
| P7 | athletes, results, platform upload (#47, #48) | done (AT-R* 2026-10-26) |
| P8 | block builder for first-timers (editor-ux.md) | done (AT-E* 2026-10-26) |
| P9 | training view, reconnect, wake lock (#46); several sets on hold | ready for test (AT-L*) |

## 14. Commands
`npm run dev` · `npm test` · `npm run build` · `npm run preview` · `npm run icons` (redraws `public/icons/`
from `scripts/make-icons.mjs`) · `node scripts/screenshots.mjs <dir>` · `node scripts/offline-check.mjs`
(AT-U1, preview build offline).
