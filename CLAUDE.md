# ReactPod – guide for agents

ReactPods are reaction buzzers: an ESP32-C3 pod with an 18-LED ring and one big button.
Several pods form a **set**. One pod is the **central** (runs the game program), the others
are **peripherals**. The central is configured over BLE or USB serial.

The repository has three parts. They are versioned together, so a change can touch both
firmware and app in one branch.

| Part | Where | What |
|---|---|---|
| Firmware | `src/`, `platformio.ini`, `data/` | PlatformIO, `framework = arduino, espidf`. Game programs are JSON files in `data/` (SPIFFS) |
| Config App | `configApp/` | React + TypeScript PWA to build, simulate and upload programs. Published on GitHub Pages: https://runningjoke.github.io/reactionButton/ |
| Tools | `tools/` | Python reference clients: `reactpod_config.py` (BLE), `reactpod_serial.py` (USB), `validate_programs.py` |

The documentation is the spec. Read the relevant file before you change anything:

| Topic | File |
|---|---|
| Firmware overview, modules, boot, state machines | [doc/README.md](doc/README.md), [doc/architecture.md](doc/architecture.md) |
| Program JSON format, block types, **engine semantics (§7)**, format revisions (§6) | [doc/programs.md](doc/programs.md) |
| Configuration API (BLE + USB serial), the contract between firmware and app | [doc/config-api.md](doc/config-api.md) |
| Pod-to-pod link (ESP-NOW), store sync | [doc/link-protocol.md](doc/link-protocol.md) |
| Flashing and testing over USB | [doc/testing.md](doc/testing.md) |
| Config App spec, phases, decisions, risks | [configApp/README.md](configApp/README.md) |
| App acceptance tests on real pods, and their results | [configApp/docs/acceptance-tests.md](configApp/docs/acceptance-tests.md) |

## Workflow

- **Branches and PRs.** Work on `feature/<topic>` branches and open a PR to `main`. Merge PRs with
  merge commits (`gh pr merge <n> --merge`). When a phase builds on an unmerged branch, stack
  the PR on that branch, then retarget it to `main` after the first PR is merged.
- **App phases** (P0 … P6 in configApp/README.md §13). The user approves a phase before the next
  one starts. Record the status in the phase table, and acceptance results in
  acceptance-tests.md. Write "pass" there only for tests the user reported as passed.
- **Firmware changes the app needs** are requested as **GitHub issues** with the label
  `firmware`. Write what is missing, why the app needs it, a proposed API and the acceptance
  test. The app must keep working without the change: check `info`, and treat a missing field
  as the old behaviour. `doc/changerequest/` is an archive (CR-0 … CR-7, all done); do not add
  requests there.
- **Bugs you find** in the other part: open an issue (label `bug`) instead of fixing them on
  the side, unless the user asks for the fix.
- **Commits** end with the attribution line from the session instructions. Commit and push only
  when the user asks.

### When you change the firmware API or block semantics

1. Update [doc/config-api.md](doc/config-api.md) and/or [doc/programs.md](doc/programs.md).
2. Bump `FW_VERSION_MINOR` in `src/_Definitions.h` (reported as `info.firmware`).
3. For new block fields, ports or semantics: increase `BlockFactory::PROGRAM_FORMAT`
   (`src/Block/BlockFactory/BlockFactory.h`) **and** `PROGRAM_FORMAT` in
   `tools/validate_programs.py`, and add a row to programs.md §6.
4. Report a new optional feature in `info.features`, so clients can detect it.
5. Update the reference clients in `tools/` if they are affected.
6. Mirror the change in the app: `configApp/src/pod/protocol.ts` (types),
   `src/pod/simulated/SimulatedPod.ts` (demo pod = firmware behaviour),
   `src/model/blockTypes.ts` + `src/model/validate.ts` (block types), `src/simulator/engine.ts`
   (semantics), and `PROGRAM_FORMAT` in `src/model/limits.ts`.

## Firmware

```sh
pio run -e NewBoard                         # build (≈ 4 min clean); pio is in ~/.platformio/penv/Scripts/
pio run -e NewBoard -t upload --upload-port COM4     # flash
pio run -e NewBoard -t uploadfs --upload-port COM4   # write data/ (programs) to SPIFFS
python tools/validate_programs.py           # check data/
python tools/reactpod_serial.py --port COM4 monitor  # log + JSON API over USB
```

