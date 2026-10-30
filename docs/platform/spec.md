# Platform – specification (on hold)

> **On hold since 2026-10-29 (ADR 0007).** No new features or phases; new app / firmware work ignores the
> platform. Existing code, tests, `spec/platform-api.yaml` and the app ↔ platform protocol stay and keep
> working. The code (`platform/src/modules/*/useCases.ts`) and the generated OpenAPI are the detailed
> contract; full original spec with domain model and rationale: [wiki](https://github.com/RunningJoke/reactionButton/wiki/Platform-Specification).

Online part of ReactPod: accounts, clubs and teams, sharing of programs / presets / sets, training results.
The Config App stays the editor and the only thing that talks to pods. Every client (app, tools, third
parties, AI clients over MCP) uses one API with exactly the rights of its user.

## 1. Scope (v1)
Passwordless accounts · clubs, teams, roles, invitations, managed athletes · programs with revisions, forks,
search, ratings · presets · sets · training sessions and results, statistics, team leaderboards · pod sets ·
AI clients over MCP (writes become drafts) · GDPR (EU, export, deletion, minors protected). Not: payments,
social feed, remote control of pods (pods never talk to the platform), public athlete profiles.

## 2. Roles and visibility
Every resource has one owner organisation; a personal space is an organisation of one. Roles per club:
**owner** (everything, delete, transfer) · **admin** (members, teams, athletes, pod sets, content) · **coach**
(sessions and results of their teams, presets, club programs) · **athlete** (own results, club content) ·
**viewer** (club content). Memberships can be limited to teams. Visibility: `private` · `team` · `org` ·
`public` (programs, presets, sets); results only `private` / `team` / `org`; leaderboards per team, opt-in.

## 3. Functional rules
- **Sign-in:** one mail with a 6-digit code and a link (`#/login?token=…`), single use, 15 min, 5 code
  attempts; always 202; rate limits 5 per address and 20 per IP per hour. Opaque bearer session tokens
  (30 days, SHA-256 in the DB, `Authorization: Bearer`, no cookies, no JWT). Passkeys postponed until the
  app's own domain is decided. Session list, sign out one / all, data export, account deletion.
- **Clubs:** invite by mail or link (role, teams, expiry, max uses); managed athletes (no login, name or
  nickname, birth year, teams) can be **claimed** by an account via invitation; a club always has an owner.
- **Programs:** published exactly as on the pod, validated by the shared program model (same issue codes as
  the app; invalid = draft only). Every save = immutable numbered revision (`sha256` of the text); publishing
  marks one. Fork links the source revision. Includes: only shipped `/prog/lib/*` (else
  `include_not_shipped`; the app flattens first). Deleting hides; revisions stay for presets / sets. Search by
  text, tags, pod count, club; rating 1–5; abuse reports. Licence CC BY 4.0 default, CC0 optional.
- **Presets:** named overrides of existing `variables` of a revision; `GET /presets/{id}/program` renders the
  file, the app pushes it like a local program. (The app's library "preset" is called "library part" here.)
- **Sets:** a menu + programs (revision or preset items); `GET /sets/{id}/files` returns the pod files as JSON
  (the app zips); unreadable entries are skipped and listed.
- **Pod sets:** registered from the app with `setId`, name, firmware; the platform never controls pods.
- **Training:** session = one athlete, one pod set, one program (+ optional revision / preset and content
  hash). Upload unit = the firmware report (one per `communicate`); reports followed by `repeat` are
  `discarded` (kept, not counted). Session and report ids are app UUIDs, unique per club: a repeated upload
  stores nothing twice and may only change `discarded` (the pod's report id restarts after a reboot).
  Statistics from single values; weekly trend; leaderboards inside the club only. Coaches see their athletes'
  results, an athlete their own claimed profile, viewers none.
- **Deletion:** deleting an athlete or club deletes sessions, reports, values, invitations and links. The
  claiming user may delete their profile (`DELETE /v1/orgs/{orgId}/me/athletes/{id}`, 404 for everyone else);
  coaches use `DELETE /v1/orgs/{orgId}/athletes/{id}`. The app queues deletions like uploads (app spec §9.7).

## 5. Architecture
Modular monolith, hexagonal. All rules in use cases; REST `/v1` (OpenAPI 3.1) and MCP `/mcp` (Streamable
HTTP) are thin generated front doors. Modules (own folder, tables, use cases; call each other only through
use cases): `meta`, `identity`, `orgs`, `audit`, `catalog`, `training` (`devices`, `moderation` later).
Postgres, mail, storage, WebAuthn behind `ctx.ports`. One `defineUseCase` (name, description, zod input /
output, scope, `agent` mode) generates the REST route, its OpenAPI part, the MCP tool and the client type.
Program model: `packages/program-model` (`file:` dependency, TS source, no build step);
`spec/program.schema.json` is generated from it (`x-programFormat`), the validator stays the authority.
Ids UUIDv7; every row has `orgId`; authorization always filters by it (non-members get 404).

### 5.4 App integration
`app/src/platform/` next to `pod/`: sign-in, typed client, offline queue for uploads and deletions. The
app stays offline-first and fully usable without an account. It checks `GET /v1/meta` like `info` on a pod:
a missing feature means the older behaviour.

## 6. API conventions
Endpoints: generated `spec/platform-api.yaml` (areas: auth, me, orgs, members, invites, teams, athletes,
audit, programs, presets, sets, pod sets, training, stats, moderation reports, tokens, meta). JSON UTF-8;
errors `application/problem+json` with a stable `code`; cursor pagination; `ETag` + `If-Match` on updates;
breaking changes only in `/v2`, additive ones announced in `GET /meta`; CORS only for the app origins
(Pages, localhost, Capacitor). Scopes: `profile`, `org:*`, `athletes:*`, `audit:read`, `programs:*` (programs,
presets, sets), `results:*`, `devices:*`, `tokens`; session tokens carry all.

## 7. AI clients
MCP tools are generated from the use cases with `agent` ≠ `deny`; auth later OAuth 2.1 (PKCE, dynamic client
registration) or a personal access token. **Guard rails:** the agent acts as its user, limited further by
scopes (token kind `agent`); writes are drafts (program revisions draft, presets / sets `status: draft` until a
person sets `ready`, never `public`); publishing, deleting, sharing, inviting and athlete edits are `deny`;
results readable (pseudonymised: "Athlete A3", unless the club allows names), never uploaded or deleted;
e-mail addresses never; stricter rate limits; every agent call audited.

## 8. Security and privacy
EU only (DB, storage, backups, mail). Minimal data: e-mail, display name; athletes name / nickname, optional
birth year, no health data beyond reaction times. Minors club-managed; the coach adding a profile confirms
consent (`consent: true`, recorded with date and user). Results kept until deleted; a claimed profile's
results are in the athlete's export; inactive accounts reminded after 24 months, then deleted. HTTPS + HSTS.
Audit log on every write (ids only, no names or e-mails). Before real users: imprint, privacy policy, data
processing agreement for clubs, security review.

## 9. Technology
Node LTS + TypeScript, Hono, zod + OpenAPI generation, `@modelcontextprotocol/sdk`, Postgres 17 (PGlite in
tests / dev, `DATABASE_URL=pglite:…`), Drizzle migrations (forward only), nodemailer over SMTP (`MAIL_URL`;
log when unset), esbuild bundle, Docker Compose on a Hetzner VPS with Caddy (`platform/deploy`), tags
`platform-vX.Y.Z`. The CI workflow `.github/workflows/platform.yml` that `platform/deploy` describes was never
added: platform tests run locally only.

## 14. Phases (status when halted)
| Phase | Content | Status |
|---|---|---|
| PL0 | skeleton, CI, program-model package, use-case helper, OpenAPI + MCP, deploy pipeline | implemented; staging needs server + secrets |
| PL1 | accounts, clubs, teams, invitations, managed athletes, audit | API implemented and tested; user test pending |
| PL2 | programs, revisions, forks, presets, sets, search, ratings, reports, JSON Schema | API implemented and tested; app integration not started |
| PL3 | training upload, stats, leaderboards | API implemented and tested; app upload done (#47, #48) |
| PL4 | OAuth for third-party / AI clients, agent tokens | – |
| PL5 | training plans, webhooks, moderation tooling | – |
