# 0006 No OTA firmware updates for now

Date: 2026-10-26 · Status: accepted · Supersedes the OTA part of [0002](0002-versions-and-firmware-delivery.md)

## Context

0002 planned firmware updates over the air: two OTA app slots, an `ota.*` config API, a relay
from the central to the peripherals over ESP-NOW, rollback and an update service in the app
(issues #15–#18, milestone "OTA"). Firmware 2.9 (programFormat 3) uses 85 % of the single
2 MB app slot (1 789 868 bytes). Two OTA slots on the 4 MB flash would be about 1.9 MB each, and
SPIFFS for the programs would shrink to a few hundred KB, with no room for growth.

## Decision

- No OTA firmware updates in the foreseeable future. Pods are flashed over USB
  (`pio run -d firmware -e NewBoard -t upload`, then `-t uploadfs` for the programs).
- The partition table keeps its single app slot. Space goes to firmware features and programs.
- Issues #15, #16, #17, #18 and the "OTA" milestone are closed as not planned.
- The version streams and the release workflow from 0002 stay. A firmware release still
  publishes the binaries, also on Pages, for a possible browser-based USB flasher.

## Consequences

- Updating a set means connecting every pod to a computer once per firmware release.
- The app's "firmware update needed" hints mean a USB flash.
- If OTA returns, it needs a new ADR, a size budget (for example `-Os`, lower log levels,
  NimBLE instead of Bluedroid) and one USB flash of every pod for the new partition table.
