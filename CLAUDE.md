# ReactPod – guide for agents

ESP32-C3 reaction buzzers (18-LED ring, one button). A **set** = one **central** (runs the game program,
configured over BLE or USB) + up to 7 **peripherals** (ESP-NOW). Firmware, app and tools are versioned
together; one branch may touch all of them. User guides and the full history of every doc: [wiki](https://github.com/RunningJoke/reactionButton/wiki).

## Map – read the spec before changing a part

| Folder | What | Spec |
|---|---|---|
| `firmware/` | PlatformIO, `arduino, espidf`; programs in `firmware/data/` (SPIFFS) | [architecture](docs/firmware/architecture.md), [programs](docs/firmware/programs.md) (§6 format revisions, §7 engine), [config-api](docs/firmware/config-api.md), [link-protocol](docs/firmware/link-protocol.md), [timing](docs/firmware/timing.md), [testing](docs/firmware/testing.md) |
| `app/` | React + TS PWA on Pages: https://runningjoke.github.io/reactionButton/ | [spec](docs/app/spec.md) (§13 phases), [editor](docs/app/editor-ux.md), [acceptance tests](docs/app/acceptance-tests.md), [design](app/DESIGN.md) |
| `tools/` | `reactpod_config.py` (BLE), `reactpod_serial.py` (USB), `reactpod_hwtest.py`, `validate_programs.py`, `fw_syntax_check/` | config-api, testing |
| `packages/program-model/` | Program types, block definitions, limits, validator – shared by app and platform | programs |
| `platform/` | Community platform (Hono + Postgres), **on hold** (ADR 0007) | [spec](docs/platform/spec.md), [deploy](platform/deploy/README.md) |
| `spec/` | Generated, checked in: `platform-api.yaml` (`cd platform && npm run openapi`), `program.schema.json` (`cd packages/program-model && npm run schema`) | – |
| `hardware/` | KiCad PCB, FreeCAD casing | – |
| `docs/decisions/` | [ADRs](docs/decisions/README.md): repo layout, versions, platform, live BLE (0005), no OTA (0006), platform on hold (0007) | – |

## Commands (repo root; pio is in `~/.platformio/penv/Scripts/`)

```sh
pio run -d firmware -e NewBoard                                  # build (≈4 min clean); firmware.bin ≈ 68 % of the 2 MB app slot (-Os)
pio run -d firmware -e NewBoard -t upload   --upload-port COM4   # then often RESET by hand: reactpod_serial.py wait-boot
pio run -d firmware -e NewBoard -t uploadfs --upload-port COM4   # programs (not in the firmware image)
python3 tools/fw_syntax_check/check.py                           # host g++ syntax check of firmware/src in seconds
python tools/validate_programs.py
python tools/reactpod_serial.py --port COM4 monitor              # log + JSON API over USB
cd app && npm test && npx tsc                                    # before every app commit
cd packages/program-model && npm test && npx tsc && npm run schema:check   # then also app + platform tests
cd platform && npm test && npx tsc && npm run openapi:check       # before every platform commit
```

CI (`.github/workflows/`) runs only the app (`app.yml`) and firmware (`firmware.yml`, `release-firmware.yml`)
checks. Program-model and platform tests run **only locally**: run them whenever `packages/` or `platform/` changes.

## Flows

- **Work:** issue (form; one `type:` bug|feature|fw-request|chore, ≥ 1 `area:` firmware|app|tools|hardware|docs|platform,
  optional `status:` needs-decision|blocked|on-hold; milestone per app phase / firmware release) → branch
  `feat|fix|chore|docs/<topic>` from `main` → PR with "Closes #n" and the checklist → CI green →
  `gh pr merge <n> --squash` (title = changelog line). Commit and push only when the user asks.
  Stacked branches: PR against the parent branch, retarget after it is merged.
- **Firmware API or block semantics change:** skill `/fw-api-change`. The docs are the contract.
- **The app needs a firmware change:** skill `/fw-request`. The app must work without it: check `info`,
  a missing field means the old behaviour.
- **Bug in the other part:** open an issue (`type: bug`); fix it only if the user asks.
- **Release:** skill `/release`.
- **App phases** (spec §13): the user approves each phase. Mark acceptance tests "pass" only when the
  user reported them as passed.

| Part | Version lives in | Tag | Release |
|---|---|---|---|
| Firmware | `FW_VERSION_MAJOR/MINOR` in `firmware/src/_Definitions.h` (= `info.firmware`) | `fw-vX.Y.Z` | GitHub release with binaries, also on Pages `/firmware/`. Flashed over USB only (ADR 0006) |
| Program format | `PROGRAM_FORMAT` in `BlockFactory.h`, `validate_programs.py`, `program-model/src/limits.ts` | – | programs.md §6 |
| App | `version` in `app/package.json` | `app-vX.Y.Z` | every merge to `main` touching `app/` or `firmware/data/` deploys Pages (`.github/workflows/app.yml`) |
| Platform | `version` in `platform/package.json` | `platform-vX.Y.Z` | planned: image `ghcr.io/runningjoke/reactpod-platform`, staging deploy (no workflow in the repo yet) |
| Hardware | – | `hw-revN` | – |

## Rules

- **Platform development is halted** (ADR 0007). Do not design new app or firmware content for it: no
  platform fields, upload steps or account concepts "for later". Existing platform code, its API contract,
  the app's platform client and the protocols stay and keep working (do not remove them; keep the platform
  tests green). Platform issues are `status: on-hold`.
