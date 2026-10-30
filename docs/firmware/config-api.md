# Configuration API (BLE and USB serial)

Same JSON messages on both transports. Reference clients: `tools/reactpod_config.py` (BLE, `bleak`),
`tools/reactpod_serial.py` (USB, `pyserial`, see testing.md). Implementation: `Config/ConfigApi`.

| Transport | Where | When |
|---|---|---|
| BLE | central | menu; from fw 2.12 (`liveBle`) also during the game |
| USB serial | any pod | always |

## 1. Availability over BLE

- Central = button held when the boot pattern ends (architecture §4, §7.1). Advertises `ReactPod <xxxx>` (§2.1). An empty central (no
  programs) stays in the menu with the red blink, so programs can be uploaded.
- fw ≥ 2.12 (`liveBle`): the connection stays through DISCOVERY, CONFIRM, RUN, PAUSED (interval and
  advertising: link-protocol §6). From DISCOVERY on `put`, `delete`, `setName` answer `busy`; everything
  else works, including reports, `command`, `setVariables`, `session`.
- fw < 2.12: BLE goes off at program select (the connection drops); API in the menu only.
- After `put` / `delete` the menu reloads at once; the set syncs the store automatically (§6).

## 2. GATT

Service `12345678-1234-1234-1234-1234567890ab`.

| Characteristic | UUID suffix | Props | Use |
|---|---|---|---|
| Command | `…90b1` | Write, Write w/o response | requests |
| Response | `…90b2` | **Indicate only** (CCCD) | responses + `report` events |
| MaxLoop | `…90a7` | Write, Read | ASCII number > 0 overrides `MAX_LOOPS` of the next selected program |

Subscribe for indications (Web Bluetooth `startNotifications()`, Android / bleak `start_notify()` pick them).
Confirmations are the flow control (fw 2.0 also offered notify, which made responses get lost). The pod
requests MTU 517; the API works with 23, just slower.

### 2.1 Advertisement
Advertisement: flags, 128-bit service UUID, manufacturer data `0xFFFF` + `setId` (4 bytes BE). Scan
response: name, preferred connection interval. Name: `ReactPod <last 4 hex of setId>` or `ReactPod <set
name>` (≤ 25 bytes); filter with the service UUID + `namePrefix: "ReactPod"`. The set name is stored on
the central only (not synced) and advertised after the current connection ends.

## 3. Framing

- One JSON object + `\n` per message (UTF-8, no newline inside). May be split over any number of writes /
  indications; ≤ *MTU − 3* bytes per BLE write.
- **One request at a time**: wait for the response. Max request 12288 bytes (`maxRequest`).
- Optional `"id"` (any JSON) is echoed with `"op"`.
- Success `{"op","id","ok":true,…}`, error `{"op","id","ok":false,"error":"<code>","message":"…"}`.

| Error | Meaning |
|---|---|
| `bad_request` | not JSON, unknown op, missing / bad field (also an unknown pod id) |
| `bad_path` | path not allowed (§4) |
| `not_found` | file missing |
| `bad_offset` | `get` past the end / `put` not continuing the upload |
| `too_large` | file > 16384 or request > 12288 bytes |
| `crc_mismatch`, `invalid_json` | final `put` chunk rejected, nothing stored |
| `invalid_program` | `validate`: `message` names file + block |
| `storage` | flash write failed |
| `overflow` | data came faster than processed: resend |
| `auth_required`, `auth_failed` | PIN (§8) |
| `busy` | not now: file change from DISCOVERY on, validate during a game, sync, effect / pattern while armed |
| `not_ready` | no block waits / pods missing / pod too old |
| `low_battery` | `start` with a pod < 5 % (fw ≥ 2.13) |
| `not_editable`, `out_of_range` | `setVariables` |
| `not_running`, `not_paused` | `pause` outside RUN, `resume` without a phone pause |

## 4. Files

| Path | Content |
|---|---|
| `/programs.json` | menu `{"programs": ["/prog/solo.json", …]}` in order |
| `/prog/<name>` | programs and include fragments (`/prog/lib/loop.json`) |

Paths ≤ 31 characters incl. leading `/` (SPIFFS); after `/prog/` only `A–Z a–z 0–9 _ - . /`, no `..`,
`//` or trailing `/`. Valid JSON (format: programs.md), ≤ 16384 bytes. **Offsets and sizes are UTF-8
bytes.** CRC = standard CRC-32 (zlib), 8 hex digits.

## 5. Operations

### Feature detection (`info`)

