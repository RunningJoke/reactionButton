# 0001 Monorepo layout and workflow

Date: 2026-10-19 · Status: accepted

## Context

The firmware sat at the repository root next to the app (`configApp/`), CAD files and mixed
docs. A second app service (OTA) and a community platform are planned; both need clear
boundaries and a shared program format.

## Decision

- One repository, one folder per part: `firmware/`, `app/`, `tools/`, `hardware/`, `docs/`,
  later `spec/` (program JSON Schema) and `platform/` (community).
- The repository keeps its name `reactionButton`, so the Pages URL of the installed PWA stays.
- `docs/` by part: `firmware/`, `app/`, `user/`, `decisions/`, `archive/`.
- Work is tracked in GitHub issues (forms) with `area:` / `type:` / `status:` labels and
  milestones; roadmap and known-issues files are archived.
- PRs are squash-merged, branches deleted after the merge; CI checks the parts a PR touches.

## Consequences

- PlatformIO commands run with `-d firmware` from the root; VS Code uses `reactpod.code-workspace`.
- One commit per PR on `main`; release notes come from PR titles.
- Old branches with unmerged work are kept as `archive/<name>` tags.
