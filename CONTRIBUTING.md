# Contributing

## Issues

Use the issue forms: **Bug**, **Feature**, **Firmware request** (an API or block change the app
or the tools need). Every issue gets one `type:` and at least one `area:` label.

| Label | Meaning |
|---|---|
| `area: firmware` · `app` · `tools` · `hardware` · `docs` · `platform` | Part of the repo |
| `type: bug` · `feature` · `fw-request` · `chore` | Kind of work |
| `status: needs-decision` · `blocked` | Why it is not moving |

Planned work is grouped in **milestones** (one per app phase or firmware release).

## Branches and pull requests

- Branch from `main`: `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>`.
- Open a PR to `main`, link the issue (`Closes #12`), fill in the checklist.
- CI must pass: **App** (tests, type check, build) and **Firmware** (build, flash usage,
  program validation) run for the parts a PR touches.
- PRs are **squash-merged**; the PR title becomes the commit on `main`, so write it as a
  changelog line. The branch is deleted after the merge.
- A branch that builds on an unmerged branch is opened against that branch and retargeted to
  `main` once the first PR is merged.

## Changing the firmware API or block semantics

The docs are the contract between firmware, app and tools.

1. Update [config-api.md](docs/firmware/config-api.md) and/or [programs.md](docs/firmware/programs.md).
2. Bump `FW_VERSION_MINOR` in `firmware/src/_Definitions.h` (`info.firmware`).
3. New block fields, ports or semantics: increase `PROGRAM_FORMAT` in
   `firmware/src/Block/BlockFactory/BlockFactory.h`, `tools/validate_programs.py` and
   `app/src/model/limits.ts`, and add a row to programs.md §6.
4. Report a new optional feature in `info.features`.
5. Update the clients in `tools/`.
6. Mirror it in the app: `pod/protocol.ts`, `pod/simulated/SimulatedPod.ts`,
   `model/blockTypes.ts` + `model/validate.ts`, `simulator/engine.ts`.

The app must keep working with older firmware: check `info`, treat a missing field as the old
behaviour.

## Versions and releases

| Part | Version lives in | Tag | Release |
|---|---|---|---|
| Firmware | `FW_VERSION_MAJOR/MINOR` in `firmware/src/_Definitions.h` | `fw-vMAJOR.MINOR.PATCH` | GitHub release with `firmware.bin`, `bootloader.bin`, `partitions.bin`, `spiffs.bin`, `ota-manifest.json`; also published at `<app url>/firmware/` |
| App | `version` in `app/package.json` | `app-vX.Y.Z` | GitHub release (notes only); every merge to `main` deploys the app |
| Program format | `PROGRAM_FORMAT` (integer) | – | programs.md §6 |
| Hardware | – | `hw-revN` | – |

Release a firmware: bump the version on a PR, merge it, then
`git tag fw-v2.8.0 && git push origin fw-v2.8.0`. The **Firmware release** workflow checks
that the tag matches `FW_VERSION`, builds, creates the release and redeploys the app with the
new binaries.

Release the app: bump `version` in `app/package.json` on a PR, merge it, then tag
`app-vX.Y.Z` and `gh release create app-vX.Y.Z --generate-notes`.

## Local checks

```sh
cd app && npm test && npx tsc          # app
pio run -d firmware -e NewBoard        # firmware; CI reports firmware.bin vs. the app slot
python tools/validate_programs.py      # shipped programs
```
