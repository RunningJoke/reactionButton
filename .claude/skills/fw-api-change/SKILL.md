---
name: fw-api-change
description: Checklist for changing the ReactPod firmware configuration API or block semantics (new request, field, block type, port or engine behaviour), so docs, versions, tools and the app stay in sync. Use whenever firmware/src/Config, Block, BlockManager or the program format changes.
---

# Firmware API / block semantics change

The docs are the contract. Work through every step; say explicitly when a step does not apply.

1. **Spec first.** Update `docs/firmware/config-api.md` (requests, responses, errors, `info`)
   and/or `docs/firmware/programs.md` (block types §2–§5, engine semantics §7).
2. **Firmware version.** Bump `FW_VERSION_MINOR` in `firmware/src/_Definitions.h`
   (reported as `info.firmware`). Breaking change: discuss a MAJOR bump with the user.
3. **Program format** (new block fields, ports or semantics only): increase
   - `BlockFactory::PROGRAM_FORMAT` in `firmware/src/Block/BlockFactory/BlockFactory.h`
   - `PROGRAM_FORMAT` in `tools/validate_programs.py`
   - `PROGRAM_FORMAT` in `packages/program-model/src/limits.ts`
   - add a row to programs.md §6.
4. **Feature flag.** Report a new optional feature in `info.features` so clients can detect it.
5. **Tools.** Update `tools/reactpod_config.py` / `reactpod_serial.py` / `validate_programs.py`
   if affected.
6. **App mirror.**
   - `app/src/pod/protocol.ts` – types
   - `app/src/pod/simulated/SimulatedPod.ts` – demo pod behaves like the firmware
   - `packages/program-model/src/blockTypes.ts` + `validate.ts` – block types (shared by app and platform; run both test suites)
   - `app/src/simulator/engine.ts` – semantics
   - The app must still work with older firmware: feature-detect via `info`.
7. **Verify.**
   ```sh
   pio run -d firmware -e NewBoard        # firmware.bin size vs. the app slot (CI reports it)
   python tools/validate_programs.py
   cd app && npm test && npx tsc
   ```
   Test on a pod over USB (`docs/firmware/testing.md`) when the user has one connected.
8. **PR** with labels `area: firmware` (+ `area: app`, `area: tools`), the PR checklist filled in.
