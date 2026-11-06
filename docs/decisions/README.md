# Decisions (ADRs)

Binding decisions, one paragraph each. Never rewrite one: a changed decision gets a new number that
supersedes the old one. Full texts (context, options, measurements): [wiki](https://github.com/RunningJoke/reactionButton/wiki/Decisions).

## 0001 Monorepo and workflow – accepted
One folder per part (`firmware/ app/ tools/ hardware/ docs/ spec/ platform/ packages/`). Repo name
`reactionButton` stays (Pages URL of the installed PWA). Work in issues with `area:`/`type:`/`status:`
labels; squash-merged PRs (title = changelog line), branch deleted after merge; CI checks the parts a
PR touches. PlatformIO runs with `-d firmware`; VS Code opens `reactpod.code-workspace`.

## 0002 Version streams – accepted (OTA part superseded by 0006, then 0009)
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

## 0006 No OTA – superseded by 0009 (accepted 2026-10-26)
Pods are flashed over USB (`-t upload`, then `-t uploadfs`). One 2 MB app slot; two OTA slots would
leave no room for programs. Issues #15–#18 closed. Releases still publish the binaries. Bringing OTA
back needs a new ADR, a size budget and one USB flash of every pod (new partition table).

## 0007 Platform on hold – accepted (2026-10-29)
No new platform features or phases. New app/firmware work ignores the platform (no platform fields,
upload steps or account concepts "for later"). Existing platform code, tests, API contract, the app's
platform client (preview under Settings) and all protocols stay and keep working; a change that breaks
them gets fixed. Platform issues carry `status: on-hold`. Separately: the app follows one set at a time;
several sets at once (#46) are removed until investigated. Results stay on the phone (history, CSV).

## 0008 NimBLE host instead of Bluedroid – accepted (2026-10-30)
The phone link uses NimBLE-Arduino 1.4.3 (own host stack) on the IDF controller; `sdkconfig.NewBoard` is
`BT_CONTROLLER_ONLY`, host limits are build flags in `platformio.ini` (one connection, MTU 517, peripheral
role only). Reason: RAM and flash (Bluedroid ≈ 64 KB heap, ADR 0005). `firmware.bin` 1 469 568 → 1 093 824 B
(52 % of the 2 MB slot). GATT UUIDs, indicate-only response, advertisement and MTU are unchanged, so app and
tools need no change. Differences in `PhoneConfig`: `indicate()` does not wait, so the sender task waits for
`onStatus` (3 s timeout, line dropped); the server gets no connection-update event, so the interval is polled
every 500 ms. Hardware test 2026-10-30: connect, upload and reporting work. Still open: the ADR 0005 30-min
run (`txLost` 0, start spread < 5 ms, min free heap > 40 KB) and a heap measurement against 73 KB. Rejected:
trimming Bluedroid first (not measured), the IDF's own NimBLE host (more code, same result).

## 0009 OTA with two app slots – accepted (2026-11-06)
Supersedes 0006. Pods update over the air; USB stays the recovery path and the only way to change this
layout, so it is frozen after one USB flash of every pod (development phase: programs may be lost). Layout
of the 4 MB flash: `nvs` 20 KB, `otadata` 8 KB, `ota_0` and `ota_1` 1 792 KB each (`0x10000`, `0x1D0000`),
`spiffs` 384 KB (`0x390000`), `coredump` 64 KB (`0x3F0000`). Bootloader with app rollback: a new image must
pass a self-test and mark itself valid, otherwise the next reset returns to the old one. Size budget:
`firmware.bin` 1 095 344 B = 60 % of a slot; CI warns above 85 % (1 523 KB) and fails above 95 % (1 702 KB).
Own code is 254 KB and a block costs 1–9 KB, so blocks are not the limit; framework upgrades are. Storage:
SPIFFS is reliable to about 75 % (288 KB) and a sync of every file needs the store twice (`/t/` before the
rename), so one store may use up to 144 KB: 15 programs averaging about 8 KB. Flow: phone → central over the
config API (BLE or USB) into the inactive slot → central → peripherals over ESP-NOW, read from that same slot
while the central still runs the old firmware → once every pod reports a verified image, all activate, the
central last. The set stays playable until then and an interrupted update changes nothing. Only from MENU, only
above 30 % battery, app slot only: programs keep using the store and its sync, `spiffs.bin` is never sent over
the air. OTA images are signed in the release workflow and verified before activation; unsigned images are USB
only. A pod shows the UPDATE light pattern (dark red breathing, white progress bar). Rejected: two 1 920 KB
slots (128 KB storage, about 2 KB per program), two 1 536 KB slots (896 KB storage nothing needs, less room for
framework growth), factory updater + one slot (a second firmware that cannot safely update itself, no rollback
to the previous game firmware), WiFi or HTTPS on the pod (credentials, TLS size, mixed content from the PWA).
Simultaneous delivery by ESP-NOW broadcast is built only if the measurement in the OTA spike supports it.
