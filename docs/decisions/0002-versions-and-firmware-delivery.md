# 0002 Version streams and firmware delivery for OTA

Date: 2026-10-19 · Status: accepted; the OTA part is superseded by [0006](0006-no-ota.md)

## Context

The app will update the firmware of several pods (OTA). A PWA can only download files from
origins that send CORS headers; GitHub release assets do not. Firmware, app, program format
and hardware change at different speeds.

## Decision

- Tags per part: `fw-vMAJOR.MINOR.PATCH` (MAJOR.MINOR = `FW_VERSION_*`), `app-vX.Y.Z`
  (`app/package.json`), `hw-revN`. The program format stays an integer (`PROGRAM_FORMAT`).
- A `fw-v*` tag runs the firmware release workflow: build, GitHub release with
  `firmware.bin`, `bootloader.bin`, `partitions.bin`, `spiffs.bin` and `ota-manifest.json`.
- The app's Pages deploy copies the latest firmware release to `/firmware/` on the same
  origin as the app. The app reads `/firmware/ota-manifest.json`:
  ```json
  { "version": "2.8.0", "programFormat": 1, "board": "NewBoard",
    "files": [{ "name": "firmware.bin", "size": 1714608, "sha256": "…" }] }
  ```

## Consequences

- Releasing firmware = pushing a tag; the app picks it up without an app change.
- The same files allow a first-time USB flash from the browser (Web Serial) later.
- OTA itself needs firmware work first: two OTA app slots (current table has one), a size
  budget (firmware.bin is 1.71 MB; two 1.75 MB slots on 4 MB flash leave ≈384 KB for
  programs), an `ota.*` config API, relay to peripherals over ESP-NOW, and rollback.
  Changing the partition table needs one USB flash of every pod. Tracked as issues.