```json
→ {"op":"info"}
← {"op":"info","ok":true,"firmware":"2.14","linkProtocol":1,"linkRevision":4,"setId":"5f3a91c2","setName":"",
   "pinRequired":false,"generation":7,"storeHash":"0a1b2c3d","freeBytes":1801234,"maxFileSize":16384,
   "maxPathLength":31,"maxRequest":12288,"maxGetChunk":4096,"mtu":247,"programFormat":6,
   "features":["validateInline","listMeta","effects","hold","toggle","reports","remote","liveBle","pause","identify","battery"],
   "blockTypes":["led","delay","button","if","setVariable","remotePress","remoteMultiPress","remoteResetAll",
                 "summary","repeat","effect","charge","release","toggle","communicate"]}
```

A missing field means the old behaviour. `linkProtocol` = frame header version (always 1);
`linkRevision` (missing = 1), link-protocol §7. `programFormat` (missing = 1) = programs.md §6; check it
before uploading programs that use newer blocks or fields. `mtu` (BLE only): write ≤ `mtu − 3` (Web
Bluetooth does not expose it). `features` and fields by firmware:

| fw | Field / feature | Meaning |
|---|---|---|
| 2.2 | `setName` | stored set name (`""` = none), op `setName` |
| 2.3 | `programFormat` | |
| 2.4 | `validateInline` | `validate` accepts `data` (dry run) |
| 2.5 | `listMeta` | `list` reports program metadata |
| 2.6 | `pinRequired` | a PIN is set and this transport (BLE) needs it |
| 2.7 | `mtu` | negotiated ATT MTU (23 until exchanged) |
| 2.8 | `effects` | effect player, op `effect`, `status.pods[].effects` |
| 2.9 | `hold`, `linkRevision` | firmware speaks link revision 2; per pod: `status.pods[].hold`. Block types `effect`, `charge`, `release` and `countdown` need `programFormat` ≥ 3 (and the effect player) |
| 2.10 | `toggle` | block `toggle` (`programFormat` ≥ 4), link revision 3; per pod `status.pods[].toggle` |
| 2.11 | `reports`, `remote` | report buffer, `report` event, ops `reports`/`ack`; ops `command`/`setVariables`/`session`; block `communicate` (`programFormat` ≥ 5) |
| 2.12 | `liveBle`, `pause` | BLE stays in the game (§1), `report` over BLE, `status.ble`, `status.heap`, `reports` paging; ops `pause`/`resume`, `phonePaused` |
| 2.13 | `identify`, `battery` | op `blink`, `pods[].number`/`color`; `status.battery`, `pods[].battery`, `low_battery`; `programFormat` 6 |
| 2.14 | – | `status.powerOff`, `sleep` event |
| 2.15 | `patterns` | op `pattern`; system patterns (architecture §7.1); link revision 5 (colour 10, identity as n LEDs in the new palette) |

**Battery** (`{percent, mv}`, missing = unknown): one Li-ion cell, 3.30 V = 0 %, 4.20 V = 100 %, piecewise
linear (`Battery.cpp`); 16 samples, refreshed every 3 s; on USB it reads the charge voltage (≈ 100 %).
Below 15 % an idle pod blinks amber; below 5 % `start` is refused (`low_battery`, the confirm press flashes
the ring red 1 s).

### `list`
```json
← {"op":"list","ok":true,"generation":7,"storeHash":"0a1b2c3d",
   "files":[{"path":"/programs.json","size":231,"crc":"8c1d0e2f"},
            {"path":"/prog/duo.json","size":1450,"crc":"1f2e3d4c","name":"Duo","peripherals":1,"menu":[{"leds":[8,10],"color":"blue"}]},
            {"path":"/prog/lib/loop.json","size":610,"crc":"5a4b3c2d","fragment":true}],
   "menu":["/prog/solo.json", …]}
```
With `listMeta`: a `/prog/` file with a string `name` is a program (`name`, and `peripherals` / `menu` as in
the file if present); a JSON object without `name` is `"fragment": true`; others get neither. Cached by
path + CRC.

### `get` (chunked)
`{"op":"get","path":…,"offset":0,"length":2048}` → `{…,"offset","size","crc","eof","data"}`. `length`
default 2048, max 4096 bytes. A chunk never splits a UTF-8 character (may be shorter); continue at
`offset + byteLength(data)` until `eof`. `crc` is of the whole file.

