# ReactPod – guide for agents

ESP32-C3 reaction buzzers (18-LED ring, one button). A **set** = one **central** (runs the
game program, configured over BLE or USB) + **peripherals** (ESP-NOW). Firmware, app and tools
are versioned together; one branch may touch all of them. Overview: [README.md](README.md),
workflow details: [CONTRIBUTING.md](CONTRIBUTING.md).

## Map – read the spec before changing a part

| Folder | What | Spec |
|---|---|---|
| `firmware/` | PlatformIO, `arduino, espidf`; programs in `firmware/data/` (SPIFFS) | [architecture](docs/firmware/architecture.md), [programs](docs/firmware/programs.md) (§6 format revisions, §7 engine), [config-api](docs/firmware/config-api.md), [link-protocol](docs/firmware/link-protocol.md), [testing](docs/firmware/testing.md) |
| `app/` | React + TS PWA on Pages: https://runningjoke.github.io/reactionButton/ | [spec](docs/app/spec.md) (§4 layout, §13 phases), [acceptance tests](docs/app/acceptance-tests.md), [editor UX proposal](docs/app/editor-ux.md) |
| `tools/` | `reactpod_config.py` (BLE), `reactpod_serial.py` (USB), `validate_programs.py` | config-api |
| `hardware/` | KiCad PCB, FreeCAD casing | – |
| `platform/` | Community platform (Hono + Postgres): accounts, clubs, sharing, results; REST + MCP from one use-case list | [spec](docs/platform/spec.md) (§5 architecture, §7 AI clients, §14 phases), [deploy](platform/deploy/README.md) |
| `packages/program-model/` | Program types, block definitions, limits, validator – shared by app and platform | programs |
| `spec/` | Generated contracts: `platform-api.yaml` (OpenAPI, `cd platform && npm run openapi`), `program.schema.json` (`cd packages/program-model && npm run schema`) | – |
| `docs/decisions/` | ADRs: layout, versioning + firmware delivery (no OTA, 0006), community platform, platform architecture | – |
| `docs/archive/` | CR-0…CR-7, old roadmap / known issues / improvement plan – history only | – |

## Commands (from the repo root; pio is in `~/.platformio/penv/Scripts/`)

```sh
pio run -d firmware -e NewBoard                                  # build (≈4 min clean); firmware.bin ≈ 82 % of the 2 MB app slot
pio run -d firmware -e NewBoard -t upload   --upload-port COM4
pio run -d firmware -e NewBoard -t uploadfs --upload-port COM4   # programs
python tools/validate_programs.py
python tools/reactpod_serial.py --port COM4 monitor              # log + JSON API over USB
cd app && npm test && npx tsc                                    # before every app commit
cd packages/program-model && npm test && npx tsc && npm run schema:check   # program model (also run app + platform tests)
cd platform && npm test && npx tsc && npm run openapi:check       # before every platform commit
```

## Flows

- **Work:** issue (form, `type:` + `area:` labels) → branch `feat|fix|chore|docs/<topic>` →
  PR with "Closes #n" → CI green → `gh pr merge <n> --squash`. Commit and push only when the
  user asks. Stacked branches: PR against the parent branch, retarget after it is merged.
- **Firmware API or block semantics change:** skill `/fw-api-change`.
- **The app needs a firmware change:** skill `/fw-request`. The app must work without it:
  check `info`, a missing field means the old behaviour.
- **Bug in the other part:** open an issue (`type: bug`); fix it only if the user asks.
- **Release:** skill `/release` (tags `fw-v*` / `app-v*`; workflows build and publish).
- **App phases** (spec §13): the user approves each phase. Mark acceptance tests "pass" only
  when the user reported them as passed.

## Rules

## Config App

```sh
cd app
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest unit tests (run before every commit)
npx tsc            # type check (npm run build does it too)
npm run build      # production build → dist/
npm run preview    # serve dist/ on http://localhost:4173
```

Layout of `app/src/`:

