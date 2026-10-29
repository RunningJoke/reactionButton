# Decisions (ADRs)

Short records of decisions that shape the repo. One file per decision, numbered, never
rewritten: a changed decision gets a new ADR that supersedes the old one.

| # | Decision | Status |
|---|---|---|
| [0001](0001-repo-layout-and-workflow.md) | Monorepo layout, labels, squash merges | accepted |
| [0002](0002-versions-and-firmware-delivery.md) | Separate version streams; firmware binaries published next to the app (OTA part superseded by 0006) | accepted |
| [0003](0003-community-platform.md) | Community platform in `platform/`, program schema in `spec/` | proposed |
| [0004](0004-platform-architecture.md) | Platform: modular monolith, use cases exposed as REST (apps) and MCP (AI clients), magic link + passkeys | proposed |
| [0005](0005-live-results-over-ble.md) | Live results over BLE during the game: BLE stays connected on the central (fallback: reports after the game / over USB), decided by hardware test #38: 100 ms interval, central start on a timer | accepted |
| [0006](0006-no-ota.md) | No OTA firmware updates for now; pods are flashed over USB | accepted |

Template: Context · Decision · Consequences.
