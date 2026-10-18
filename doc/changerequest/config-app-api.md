# Change requests from the Config App

Requested by: Config App (`configApp/`, branch `feature/config-app`) · Date: 2026-10-18

These are changes to the firmware and the configuration API ([../config-api.md](../config-api.md))
that the Config App would benefit from. They are ranked by priority. Each entry can be
implemented on its own. Version 1 of the app **works without any of them**. The app handles
a missing feature by checking `info` (field missing → old behaviour).

When you implement one: update [config-api.md](../config-api.md), the reference clients in
`tools/` if affected, bump `firmware` in `info`, and mark the entry here as done with the commit.

| ID | Priority | Title | Status |
|---|---|---|---|
| CR-1 | High | Tell sets apart in the BLE advertisement | open |
| CR-2 | Medium | Program format revision in `info` | open |
| CR-3 | Medium | Document engine details the simulator must copy | open |
| CR-4 | Medium | `validate` with inline content (dry run) | open |
| CR-5 | Low | Program metadata in `list` | open |
| CR-6 | Low | Optional PIN for write operations | open |

---

## CR-1 – Tell sets apart in the BLE advertisement (High)

**Reason.** Every central advertises the same name, "ReactPod Config"
(`src/Roles/Central/PhoneConfig.cpp:46`). Coaches often have several sets in one hall.
The Web Bluetooth chooser (and most native pickers) only shows the name, so the user cannot
tell which set they are about to change. Writing programs to the wrong set is the most
likely mistake a customer will make.

**Description.**
- Advertise the name as `ReactPod <last 4 hex digits of setId>`, e.g. `ReactPod 91c2`.
  The name must stay ≤ 29 bytes so it fits into the advertisement.
- Keep the service UUID `12345678-1234-1234-1234-1234567890ab` in the advertisement.
  The app filters by the service UUID, plus the `namePrefix: "ReactPod"`.
- Optional: put the full `setId` (4 bytes) into the manufacturer data, so the native app can
  show it without connecting.
- Optional, nicer: a user-defined set name (≤ 16 characters) stored in NVS and set with a
  new op `{"op":"setName","name":"Halle 2"}`. If it is set, advertise that name instead.
  Report it in `info` as `"setName"`.

**Acceptance.** Two centrals in the menu show up with different names in the Chrome
chooser. The suffix matches the `setId` in `info`.

---

## CR-2 – Program format revision in `info` (Medium)

**Reason.** `info.blockTypes` lists the type names only. If a firmware update adds a field
or a port to an existing type (e.g. a new port on `button`), the app cannot tell whether the
connected pod supports it. Programs using the new field would then pass the app's
validation and fail on the pod, or the field would be ignored silently.

**Description.** Add `"programFormat": <int>` to the `info` response, starting at `1`
(matches `"version": 1` in program files). Increase it whenever a block type gets new
fields, ports or semantics. Keep a short changelog table in [../programs.md](../programs.md).

**Acceptance.** `info` contains `programFormat`. `programs.md` lists what each revision added.

---

## CR-3 – Document engine details the simulator must copy (Medium, docs only)

**Reason.** The app simulates programs in the browser. To behave like the pod it has to
copy details that are only in the code today. If they change silently, the simulator and
the pod drift apart.

**Description.** Add a section "Engine semantics" to [../programs.md](../programs.md) that states:
- the step limit per loop pass (`BlockManager::MAX_STEPS_PER_PASS = 32`) and what happens
  when it is reached (continues in the next pass, so an endless loop of instant blocks does
  not hang the pod);
- which blocks finish immediately and which wait;
- `random` / `randomOther` ranges and how `randomOther` behaves when `value` ≤ 1;
- `delay` with `minMs`/`maxMs`: inclusive bounds;
- `button`: exact meaning of `pressed` vs `short`/`long`, what happens when a `timeout`
  fires while the button is held, which port is taken when `shortMs` is reached while held;
- `remoteMultiPress`: how the avoid pods are drawn (central included, can all be avoid?),
  what happens with `pods` > connected peripherals;
- `remotePress` on a pod id that does not exist (→ `timeout`, already documented) and on
  the central's own id;
- `summary` when the metric has no values (which values are stored).

**Acceptance.** Every point above is answered in `programs.md`, with a reference to the code.

---

## CR-4 – `validate` with inline content (Medium)

**Reason.** Today a program can only be validated by the firmware after it has been stored
on the pod. The app validates locally first, but its validator is a copy of the rules. A
dry run lets the app check a program against the real loader **before** anything changes
on the pod, and show the pod's message in the editor.

**Description.** Extend `validate`:
```json
→ {"op":"validate","path":"/prog/mygame.json","data":"{ ... }"}
← {"op":"validate","ok":true,"path":"/prog/mygame.json","blocks":14}
```
- With `data`, the program text is taken from the request instead of the file. Includes are
  still read from the store. Nothing is written, the generation does not change.
- `data` is limited by `maxRequest` (12288 bytes). Larger programs are validated after the upload,
  as today.
- Report support in `info`, e.g. `"features":["validateInline"]`.

**Acceptance.** A dry run of an invalid program returns `invalid_program` with the block
name, and `list` shows no changes afterwards.

---

## CR-5 – Program metadata in `list` (Low)

**Reason.** To show the program overview (name, number of pods, menu pattern) the app
has to `get` every file. Over BLE with a small MTU this takes several seconds. The app
caches the files by CRC, so this only matters for the first connection to a set.

**Description.** In the `list` response add, for files that parse as a program with a
`name`: `"name"`, `"peripherals"`, `"menu"` (as in the file). Fragments (no `name`) get
`"fragment": true`. The firmware should read this from the cached manifest, not parse each file
on every `list`.

**Acceptance.** `list` on the default set returns names and peripheral counts that match the files.

---

## CR-6 – Optional PIN for write operations (Low, later)

**Reason.** config-api §8: anyone in BLE range can change programs while a central is in the
menu. That is fine for now. When customers use the pods in public places (schools, clubs),
some will ask for protection.

**Description.** An optional PIN (4–6 digits) stored in NVS. When it is set, `put`, `delete`
and `setName` (CR-1) need a prior `{"op":"auth","pin":"1234"}` on the same connection. Read
ops stay open. Set / clear the PIN over USB serial only, so a lost PIN can be reset by the owner.
`info` reports `"pinRequired": true`.

**Acceptance.** With a PIN set, `put` without `auth` returns a new error code `auth_required`.
Over USB serial the PIN can be cleared.
