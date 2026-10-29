# 0003 Community platform

> **On hold** since 2026-10-29: [0007](0007-platform-on-hold.md).

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

Answers so far are in the [platform spec](../platform/spec.md) and [ADR 0004](0004-platform-architecture.md).

1. Hosting and backend: managed (Supabase / Firebase / Cloudflare D1+Workers) or own server?
   → own TypeScript service on managed EU Postgres (0004).
2. Accounts: email login, GitHub / Google login, or anonymous publishing with edit links?
   → email magic link + passkeys, no passwords (spec §3.1).
3. What is shared: single programs, whole sets (.zip), includes/libraries, LED designs?
   → programs (with revisions), presets, sets; plus training results inside clubs (spec §3).
   LED designs later.
4. Forking and versions of shared programs; attribution. → immutable revisions, fork links the
   source revision (spec §3.3).
5. Licence of shared content (e.g. CC BY 4.0) and moderation / reporting. → CC BY 4.0 default,
   CC0 optional, reports + admin hide (spec §3.3). Who moderates is still open.
6. Offline: does the app cache community programs like its own workspace? → yes, the app stays
   offline-first; installed content is cached, results queue offline (spec §5.4).
7. Privacy (GDPR): what is stored about users, where (EU hosting?). → EU only, minimal data,
   minors club-managed (spec §8).
8. Athlete profiles and results (epic #37, #48): who creates and owns an athlete profile (coach,
   club, the athlete), who may see the results, and how an athlete is linked to an account.
   → the club owns profiles and results; coaches add them; coaches see their teams' results,
   the athlete their own; a profile is linked by an invitation the athlete accepts (spec §3.2,
   §3.7).
9. Consent for athlete data, including minors (parental consent), and how it is recorded.
   → the coach confirms it when adding the profile; date and user are stored (spec §8, P23).
10. Retention and deletion of results; export of an athlete's data (GDPR access / portability).
    → kept until deleted; deleting a profile deletes its results; a claimed profile's results are
    in the athlete's data export (spec §8, P24).
11. Results are performance data about people: EU hosting and data processing agreements
    for the chosen backend. → EU only (Hetzner, managed EU Postgres, EU mail provider), data
    processing agreement for clubs before PL3 goes live (spec §8).
