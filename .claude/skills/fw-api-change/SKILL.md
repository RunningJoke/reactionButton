---
name: fw-api-change
description: Checklist for changing the ReactPod firmware configuration API or block semantics (new request, field, block type, port or engine behaviour), so docs, versions, tools and the app stay in sync. Use whenever firmware/src/Config, Block, BlockManager or the program format changes.
---

# Firmware API / block semantics change

The docs are the contract. Do every step; say explicitly when one does not apply.

1. **Spec first:** `docs/firmware/config-api.md` (ops, fields, errors, the `info` feature table in §5)
   and/or `docs/firmware/programs.md` (§2 block reference, §7 engine), `link-protocol.md` for frames.
2. **Version:** bump `FW_VERSION_MINOR` in `firmware/src/_Definitions.h` (`info.firmware`). Breaking
   change: discuss a MAJOR bump with the user.
3. **Program format** (new block fields, ports or semantics): raise `PROGRAM_FORMAT` in
   `firmware/src/Block/BlockFactory/BlockFactory.h`, `tools/validate_programs.py`,
   `packages/program-model/src/limits.ts`; add a row to programs.md §6.
4. **Feature flag:** a new optional feature goes into `info.features`.
5. **Tools:** `tools/reactpod_config.py`, `reactpod_serial.py`, `validate_programs.py` if affected.
6. **App mirror** (must still work with older firmware: feature-detect via `info`):
   `app/src/pod/protocol.ts` (types), `app/src/pod/simulated/SimulatedPod.ts` (demo pod = firmware),
   `packages/program-model/src/blockTypes.ts` + `validate.ts` (run program-model, app and platform tests;
   then `npm run schema` in `packages/program-model`), `app/src/simulator/engine.ts` (semantics).
7. **Verify:** `pio run -d firmware -e NewBoard` (flash usage vs the app slot), `python3
   tools/fw_syntax_check/check.py`, `python tools/validate_programs.py`, `cd app && npm test && npx tsc`.
   Test on a pod over USB (`docs/firmware/testing.md`) when one is connected.
8. **PR** with `area: firmware` (+ `area: app`, `area: tools`) and the checklist filled in.
