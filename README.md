# ReactPod

ReactPods are reaction buzzers for training: an ESP32-C3 pod with an 18-LED ring and one big
button. Several pods form a **set**. One pod is the **central** and runs the game program, the
others are **peripherals**. Programs are JSON block graphs; the **Config App** builds,
simulates and uploads them.

**Config App:** https://runningjoke.github.io/reactionButton/ (PWA, works offline, demo pod built in)

**New here?** Read the [user manual](docs/user/manual.md): the pod, the games and the app, without technical terms.

| Part | Folder | Docs |
|---|---|---|
| Firmware (PlatformIO, Arduino + ESP-IDF) | [firmware/](firmware/) | [docs/firmware/](docs/firmware/README.md) |
| Shipped game programs | [firmware/data/](firmware/data/) | [programs.md](docs/firmware/programs.md) |
| Config App (React + TypeScript PWA) | [app/](app/) | [docs/app/spec.md](docs/app/spec.md) |
| Reference clients and validator (Python) | [tools/](tools/) | [config-api.md](docs/firmware/config-api.md) |
| PCB (KiCad) and casing (FreeCAD) | [hardware/](hardware/) | |
| User manual, game modes | [docs/user/](docs/user/) | [manual.md](docs/user/manual.md) |
| Decisions | [docs/decisions/](docs/decisions/) | |

## Quick start

```sh
# firmware (from the repository root)
pio run -d firmware -e NewBoard -t upload      # flash
pio run -d firmware -e NewBoard -t uploadfs    # flash the programs
python tools/reactpod_serial.py monitor        # log over USB

# app
cd app && npm install && npm run dev           # http://localhost:5173
```

In VS Code, open [reactpod.code-workspace](reactpod.code-workspace) so PlatformIO finds the
firmware project.

## Releases

Firmware, app and hardware are versioned separately: tags `fw-v2.7.0`, `app-v1.0.0`,
`hw-rev1`. Firmware releases carry the binaries (flashed over USB; OTA is not planned, ADR 0006); see
[CONTRIBUTING.md](CONTRIBUTING.md).
