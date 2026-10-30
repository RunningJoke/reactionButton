# Decisions (ADRs)

Binding decisions, one paragraph each. Never rewrite one: a changed decision gets a new number that
supersedes the old one. Full texts (context, options, measurements): [wiki](https://github.com/RunningJoke/reactionButton/wiki/Decisions).

## 0001 Monorepo and workflow – accepted
One folder per part (`firmware/ app/ tools/ hardware/ docs/ spec/ platform/ packages/`). Repo name
`reactionButton` stays (Pages URL of the installed PWA). Work in issues with `area:`/`type:`/`status:`
labels; squash-merged PRs (title = changelog line), branch deleted after merge; CI checks the parts a
PR touches. PlatformIO runs with `-d firmware`; VS Code opens `reactpod.code-workspace`.

## 0002 Version streams – accepted (OTA part superseded by 0006)
Tags per part: `fw-vMAJOR.MINOR.PATCH` (MAJOR.MINOR = `FW_VERSION_*`), `app-vX.Y.Z`, `platform-vX.Y.Z`,
`hw-revN`; `PROGRAM_FORMAT` is an integer. A `fw-v*` tag builds the GitHub release (`firmware.bin`,
`bootloader.bin`, `partitions.bin`, `spiffs.bin`, `ota-manifest.json`); the Pages deploy copies the
latest release to `<app>/firmware/` (same origin, no CORS problem) for a later browser USB flasher.

## 0003 Community platform – proposed, on hold (0007)
Platform in `platform/`; program format as standalone contract `spec/program.schema.json`; app ↔
platform over a documented HTTP API (`spec/platform-api.yaml`). Answers to the open questions:
[platform spec](../platform/spec.md).

## 0004 Platform architecture – proposed, on hold (0007)
Own TypeScript service (Hono) on EU Postgres; modular monolith, hexagonal; every use case defined
once → REST route + OpenAPI + MCP tool + typed client. Auth: email code/link (passkeys later), OAuth 2.1
and PATs for clients; a client never has more rights than its user. AI writes are drafts; minors'
data pseudonymised for agents; every agent call audited. Program model in `packages/program-model/`.

## 0005 Live results over BLE – accepted (hardware test #38, 2026-10-29)
BLE stays connected on the central during the game (`liveBle`, fw 2.12): 100 ms connection interval,
peripheral latency 0 (latency > 0 made loop gaps worse), indications from a separate task (the game
loop never waits), file changes answer `busy`, ESP-NOW with modem sleep `WIFI_PS_MIN_MODEM`
(`WIFI_PS_NONE` aborts the WiFi driver with BT on), the central's own ring starts on an esp_timer, not
the loop. Measured over 3 × 30 min: 0 of 60 000 ESP-NOW frames lost, min free heap 73 KB (Bluedroid
≈ 64 KB), loop gaps 10–17 ms ≈ 4/min with a phone, BLE round trip ≤ 0.8 s (fine for reports and
commands, not per-press display). Pass criteria for regressions: `txLost` 0 over 30 min, start spread
< 5 ms, min free heap > 40 KB, no PAUSED caused by the phone. Rejected: reports only after the game
(fallback), USB only (no Web Serial on Android), bridge dongle, WiFi AP. Test build and script were
removed; they are in git history (c33a87f, 461f7e4).

## 0006 No OTA – accepted (2026-10-26)
Pods are flashed over USB (`-t upload`, then `-t uploadfs`). One 2 MB app slot; two OTA slots would
leave no room for programs. Issues #15–#18 closed. Releases still publish the binaries. Bringing OTA
back needs a new ADR, a size budget and one USB flash of every pod (new partition table).

## 0007 Platform on hold – accepted (2026-10-29)
No new platform features or phases. New app/firmware work ignores the platform (no platform fields,
upload steps or account concepts "for later"). Existing platform code, tests, API contract, the app's
platform client (preview under Settings) and all protocols stay and keep working; a change that breaks
them gets fixed. Platform issues carry `status: on-hold`. Separately: the app follows one set at a time;
several sets at once (#46) are removed until investigated. Results stay on the phone (history, CSV).
