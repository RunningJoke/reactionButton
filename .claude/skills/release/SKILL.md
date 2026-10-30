---
name: release
description: Release ReactPod firmware (tag fw-vX.Y.Z → binaries, OTA manifest, Pages) or the Config App (tag app-vX.Y.Z). Use when the user asks to release, tag or publish a version.
---

# Release

Ask which part and confirm the version. Tags are outward-facing: push only after the user confirmed.

## Firmware `fw-vMAJOR.MINOR.PATCH`

1. `main` up to date and green (`gh run list --branch main --limit 5`). Run the hardware release checklist
   (`docs/firmware/testing.md` §12) on the release build, results into the release PR; ask the user for the
   manual lines (two sets, battery run-down, logic analyser, auto power-off).
2. `FW_VERSION_MAJOR/MINOR` in `firmware/src/_Definitions.h` match the tag; else bump on a
   `chore/release-fw-…` PR, squash-merge, pull. PATCH lives only in the tag (fixes without API change).
3. `git tag fw-vX.Y.Z && git push origin fw-vX.Y.Z`.
4. `gh run watch` **Firmware release**: checks tag vs `FW_VERSION`, builds, creates the release
   (`firmware.bin`, `bootloader.bin`, `partitions.bin`, `spiffs.bin`, `ota-manifest.json`), then starts the
   **App** workflow, which publishes them at `https://runningjoke.github.io/reactionButton/firmware/`.
5. Check `…/firmware/ota-manifest.json` loads; report the release URL.

## App `app-vX.Y.Z`

1. In `app/`: `npm version X.Y.Z --no-git-tag-version` on a PR, merge.
2. ```sh
   git tag app-vX.Y.Z && git push origin app-vX.Y.Z
   prev=$(git tag -l 'app-v*' --sort=-v:refname | sed -n 2p)
   gh release create app-vX.Y.Z --title "App X.Y.Z" --generate-notes ${prev:+--notes-start-tag $prev}
   ```
   The app deploys on every merge to `main`; the tag only marks the version.

## Hardware `hw-revN`

Tag the commit with the ordered PCB / casing files; no workflow.