Modules in `src/`:

| Folder | Role |
|---|---|
| `Roles/` | `RoleManager`, `Central/CentralRole` (menu → discovery → confirm → run), `Central/PhoneConfig` (BLE GATT server, menu only), `Central/PodNetwork`, `Peripheral/PeripheralRole` |
| `BlockManager/`, `Block/*` | Block engine: loads a program with its includes, runs ≤ 32 blocks per loop pass. One folder per block type; register new types in `Block/BlockFactory` |
| `Config/` | `ConfigApi` (JSON request handler, shared by BLE and USB), `SerialConsole`, `Console` (own HWCDC object) |
| `Store/` | `ProgramStore` (SPIFFS files, generation, CRC, list metadata cache), `StoreSync` (pod-to-pod sync) |
| `Link/` | ESP-NOW link, protocol frames, clock sync |
| `Settings/` | NVS: set id, set name, PIN, boot role |
| `Results/`, `VariableManager/`, `LEDManager/`, `Input/`, `Diagnostics/`, `Program/` | measurements, variables, LEDs and animations, button, reset diagnostics, menu catalog |

Notes:
- Do not set `ARDUINO_USB_CDC_ON_BOOT` / `ARDUINO_USB_MODE` in `platformio.ini` (see the comment there).
- Over USB, do not toggle DTR/RTS: it resets the ESP32-C3, possibly into download mode.
- Flash is about 80 % full. Check the size line of the build output after adding code.

## Config App

```sh
cd configApp
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest unit tests (run before every commit)
npx tsc            # type check (npm run build does it too)
npm run build      # production build → dist/
npm run preview    # serve dist/ on http://localhost:4173
```

Layout of `configApp/src/`:

| Folder | Content |
|---|---|
| `pod/` | Everything about talking to a pod: `transport/` (BLE via @capacitor-community/bluetooth-le, Web Serial), `simulated/` (demo pod, implements config-api.md in memory), `client.ts` (one request at a time, ids, timeouts, `overflow` retry), `files.ts` (chunked get / put), `session.ts` (connection state for the UI), `sync.ts` + `syncActions.ts` (sync states, push, restore defaults) |
| `model/` | Program format: block type definitions, validation (port of `tools/validate_programs.py`), graph, formatting, limits |
| `simulator/` | `engine.ts`: the firmware block engine ported to TS (follows programs.md §7), seeded random, real-time hook |
| `editor/` | Column view of the block graph, editing operations, undo / redo, inspector |
| `store/` | IndexedDB storage (local programs, menu, sync state per set), file cache |
| `programs/` | Catalog, sources (pod / shipped / local), program actions, set .zip import / export |
| `pages/` | One component per tab: Pod, Programs, program view, Editor, Simulate, Menu, Settings |
| `defaults/` | The shipped programs, bundled from `../data` at build time |
| `i18n/` | `en.json` (primary) and `de.json`. Every UI text goes into both files; a test checks that the keys and placeholders match |

Rules:
- Mobile first: touch targets ≥ 44 px, every action works without drag and drop, nothing cut off at 360 px.
- Theme tokens in `src/app/theme.css`. Use them for colours, also in the dark theme.
- The demo pod and the simulator must behave like the firmware. When you change one side, change the other.
- Check a UI change in a real browser: `npm run build`, `npm run preview`, then a playwright-core
  script with the local Chrome (`scripts/screenshots.mjs` shows how). Look at the screenshots.
- Deployment: every push to `main` that touches `configApp/` or `data/` runs
  `.github/workflows/config-app-pages.yml` (test, build, publish on GitHub Pages).

## Environment

- Windows with Git Bash and PowerShell. `git` has `core.autocrlf` on: the working copy has CRLF,
  the repository LF. Files written by tools with LF show a warning on `git add`; that is fine.
- `data/` is uploaded to the pods from the Windows working copy (CRLF), while the Pages build
  bundles the LF files. The app compares programs by JSON content, so this only affects CRCs
  (for example, "restore defaults" re-uploads shipped files whose line endings differ).
- `gh` is logged in for `RunningJoke/reactionButton`.
