# 0003 Community platform

Date: 2026-10-19 · Status: proposed

## Context

Users will save, find, edit and share programs (and later designs such as LED patterns or
game concepts) on a community platform. The Config App is the editor; the platform stores and
shares.

## Decision (so far)

- The platform lives in this repository under `platform/`, released with its own tags
  (`platform-vX.Y.Z`).
- The program format becomes a standalone contract: `spec/program.schema.json` (JSON Schema,
  versioned with `PROGRAM_FORMAT`). Firmware validator, app and platform check against it.
- The app talks to the platform through a documented HTTP API (`spec/platform-api.yaml`,
  OpenAPI), like it talks to pods through config-api.md.

## Open questions

1. Hosting and backend: managed (Supabase / Firebase / Cloudflare D1+Workers) or own server?
2. Accounts: email login, GitHub / Google login, or anonymous publishing with edit links?
3. What is shared: single programs, whole sets (.zip), includes/libraries, LED designs?
4. Forking and versions of shared programs; attribution.
5. Licence of shared content (e.g. CC BY 4.0) and moderation / reporting.
6. Offline: does the app cache community programs like its own workspace?
7. Privacy (GDPR): what is stored about users, where (EU hosting?).
