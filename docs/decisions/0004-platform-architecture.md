# 0004 Platform architecture: one core, REST for apps, MCP for AI clients

> **On hold** since 2026-10-29: [0007](0007-platform-on-hold.md).

Date: 2026-10-19 · Status: proposed

## Context

The community platform ([0003](0003-community-platform.md)) needs accounts, clubs and teams,
sharing of programs / presets / sets and training results. The Config App must talk to it over
an API, and AI clients (Claude and other agents) should be easy to attach without building a
second backend. Clubs train minors, so privacy and rights must hold for every client the same
way. Full spec: [docs/platform/spec.md](../platform/spec.md).

## Decision

- **Own TypeScript service** (Hono, Node) on **managed Postgres in the EU**. No backend-as-a-
  service as the contract: the API we document is the API clients use.
- **Modular monolith, hexagonal**: modules `identity`, `orgs`, `catalog`, `training`,
  `devices`, `moderation`; business rules in use cases; Postgres, storage, mail and WebAuthn
  behind ports.
- **Use cases defined once** (name, description, zod input / output, scope, agent mode). From
  that the build generates the REST route + OpenAPI 3.1 (`spec/platform-api.yaml`), the MCP tool
  and the typed client for the app.
- **Front doors**: REST `/v1` for the app, tools and third parties; an **MCP server** (`/mcp`,
  Streamable HTTP) for AI clients. Both are thin adapters; neither has its own logic.
- **Auth**: email magic link + passkeys for people; **OAuth 2.1** (PKCE, dynamic client
  registration, as the MCP auth spec requires) and personal access tokens for clients. Tokens
  have scopes and a kind (`session`, `pat`, `oauth`, `agent`). A client never has more rights
  than its user.
- **AI writes are drafts**; publishing, deleting, sharing and data about people need a human.
  Minors' data is pseudonymised for agents. Every agent call is audited.
- The **program model** (types, block definitions, validator) moves from `app/src/model/` into
  `packages/program-model/`, used by app and platform; `spec/program.schema.json` is generated.

## Consequences

- One language and one program model for app and platform; the platform rejects exactly what
  the app rejects.
- Every new use case is available to the app and to AI clients at once, with the same checks.
- We run and secure our own service and auth server (small surface: no passwords).
- The app gets a `platform/` module and stays usable offline and without an account.
- Prerequisite work: extract the program model into a workspace package (app tests stay green).
- Per-attempt results over BLE need a firmware change (requested via `/fw-request`).
