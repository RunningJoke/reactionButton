# ReactPod

Reaction buzzers for training: an ESP32-C3 pod with an 18-LED ring and one big button. Several pods form
a **set**; one pod is the **central** and runs the game program, the others are **peripherals**. Programs
are JSON block graphs; the **Config App** builds, simulates and uploads them.

- **Config App:** https://runningjoke.github.io/reactionButton/ (PWA, works offline, demo pod built in)
- **User manual, coach guide, game modes** (en / de): [wiki](https://github.com/RunningJoke/reactionButton/wiki)
- **Developing:** [CLAUDE.md](CLAUDE.md) (map, commands, workflow, rules) and the specs in [docs/](docs/)

```sh
pio run -d firmware -e NewBoard -t upload      # flash (USB; no OTA, ADR 0006)
pio run -d firmware -e NewBoard -t uploadfs    # flash the programs
python tools/reactpod_serial.py monitor        # log over USB
cd app && npm install && npm run dev           # http://localhost:5173
```

In VS Code open [reactpod.code-workspace](reactpod.code-workspace) so PlatformIO finds the firmware.