- The app follows **one set at a time**. Several sets at once (#46) are on hold.
- Firmware 2.x is incompatible with 1.x (BLE); flash all pods of a set.

## Config App (`app/`)

`npm run dev` (http://localhost:5173), `npm test` (Vitest), `npx tsc`, `npm run build` (→ `dist/`),
`npm run preview` (http://localhost:4173). Layout of `app/src/`:

| Folder | Content |
|---|---|
| `pod/` | `transport/` (BLE via @capacitor-community/bluetooth-le, Web Serial), `simulated/` (demo pod = config-api.md in memory), `client.ts` (one request at a time, ids, timeouts, `overflow` retry), `files.ts` (chunked get / put), `session.ts` (connection state), `sync.ts` + `syncActions.ts` (sync states, push, restore defaults) |
| `model/` | `graph.ts` (column order) + tests. Types, block definitions, validation, formatting, limits: `@reactpod/program-model` (`file:` dependency) |
| `simulator/` | `engine.ts`: the firmware block engine in TS (programs.md §7), seeded random, real-time hook |
| `editor/` | step list / column view, editing operations, undo / redo, step sheet, inspector |
| `store/` | IndexedDB: local programs, menu, sync state per set, file cache |
| `results/` | athletes, sessions, reports (`report` → store → `ack`), statistics, CSV |
| `programs/` | catalog, sources (pod / shipped / local), program actions, set .zip import / export |
| `pages/` | one component per tab |
| `platform/` | platform client (preview, on hold) |
| `defaults/` | shipped programs, bundled from `../firmware/data` at build time |
| `i18n/` | `en.json` (primary, fallback) and `de.json`. Every UI text in both; a test checks keys and placeholders |

- Mobile first: touch targets ≥ 44 px, every action works without drag and drop, nothing cut off at 360 px.
- Styling: read [app/DESIGN.md](app/DESIGN.md) first; theme tokens in `src/app/theme.css` for every colour, both themes.
- The demo pod and the simulator must behave like the firmware. Change one side → change the other.
- Check a UI change in a real browser: `npm run build`, `npm run preview`, `node scripts/screenshots.mjs <dir>`
  (playwright-core, local Chrome) at 360 px and 1200 px, both themes. Look at the screenshots.

## Platform (`platform/`, on hold)

`npm run dev` (http://localhost:8787: `/v1/meta`, `/v1/openapi.json`, `/mcp`; embedded PGlite in `.data/dev`,
sign-in codes in the log; real Postgres: `docker compose -f compose.dev.yaml up -d` and
`DATABASE_URL=postgres://reactpod:reactpod@localhost:5432/reactpod`), `npm test`, `npx tsc`,
`npm run openapi` (after changing a use case; CI checks it), `npm run build` (esbuild → `dist/main.js`).

- A feature is a **use case** (`src/modules/<module>/useCases.ts`, `defineUseCase`) in `src/core/registry.ts`.
  REST routes and MCP tools are generated, never hand-written.
- Use cases reach the outside only through `ctx.ports` (`src/core/ports.ts`).
- `agent`: `deny` for anything an AI client must not do, `draft` for writes.
- Tables per module in `schema.ts` (exported in `src/db/schema.ts`); after a change `npm run db:generate`
  and commit the migration. Merged migrations are never edited.
- Rights: `requireMember(tx, ctx, orgId, minRole)` (`modules/orgs/policies.ts`); non-members get 404.
  Every write calls `recordAudit` (ids only, no names or e-mails).
- Tests run on PGlite (`test/helpers.ts` → `testEnv()`: fresh database, captured mails, controllable clock).

## Environment

- Windows, Git Bash and PowerShell. Git Bash: prefix commands with pod paths (`/prog/…`) with
  `MSYS_NO_PATHCONV=1`. `core.autocrlf` is on (working copy CRLF, repo LF); LF warnings on `git add` are fine.
- `firmware/data/` goes to the pods from the CRLF working copy, Pages bundles LF. The app compares programs
  by JSON content, so only CRCs differ (restore defaults may re-upload shipped files).
- `gh` is logged in for `RunningJoke/reactionButton`.


## graphify
- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.