| Folder | Content |
|---|---|
| `pod/` | Everything about talking to a pod: `transport/` (BLE via @capacitor-community/bluetooth-le, Web Serial), `simulated/` (demo pod, implements config-api.md in memory), `client.ts` (one request at a time, ids, timeouts, `overflow` retry), `files.ts` (chunked get / put), `session.ts` (connection state for the UI), `sync.ts` + `syncActions.ts` (sync states, push, restore defaults) |
| `model/` | `graph.ts` (column order) and the model tests. Types, block definitions, validation, formatting and limits are in `@reactpod/program-model` (`packages/program-model`, `file:` dependency) |
| `simulator/` | `engine.ts`: the firmware block engine ported to TS (follows programs.md §7), seeded random, real-time hook |
| `editor/` | Column view of the block graph, editing operations, undo / redo, inspector |
| `store/` | IndexedDB storage (local programs, menu, sync state per set), file cache |
| `programs/` | Catalog, sources (pod / shipped / local), program actions, set .zip import / export |
| `pages/` | One component per tab: Pod, Programs, program view, Editor, Simulate, Menu, Settings |
| `defaults/` | The shipped programs, bundled from `../firmware/data` at build time |
| `i18n/` | `en.json` (primary) and `de.json`. Every UI text goes into both files; a test checks that the keys and placeholders match |

Rules:
- Mobile first: touch targets ≥ 44 px, every action works without drag and drop, nothing cut off at 360 px.
- Design guidelines (theme Midnight / Daylight, icons, the pod puck, layout) and the link to the design
  canvas: [app/DESIGN.md](app/DESIGN.md). Read it before styling anything. Theme tokens in
  `src/app/theme.css`; use them for every colour, in both themes.
- The demo pod and the simulator must behave like the firmware. When you change one side, change the other.
- Check a UI change in a real browser: `npm run build`, `npm run preview`, then a playwright-core
  script with the local Chrome (`scripts/screenshots.mjs` shows how). Look at the screenshots.
- Deployment: every push to `main` that touches `app/` or `firmware/data/` runs
  `.github/workflows/app.yml` (test, build, publish on GitHub Pages).

## Platform

```sh
cd platform
npm install
npm run dev        # http://localhost:8787 (/v1/meta, /v1/openapi.json, /mcp); embedded PGlite in .data/dev, sign-in codes in the log
                   # real Postgres: docker compose -f compose.dev.yaml up -d and DATABASE_URL=postgres://reactpod:reactpod@localhost:5432/reactpod
npm test           # Vitest: REST, MCP and OpenAPI against the same use cases
npx tsc
npm run openapi    # regenerate spec/platform-api.yaml after changing a use case (CI checks it)
npm run build      # esbuild bundle → dist/main.js (+ dist-migrate/)
```

Rules:
- A feature is a **use case** (`src/modules/<module>/useCases.ts`, `defineUseCase`), added to
  `src/core/registry.ts`. Never write REST routes or MCP tools by hand; both are generated.
- Use cases talk to the outside only through `ctx.ports` (`src/core/ports.ts`).
- Set `agent` deliberately: `deny` for anything an AI client must not do, `draft` for writes (spec §7.3).
- Tables per module in `schema.ts` (exported in `src/db/schema.ts`); after a change run
  `npm run db:generate` (Drizzle) and commit the migration. Merged migrations are never edited.
- Rights: `requireMember(tx, ctx, orgId, minRole)` from `modules/orgs/policies.ts`; non-members get 404.
  Every write calls `recordAudit` (ids only, no names or e-mails).
- Tests run on PGlite (`test/helpers.ts` → `testEnv()`: fresh database, captured mails, controllable clock).

## Environment

- Windows with Git Bash and PowerShell. `git` has `core.autocrlf` on: the working copy has CRLF,
  the repository LF. Files written by tools with LF show a warning on `git add`; that is fine.
- `firmware/data/` is uploaded to the pods from the Windows working copy (CRLF), while the Pages build
  bundles the LF files. The app compares programs by JSON content, so this only affects CRCs
  (for example, "restore defaults" re-uploads shipped files whose line endings differ).
- `gh` is logged in for `RunningJoke/reactionButton`.