### `put` (chunked, atomic)
```json
→ {"op":"put","path":"/prog/my.json","offset":0,"data":"…","final":false}   ← {…,"received":2048}
→ {"op":"put","path":"/prog/my.json","offset":2048,"data":"…","final":true,"crc":"7a6b5c4d"}
← {"op":"put","ok":true,"path":"/prog/my.json","size":3012,"crc":"7a6b5c4d","generation":8}
```
`offset` 0 starts a new upload (discards an unfinished one); further chunks continue at `received`.
`final` defaults to true (small file = one request). The final chunk checks the optional `crc` and JSON
syntax, then replaces the old file atomically. Split between characters, count offsets in bytes. A
program is not in the menu until `/programs.json` is `put`: upload programs and includes first, the menu last.

### `delete`
`{"op":"delete","path":…}` → `{…,"generation":9}`.

### `validate`
`{"op":"validate","path":…}` → `{"ok":true,"blocks":14}` or `invalid_program` ("/prog/x.json: block 'Hit'
has unknown type 'buton'"). Loads with all includes, as the game would, without starting. With `data`
(`validateInline`): dry run of that text; `path` must be valid but need not exist, includes come from the
store (upload changed includes first), nothing is written, the request must fit `maxRequest`.

### Control and test ops

| op | Where | Request | Response / effect |
|---|---|---|---|
| `help` | any | – | list of ops |
| `status` | any | – | `role`, `state`, `firmware`, `uptimeMs`, `setId`, `mtu` (BLE), `store`, `heap {free, minFree}`, `powerOff {idleMs, limitMs, usbHost}`, `battery`, `lastReset {reason, lastStep}`. Central: `program`, `requiredPeripherals`, `radio`, `syncing`, `ble {connected, intervalMs}`, `pods[] {id, mac, alive, lastSeenMs, effects, hold, toggle, number, color, battery, link {txFrames, txRetries, txLost, rxFrames, rxDuplicates, ackUsLast, ackUsAvg, ackUsMax}}`, `block`, `timers {orphanStops}` (RUN/PAUSED, programs.md §7.9), `variables`, `athlete`, `reports {pending, dropped}`, `waiting {block, editable {<name>: {min, max, value}}}` (while a `communicate` block waits), `phonePaused`. Peripheral: `podId`, `central`, `lastPongMs`, `clock {synced, offsetUs}`, `link` |
| `programs` | central | – | `programs[] {index, name, path, peripherals}`, `selected` |
| `select` | central, MENU | `program`: index, path or name | load, radio on, DISCOVERY |
| `start` | central, CONFIRM | – | like the confirm press; `not_ready` while pods are missing; `low_battery` |
| `press` | any | – | simulated short press (not for the menu) |
| `stop` | central | – | ends the program; the pod restarts as central into the menu (clears reports) |
| `effect` | any (`effects`) | `effect` name, `color`, `color2`, `brightness`, `durationMs`, `periodMs`, `segment`, `from`/`to` (dim), `value` (level %), `reverse`, `endOff`, `delayMs`; central also `target`: `"self"` (default), pod id, `"pods"`, `"all"` | test op; common start now + `delayMs` (default 50 ms with pods, else 0). → `effect`, central `startAtUs`, `sent[]`, `skipped[]`. `busy` in a game / while armed |
| `pattern` | any (`patterns`) | `name`: `boot`, `search`, `joined`, `discovery`, `ready`, `select`, `selectCancel`, `selected`, `paused`, `lowBattery`, `sleep`, `menu`; `percent` (boot, 0–100), `podId` (joined), `wanted`, `found` (discovery), `fillMs` (selectCancel), `breathing` (menu) | plays a system pattern (architecture §7.1) on this pod's ring; central: itself only, peripheral: itself. → `pattern`, `durationMs` (0 = endless). `busy` in a game / while armed |
| `blink` | central (`identify`) | `pod`: id, or `-1`/missing = central | 2 s in its identity colour (central white), shown within 0.5 s. Only MENU/DISCOVERY/CONFIRM (`busy`); unknown id `bad_request`; pod fw < 2.8 `not_ready`. → `pod`, `durationMs` 2000 |
| `results` | any | `reset` (bool) | statistics per metric since the last summary |
| `trace` | any, serial | `on` (bool) | `{"event":"block","name","t"}` on every block entry |
| `reboot` | any | `role`: `central`/`peripheral`/`auto` | role for the next start only |
| `auth` | any | `pin` | unlocks writes for this BLE connection (§8); `ok` without a PIN |
| `setPin` | any, **serial only** | `pin`: 4–6 digits, `""` clears | → `pinSet` |
| `setName` | any | `name` ≤ 16 bytes UTF-8, no control chars, `""` clears | NVS, advertised (§2.1); `busy` from DISCOVERY |
| `reports` | central (`reports`) | `from`, `max` (paging, fw ≥ 2.12) | unacknowledged reports, oldest first (fields of the `report` event), `total`, `more`. A full buffer ≈ 20 KB: over BLE use `{"max":2}`, `ack`, repeat while `more` |
| `ack` | central | `reportId` | removes it and all older; unknown ids are fine (`id` is the request id) |
| `command` | central (`remote`) | `name`: `continue`/`repeat`/`stop` | answers a waiting `communicate` block; else `not_ready` |
| `setVariables` | central (`remote`) | `values {name: int}` | only while `communicate` waits, only its `editable`, within min…max, all or nothing → `variables` |
| `session` | central (`remote`) | `athlete` ≤ 40 bytes, `""` clears | opaque id copied into following reports (RAM). MENU/DISCOVERY/CONFIRM or while `communicate` waits, else `busy` |
| `pause` | central (`pause`) | – | RUN → PAUSED with `phonePaused`, current block left; else `not_running` |
| `resume` | central (`pause`) | – | re-enters the block (a `communicate` block keeps its report) → `state` RUN, or PAUSED while a pod is missing; without a phone pause `not_paused` |

**Reports** are RAM only: `stop` and every reboot clear them, ids restart at 1.

**Two kinds of PAUSED** (both whole ring amber, both leave and re-enter the current block: timeouts restart,
presses during PAUSED are dropped, `communicate` builds no second report; `command` / `setVariables` /
`session` behave as in PAUSED: `not_ready` / `busy`):
- pod lost (automatic, 1.5 s silence): continues by itself when all pods are back. `pause` is refused
  (`not_running`) until then.
- phone pause (`phonePaused: true`): only `resume` ends it. A pod lost meanwhile changes nothing; `resume`
  with a pod still missing gives PAUSED with `phonePaused: false` (pod-loss rule).

### Events (serial; `report` also over BLE from fw 2.12)

| Event | Fields |
|---|---|
| `boot` | `role`, `firmware`, `lastReset {reason, lastStep}`; `panic`/`*watchdog`/`brownout` = crash, `lastStep` says where |
| `state` | `state`, `program`, `pods`, `required`, `phonePaused`: every central state change |
| `sleep` | `idleMinutes`: auto power-off (architecture §8.2) |
| `block` | `name`, `t`: only with `trace on` |
| `report` | `id`, `program`, `setId`, `athlete` (if set), `cycle`, `startMs`, `endMs`, `values[] {t, metric, pod, ms}`, `stats {<metric>: {count, average, best, worst}}`, `vars {<name>: value}`, `valuesDropped` (if > 0); programs.md §7.16 |

Text lines: `RESULT,<millis>,<metric>,<pod>,<ms>`, `SUMMARY,<metric>,<count>,<avg>,<best>,<worst>`.
Firmware log lines never start with `{`.

### Serial specifics
115200 baud (ignored by USB); lines end with `\n` or `\r\n`. Text shortcuts: `status`, `select 8`,
`select /prog/duo.json`, `get /prog/solo.json`, `reboot central`, `trace on`, `setPin 1234`,
`setName Halle 2`. Opening the port does not reset the pod. **Never toggle DTR/RTS** (resets the C3,
possibly into download mode).

## 6. Store sync between pods

Every pod keeps the full store; every API change raises the generation; pods compare generation + hash
in PING/PONG and the older one pulls the changed files, CRC-checked and switched together (details:
link-protocol §5.2). Not during RUN. A local change always wins over stores seen before. **Limitation:**
two pods edited separately → only one store survives; edit one pod, let the set sync (start any program
with all pods on), then edit again.

## 7. Typical upload

```
connect "ReactPod <xxxx>", subscribe to Response (indications), request MTU 517
info                          → firmware, programFormat, blockTypes, features
auth (if pinRequired)
put each program + include    (≤ 2048-character chunks, crc on the final chunk)
put /programs.json            (last)
validate each menu program    → show errors
```
Then start any program once with all pods on to spread the store (≈ 0.5 s per pod, estimate).

## 8. Security

No BLE pairing; without a PIN anyone in range can change programs. Optional PIN (fw ≥ 2.6):
- Set / clear over USB only (`setPin`), stored per pod in NVS (not synced: set it on every pod that may be
  central). A lost PIN is cleared with a cable.
- With a PIN, `put`, `delete`, `setName` over BLE return `auth_required` until `auth` on the same
  connection. After a wrong PIN `auth` is refused for 3 s (`auth_failed`).
- Reads (`info`, `list`, `get`, `validate`, …), control ops (`select`, `start`, `stop`, `reboot`, …), MaxLoop
  and USB stay open. The PIN travels in clear text.
