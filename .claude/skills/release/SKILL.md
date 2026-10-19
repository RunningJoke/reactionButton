---
name: release
description: Release ReactPod firmware (tag fw-vX.Y.Z → binaries, OTA manifest, Pages) or the Config App (tag app-vX.Y.Z). Use when the user asks to release, tag or publish a version.
---

# Release

Ask which part (firmware, app) and confirm the version with the user. Tags are outward-facing:
push them only after the user confirmed.

## Firmware `fw-vMAJOR.MINOR.PATCH`

1. `main` is up to date and green (`gh run list --branch main --limit 5`).
2. `FW_VERSION_MAJOR/MINOR` in `firmware/src/_Definitions.h` match the planned tag. If not:
   bump on a `chore/release-fw-…` PR, merge (squash), pull.
   PATCH is only in the tag (fixes without API change keep MAJOR.MINOR).
3. Tag and push:
   ```sh
   git tag fw-v2.8.0 && git push origin fw-v2.8.0
   ```
4. Watch **Firmware release** (`gh run watch`): it checks the tag against `FW_VERSION`, builds,
   creates the GitHub release (`firmware.bin`, `bootloader.bin`, `partitions.bin`,
   `spiffs.bin`, `ota-manifest.json`) and starts the **App** workflow on `main`, which publishes
   the binaries at `https://runningjoke.github.io/reactionButton/firmware/`.
5. Check `…/firmware/ota-manifest.json` loads. Report the release URL.

## App `app-vX.Y.Z`

1. Bump `version` in `app/package.json` (and `package-lock.json` via `npm version X.Y.Z --no-git-tag-version` in `app/`) on a PR, merge.
2. ```sh
   git tag app-vX.Y.Z && git push origin app-vX.Y.Z
   prev=$(git tag -l 'app-v*' --sort=-v:refname | sed -n 2p)
   gh release create app-vX.Y.Z --title "App X.Y.Z" --generate-notes ${prev:+--notes-start-tag $prev}
   ```
   The app itself is deployed on every merge to `main`; the tag marks the version.

## Hardware `hw-revN`

Tag the commit that holds the ordered PCB / casing files; no workflow.
