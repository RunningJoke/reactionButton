# 0007 Platform development on hold

Date: 2026-10-29 · Status: accepted · Pauses [0003](0003-community-platform.md) and [0004](0004-platform-architecture.md)

## Context

The community platform (`platform/`, ADR 0003 / 0004) has accounts, clubs, athletes, sharing and
the training upload as an API (PL0–PL3), and the Config App has a preview client for it (sign-in,
athlete links, result upload, deletions). The work that matters now is in the hall: pods, the app
and live training with one set. Several sets on one phone (#46) did not work in the first test on
a phone and needs more investigation.

## Decision

- **Platform development is halted until further notice.** No new platform features, no new
  platform phases.
- **New app and firmware work does not take the platform into account.** Features, screens, data
  models and firmware fields are designed for the pods and the app alone; no platform field, upload
  step or account concept is added "for later".
- **What exists stays in place**, unchanged and working: the platform code and its tests, the API
  contract (`spec/platform-api.yaml`), the app's platform client (preview under Settings), and the
  communication protocols (the pods' config API incl. reports, the link protocol, and the app ↔
  platform upload). Nothing is removed. A change elsewhere that breaks it is fixed (the platform
  tests keep running).
- Issues linked to the platform carry `status: on-hold`.
- "Add another set" (several sets at once, #46) is removed from the app until it is investigated;
  the app follows one set at a time. This is separate from the platform decision.

## Consequences

- The app's results stay on the phone (results history, CSV export); the platform upload remains a
  preview that nobody needs to use.
- When the platform is resumed, a new ADR replaces this one and the on-hold issues are reviewed.
