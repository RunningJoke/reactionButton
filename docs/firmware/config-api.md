# Configuration API (BLE and USB serial)

This API lets configuration software (phone app, PC tool) and test scripts read and
write the game programs of a ReactPod set and control a pod. It is reachable over two
transports with the same JSON messages:

| Transport | Where | When | Reference client |
|---|---|---|---|
| BLE | central | program menu only | [tools/reactpod_config.py](../../tools/reactpod_config.py) (`bleak`) |
| USB serial | any pod (central or peripheral) | always | [tools/reactpod_serial.py](../../tools/reactpod_serial.py) (`pyserial`), see [testing.md](testing.md) |

## 1. When the API is available (BLE)

The API runs on the **central** while it shows the **program menu** and, from firmware 2.12
(`info.features` contains `liveBle`), also **during the game**:

1. Switch the pod on and hold the button during the blue boot animation → central.
2. The pod advertises as **"ReactPod <xxxx>"** with service `12345678-1234-1234-1234-1234567890ab`
   (see §2.1). `<xxxx>` are the last 4 hex digits of the `setId`, so several sets in one hall
   can be told apart.
3. Connect, use the API.
4. When a program is selected on the pod (long press), the game starts (ESP-NOW) and the
   BLE connection **stays**. The pod asks for a 100 ms connection interval with peripheral
   latency 0 (supervision timeout 6 s); the phone may answer with another one, see `status.ble`.
   With the phone connected, advertising is off. If the phone disconnects, advertising starts
   again, also during the game, and the phone can reconnect.
5. During DISCOVERY, CONFIRM, RUN and PAUSED the ops that change program files or the set name
   (`put`, `delete`, `setName`) answer `busy`. The other ops work as in the menu (§5). Reports
   and `command` / `setVariables` / `session` are available during the game.

Firmware before 2.12: BLE is switched off when a program is selected (the connection drops),
and the API is available in the menu only. A client must then check `features` for `liveBle`
before it expects the connection to stay.

A central without any programs stays in the menu with a red blink, so programs can
be uploaded to an empty pod.

Changes are taken over **immediately**: after a successful `put` or `delete` the menu is
reloaded. The new programs then spread to all pods of the set automatically (§6).

## 2. GATT layout

| Characteristic | UUID | Properties | Use |
|---|---|---|---|
| Command | `12345678-1234-1234-1234-1234567890b1` | Write, Write without response | requests: client → pod |
| Response | `12345678-1234-1234-1234-1234567890b2` | Indicate, CCCD | responses: pod → client |
| MaxLoop | `12345678-1234-1234-1234-1234567890a7` | Write, Read | ASCII number > 0 overrides `MAX_LOOPS` of the next selected program |

The Response characteristic offers **indications only** (no notify), so every client
subscribes for indications: Web Bluetooth `startNotifications()`, Android and bleak
`start_notify()` pick indications automatically. The pod waits for each indication to be
confirmed, which is the flow control of the responses. (Firmware 2.0 also offered notify;
clients then subscribed for notifications and the pod's responses were dropped.)

The pod requests an MTU of 517. Use the largest MTU your platform allows. The API also
works with the default MTU of 23, just slower.

### 2.1 Advertisement

| Where | Content |
|---|---|
| Advertisement | flags, complete 128-bit service UUID, manufacturer data: company id `0xFFFF` + `setId` (4 bytes, big endian, same digits as `setId` in `info`) |
| Scan response | complete local name, preferred connection interval (if it fits) |

- Name: `ReactPod <last 4 hex digits of setId>`, e.g. `ReactPod 91c2`.
- If a set name was stored with `setName` (§5), the name is `ReactPod <set name>`, e.g.
  `ReactPod Halle 2`. The `ReactPod` prefix stays, so a client can filter by the service UUID
  and the name prefix `ReactPod` (Web Bluetooth: `{services: [...], namePrefix: "ReactPod"}`).
- The name is at most 25 bytes (`ReactPod ` + 16), so it always fits into the scan response.
- The set name is stored on the pod that is central, not synced to the other pods of the set.
  A new name is advertised after the current connection ends.

## 3. Message framing

- Every request and every response is **one JSON object followed by `\n`** (UTF-8, no
  newline inside the JSON).
- A message may be split over any number of BLE writes or indications. The receiver
  collects bytes until `\n`. Write each piece with at most *MTU − 3* bytes.
- Responses are sent as indications, so the pod waits for each one to be confirmed.
- **One request at a time**: wait for the response before sending the next request.
- Maximum request size: 12288 bytes (`maxRequest` in `info`).
- Every request may contain `"id"` (any JSON value). The response echoes it, together with `"op"`.

### 3.1 Responses

Success: `{"op": "...", "id": ..., "ok": true, ...}`

Error: `{"op": "...", "id": ..., "ok": false, "error": "<code>", "message": "<text>"}`

| Error code | Meaning |
|---|---|
| `bad_request` | not JSON, unknown `op`, missing field |
| `bad_path` | path not allowed (see §4) |
| `not_found` | file does not exist |
| `bad_offset` | `get` beyond end of file / `put` not continuing the current upload |
| `too_large` | file > 16384 bytes or request > 12288 bytes |
| `crc_mismatch` | uploaded data does not match the given CRC (nothing stored) |
| `invalid_json` | uploaded file is not valid JSON (nothing stored) |
| `invalid_program` | `validate`: the program cannot be loaded. `message` names file + block |
| `storage` | flash write failed (full?) |
| `overflow` | data arrived faster than the pod could process it. Resend the request |
| `auth_required` | a PIN is set: `put`, `delete`, `setName` over BLE need `auth` first (§8) |
| `auth_failed` | `auth`: wrong PIN, or a retry within 3 s after a wrong PIN |

## 4. Files and paths

The API manages exactly these files:

| Path | Content |
|---|---|
| `/programs.json` | the menu: `{"programs": ["/prog/solo.json", ...]}` in menu order |
| `/prog/<name>` | programs and include fragments (e.g. `/prog/lib/loop.json`) |

Rules:
- Paths are at most **31 characters**, including the leading `/` (SPIFFS limit).
- Allowed characters after `/prog/`: `A–Z a–z 0–9 _ - . /`. No `..`, no `//`, no trailing `/`.
- Content must be valid JSON. The program format is described in [programs.md](programs.md).
- Max file size 16384 bytes.
- **Offsets and sizes count bytes** (UTF-8), not characters.
- CRCs are standard **CRC-32** (as zlib / Python `zlib.crc32`), as 8 hex digits.

## 5. Operations

### `info`
```json
→ {"op":"info"}
← {"op":"info","ok":true,"firmware":"2.13","linkProtocol":1,"linkRevision":4,"setId":"5f3a91c2","setName":"","pinRequired":false,
   "generation":7,"storeHash":"0a1b2c3d","freeBytes":1801234,"maxFileSize":16384,
   "maxPathLength":31,"maxRequest":12288,"maxGetChunk":4096,"mtu":247,"programFormat":4,"features":["validateInline","listMeta","effects","hold","toggle","battery"],
   "blockTypes":["led","delay","button","if","setVariable","remotePress",
                 "remoteMultiPress","remoteResetAll","summary","repeat","effect","charge","release","toggle"]}
```
`setName` is the stored set name (`""` = none, firmware ≥ 2.2). `pinRequired` (firmware ≥ 2.6)
is true if a PIN is set and this transport needs it (BLE), see §8.
`mtu` (firmware ≥ 2.7, BLE only) is the ATT MTU negotiated for this connection (23 until the
client exchanges the MTU). Write at most `mtu − 3` bytes per BLE write. Over USB serial the
field is absent. Web Bluetooth does not tell the page the MTU, so read it here.
`blockTypes` lists what this firmware can run. `programFormat` is the revision of the
block fields, ports and semantics (firmware ≥ 2.3; missing = 1). Each increase is listed in
[programs.md](programs.md) §6. `features` lists optional API features (firmware ≥ 2.4; missing
= none): `validateInline` = `validate` accepts `data` (dry run); `listMeta` = `list` reports
program metadata; `effects` (firmware ≥ 2.8) = the ring effect player: `effect` op,
`status.pods[].effects` ([link-protocol.md](link-protocol.md) §2.1). A program that uses another type fails `validate`.
The `effect` block type and the `countdown` option of the timed blocks (firmware ≥ 2.9) have
no feature flag of their own: they are `programFormat` ≥ 3 (programs.md §6). Check it before
uploading a program that uses them. Both need the effect player (`effects`). The same holds for the block
types `charge` and `release` (firmware ≥ 2.9). `hold` (firmware ≥ 2.9) says that the firmware speaks link protocol
revision 2 (hold reporting, [link-protocol.md](link-protocol.md) §2.2); it is a statement about the firmware, a
peripheral of a set may still be older: `status.pods[].hold`. `linkRevision` (firmware ≥ 2.9; missing = 1) is that
revision; `linkProtocol` is the frame header version and stays 1. `toggle` (firmware ≥ 2.10, link protocol revision 3)
says that the firmware knows the block type `toggle` (`programFormat` ≥ 4) and the toggle activations of
[link-protocol.md](link-protocol.md) §2.3; the pods may still be older: `status.pods[].toggle`.
`identify` (firmware ≥ 2.13) = the op `blink` and `number` / `color` in `status.pods[]` (link protocol revision 4, [link-protocol.md](link-protocol.md) §2.4).
`liveBle` (firmware ≥ 2.12) = BLE stays connected during the game (§1): the `report` event also goes out over BLE, `status.ble`
exists, and `put` / `delete` / `setName` answer `busy` from DISCOVERY on. `reports` (firmware ≥ 2.11) = the report buffer, the `report` event and the ops `reports` / `ack`; `remote`
(firmware ≥ 2.11) = the ops `command`, `setVariables` and `session`. Both come with the block type `communicate`
(`programFormat` ≥ 5, programs.md §7.16). `pause` (firmware ≥ 2.12) = the ops `pause` and `resume` and the
state flag `phonePaused` (below).

`battery` (firmware ≥ 2.13) = the battery level is reported: `battery {percent, mv}` in `status` (the pod itself)
and `pods[].battery` in the central `status` (the peripherals, from their PING, link-protocol.md §2 and §7). `percent` is
the charge of one Li-ion cell (3.30 V = 0 %, 4.20 V = 100 %, piecewise linear, firmware `Battery.cpp`), `mv` the cell voltage.
Missing = unknown (no reading yet, or an older pod). The pod reads the voltage through a 1:1 divider on GPIO 5 (16 samples,
refreshed every 3 s). A pod on USB reads the charge voltage, so it shows nearly 100 % while charging.
Thresholds: below 15 % a pod blinks amber while it is idle (not during a game); below 5 % the central refuses to start
a game (`low_battery`, see `start`). `linkRevision` 4 is the same feature on the link.

### `list`
```json
→ {"op":"list"}
← {"op":"list","ok":true,"generation":7,"storeHash":"0a1b2c3d",
   "files":[{"path":"/programs.json","size":231,"crc":"8c1d0e2f"},
            {"path":"/prog/duo.json","size":1450,"crc":"1f2e3d4c","name":"Duo","peripherals":1,
             "menu":[{"leds":[8,10],"color":"blue"}]},
            {"path":"/prog/lib/loop.json","size":610,"crc":"5a4b3c2d","fragment":true}, ...],
   "menu":["/prog/solo.json","/prog/weiche.json", ...]}
```
Program metadata (firmware ≥ 2.5, `features` contains `listMeta`):
- A file under `/prog/` with a string `name` is a program: `name`, and `peripherals` and
  `menu` exactly as in the file (left out if the file has none).
- A file that is a JSON object without `name` is an include fragment: `"fragment": true`.
- `/programs.json` and files that do not parse get neither.
- The pod caches the metadata by path and CRC, so `list` parses a file only after it changed.

### `get` – read a file (chunked)
```json
→ {"op":"get","path":"/prog/solo.json","offset":0,"length":2048}
← {"op":"get","ok":true,"path":"/prog/solo.json","offset":0,"size":1450,
   "crc":"1f2e3d4c","eof":true,"data":"{\n  \"version\": 1, ..."}
```
- `length` default 2048, max 4096 bytes. `data` holds the file text.
- A chunk never ends inside a UTF-8 character, so `data` may be a few bytes shorter than
  requested. Continue at `offset + byteLength(data)` until `eof` is true.
- `crc` is the CRC of the whole file. Use it to check the result.

### `put` – write a file (chunked, atomic)
```json
→ {"op":"put","path":"/prog/mygame.json","offset":0,"data":"{ ... first part","final":false}
← {"op":"put","ok":true,"path":"/prog/mygame.json","received":2048}
→ {"op":"put","path":"/prog/mygame.json","offset":2048,"data":"... last part }","final":true,"crc":"7a6b5c4d"}
← {"op":"put","ok":true,"path":"/prog/mygame.json","size":3012,"crc":"7a6b5c4d","generation":8}
```
- `offset: 0` starts a new upload. Any unfinished earlier upload is discarded.
- Further chunks must continue at the byte offset reached so far (`received`).
- `final` defaults to true, so a small file is one request without `offset`/`final`.
- On the final chunk the pod checks the optional `crc` and the JSON syntax. Only then
  does the file **replace** the old one. Until then the old file stays untouched.
- Split the text between characters, never inside a multi-byte UTF-8 character. The
  reference client splits the text by characters and counts the offset in bytes.
- Uploading a program does not add it to the menu: also `put` an updated `/programs.json`.
  Upload the program and its includes **first**, the menu last.

### `delete`
```json
→ {"op":"delete","path":"/prog/mygame.json"}
← {"op":"delete","ok":true,"path":"/prog/mygame.json","generation":9}
```

### Control and test operations

Available on both transports. Over BLE they are only useful in the menu, because BLE is
switched off when a program is selected.

| op | Role | Request fields | Response / effect |
|---|---|---|---|
| `help` | any | – | list of ops |
| `status` | any | – | `role`, `state`, `firmware`, `uptimeMs`, `setId`, `mtu` (BLE only), `store`, `heap {free, minFree}` (bytes, firmware ≥ 2.12), `battery {percent, mv}` (firmware ≥ 2.13, missing = unknown), `lastReset {reason, lastStep}`. Central: `program`, `requiredPeripherals`, `radio`, `syncing`, `ble {connected, intervalMs}` (firmware ≥ 2.12, BLE connection; `intervalMs` 0 = not known yet, else the connection interval in ms), `pods[] {id, mac, alive, lastSeenMs, effects, hold, toggle, number, color (firmware ≥ 2.13: `number` 1 … 7 and the identity colour `#rrggbb`), battery (firmware ≥ 2.13, `{percent, mv}`), link {txFrames, txRetries, txLost, rxFrames, rxDuplicates, ackUsLast, ackUsAvg, ackUsMax}}`, `block`, `timers {orphanStops}` (RUN / PAUSED, firmware ≥ 2.8: `timerStop`s without a running timer, programs.md §7.9), `variables`. Peripheral: `podId`, `central`, `lastPongMs`, `clock {synced, offsetUs}`, `link` |
| `programs` | central | – | menu: `programs[] {index, name, path, peripherals}`, `selected` |
| `select` | central, menu | `program`: index, path or name | loads the program, radio on, searching for peripherals. BLE stays connected (firmware ≥ 2.12, §1) |
| `start` | central, CONFIRM | – | starts the program (like the confirm press). `not_ready` while peripherals are missing. `low_battery` (firmware ≥ 2.13) while the central or a pod is below 5 % (the confirm press then flashes the ring red for 1 s) |
| `press` | any | – | simulates a short press of this pod's button (not for the menu) |
| `effect` | any (firmware ≥ 2.8) | `effect` (name), optional `color`, `color2`, `brightness`, `durationMs`, `periodMs`, `segment` (spin), `from` / `to` (dim), `value` (level, %), `reverse`, `endOff`, `delayMs`. Central also `target`: `"self"` (default), a pod id, `"pods"`, `"all"` | test op: plays a ring effect ([link-protocol.md](link-protocol.md) §2.1). Pods and the central start at the same network time, now + `delayMs` (default 50 ms with pods, else 0). Response: `effect`, central also `startAtUs`, `sent[]`, `skipped[]` (pods without effect support). `busy` while a game runs (central) or the pod is armed (peripheral) |
| `blink` | central (firmware ≥ 2.13, feature `identify`) | optional `pod`: a pod id, `-1` or missing = the central itself | blinks that pod for 2 s in its identity colour, or the central white, so that it can be found ([link-protocol.md](link-protocol.md) §2.4). Only in MENU, DISCOVERY and CONFIRM, else `busy`. `bad_request` for an id that is not connected; `not_ready` for a pod with firmware < 2.8. Response: `pod`, `durationMs` (2000). The pod shows it within 0.5 s |
| `stop` | central | – | ends the program; the pod restarts as central into the menu |
| `results` | any | `reset` (bool) | statistics per metric since the last summary |
| `trace` | any | `on` (bool) | serial only: emits `{"event":"block","name":...}` whenever a block is entered |
| `reboot` | any | `role`: `central` / `peripheral` / `auto` | restarts; the role applies to the next start only (`auto` = button decides) |
| `auth` | any | `pin`: string | unlocks `put`, `delete`, `setName` for this BLE connection (§8). `ok` without a PIN set |
| `setPin` | any, **serial only** | `pin`: 4–6 digits as a string; `""` or missing clears it | stores the PIN in NVS. Response: `pinSet`. Serial text form: `setPin 1234` |
| `setName` | any | `name`: string, max 16 bytes UTF-8, no control characters; `""` or missing clears it | stores the set name in NVS, advertised as `ReactPod <name>` (§2.1). Response: `setName`. Serial text form: `setName Halle 2`. `busy` from DISCOVERY on (central, firmware ≥ 2.12) |
| `reports` | central (firmware ≥ 2.11) | optional `from`: number, `max`: number (paging, firmware ≥ 2.12) | `reports[]`: every report in the buffer not acknowledged yet, oldest first, with the fields of the `report` event (without `event`). `from` is an index into those unacknowledged reports (default 0), `max` the number of reports (default all). Without either field all reports are returned. The answer also has `total` (unacknowledged reports) and `more` (true if reports follow this page). A full answer (8 reports) is about 20 KB, so over BLE read it in pages: request `{"max": 2}`, `ack` the ids received, repeat while `more` is true (after an `ack` the indexes move, so `from` is only needed to skip reports that are not acknowledged) |
| `ack` | central (firmware ≥ 2.11) | `reportId`: number | removes that report and all older ones from the buffer. Unknown or already removed ids are fine. `reportId`, not `id`: `id` is the request id (§3) |
| `command` | central (firmware ≥ 2.11) | `name`: `continue`, `repeat` or `stop` | answers a waiting `communicate` block (programs.md §7.16). `not_ready` if no block waits |
| `setVariables` | central (firmware ≥ 2.11) | `values`: object name → integer | only while a `communicate` block waits, only names in its `editable`, within `min` … `max`. All or nothing. Response: `variables` (the new values). Errors: `not_ready`, `not_editable`, `out_of_range` |
| `session` | central (firmware ≥ 2.11) | `athlete`: string, max 40 bytes; `""` clears it | an opaque athlete id copied into every following report (RAM, lost on reboot). Allowed in MENU, DISCOVERY, CONFIRM and while a `communicate` block waits, else `busy`. Response: `athlete` |
| `pause` | central (firmware ≥ 2.12, feature `pause`) | – | pauses a running game from the phone: state PAUSED, all yellow, the current block is left (see below). Only in RUN, else `not_running`. Response: `state` (`PAUSED`) |
| `resume` | central (firmware ≥ 2.12, feature `pause`) | – | ends a phone pause: the current block is re-entered (a `communicate` block keeps its report, programs.md §7.16) and the game continues. Only after a `pause`, else `not_paused`. Response: `state` (`RUN`, or `PAUSED` while a peripheral is still missing) |

Reports (firmware ≥ 2.11, `reports` and `remote` in `info.features`): the report buffer is
RAM only, so `stop` (which restarts the pod) and every reboot clear it, and report ids start
again at 1. Reports reach a client as `report` events over USB serial and, from firmware 2.12
(`liveBle`), over BLE as indications (§1); over BLE read them with `reports` in pages. Central `status` then also has `athlete` (`""` = none), `reports {pending, dropped}`
and, while a `communicate` block waits, `waiting {block, editable {<name>: {min, max, value}}}`.
Central `status.phonePaused` (firmware ≥ 2.12) is true while a phone pause holds the game (state PAUSED).

`pods[].effects` (firmware ≥ 2.8): the pod plays ring effects. `false` for pods with older
firmware; effects then fall back to a static colour on that pod.
`pods[].hold` (firmware ≥ 2.9): the pod measures holds (link protocol revision 2). `false` for pods with older
firmware; the `charge` and `release` blocks then take their `timeout` port at once for that pod.
`pods[].toggle` (firmware ≥ 2.10): the pod flips colours on its own (link protocol revision 3). `false` for pods with
older firmware; the `toggle` block leaves such a pod out of the game.

Error codes in addition to §3.1: `busy` (not possible in the current state, e.g. file
changes from DISCOVERY on, a validate during a game, or a sync), `not_ready`, `low_battery` (start, firmware ≥ 2.13), `not_editable`,
`out_of_range` (`setVariables`), `not_running` (`pause`: the game is not in RUN), `not_paused`
(`resume`: no phone pause is active).

**Pause and resume (firmware ≥ 2.12).** There are two kinds of PAUSED. Both show state `PAUSED`, all yellow:
- *Peripheral lost* (automatic): a pod silent for 1.5 s. The game continues by itself when all pods are back.
- *Phone pause* (`pause`, `phonePaused: true`): the game does not continue by itself. Only `resume` ends it.

Both leave the current block and re-enter it on the way back (programs.md §7.1, §7.16): the timeouts
restart, and a `communicate` block builds no second report. Presses that arrive while PAUSED are dropped
when the game continues. The two kinds combine like this:
- `pause` in RUN gives PAUSED with `phonePaused: true`. A peripheral lost while RUN is detected first, as
  usual; `pause` is then refused (`not_running`) until the peripheral is back.
- A peripheral lost while phone-paused changes nothing. With all pods back, `resume` is still needed.
- `resume` with all pods back gives RUN. With a peripheral still missing, the state stays PAUSED with
  `phonePaused: false`: the game continues when that peripheral is back (the pod-loss rule).
- `command`, `setVariables` and `session` behave as in any PAUSED state (`not_ready` / `busy`).

### Events (USB serial)

Besides responses, the serial port carries event lines, also one JSON object per line:

| Event | Fields |
|---|---|
| `boot` | `role`, `firmware`, `lastReset {reason, lastStep}`: after every start. `reason` = `panic`/`*watchdog`/`brownout` means a crash, `lastStep` says where |
| `state` | `state`, `program`, `pods`, `required`, `phonePaused` (bool, firmware ≥ 2.12): every central state change (MENU, DISCOVERY, CONFIRM, RUN, PAUSED, ERROR) |
| `sleep` | `idleMinutes` (firmware ≥ 2.14): the pod goes to deep sleep after the auto power-off time (architecture.md §8.2). It wakes on a press of the top, with a normal boot (`boot` event) |
| `block` | `name`, `t`: only while `trace` is on |
| `report` | firmware ≥ 2.11, from a `communicate` block (programs.md §7.16): `id`, `program`, `setId`, `athlete` (if set), `cycle`, `startMs`, `endMs`, `values[] {t, metric, pod, ms}`, `stats {<metric>: {count, average, best, worst}}`, `vars {<name>: value}`, `valuesDropped` (if > 0) |

```json
{"event":"report","id":17,"program":"/prog/dreieck.json","setId":"1a2b3c4d","athlete":"ath_42",
 "cycle":3,"startMs":120400,"endMs":165210,
 "values":[{"t":121003,"metric":"reaction","pod":1,"ms":312},{"t":165100,"metric":"lap","pod":0,"ms":44097}],
 "stats":{"reaction":{"count":1,"average":312,"best":312,"worst":312},"lap":{"count":1,"average":44097,"best":44097,"worst":44097}},
 "vars":{"RUNS":12,"MAX_LOOPS":12}}
```

Measurements are printed as text lines `RESULT,<millis>,<metric>,<pod>,<ms>` and
`SUMMARY,<metric>,<count>,<avg>,<best>,<worst>`. Firmware log lines never start with `{`.

### Serial specifics

- 115200 baud (ignored by the USB port), lines end with `
` or `

`.
- Besides JSON, a short text form is accepted for manual use: `status`, `select 8`,
  `select /prog/duo.json`, `get /prog/solo.json`, `reboot central`, `trace on`.
- Opening the port does not reset the pod. Do not toggle DTR/RTS: on the ESP32-C3 that
  resets the chip, possibly into download mode.

### `validate` – check a program on the pod
```json
→ {"op":"validate","path":"/prog/mygame.json"}
← {"op":"validate","ok":true,"path":"/prog/mygame.json","blocks":14}
← {"op":"validate","ok":false,"error":"invalid_program",
   "message":"/prog/mygame.json: block 'Hit' has unknown type 'buton'"}
```
Loads the program with all includes, exactly as the game would, without starting it.
Run it after uploading all files of a program.

**Dry run** (`features` contains `validateInline`, firmware ≥ 2.4):
```json
→ {"op":"validate","path":"/prog/mygame.json","data":"{ \"version\": 1, ... }"}
← {"op":"validate","ok":true,"path":"/prog/mygame.json","blocks":14}
```
- With `data`, the program text is taken from the request instead of the file at `path`.
  `path` must be a valid path (§4) and is used in messages, but the file need not exist.
- Includes are still read from the store, so upload changed includes first, or validate a
  program whose includes are unchanged.
- Nothing is written, the generation does not change.
- The whole request must fit into `maxRequest` (12288 bytes, after JSON escaping). Validate
  larger programs after the upload, as above.
- Errors as above (`invalid_program` with file and block name); `bad_path` for an invalid path.

## 6. Synchronisation between pods

Any pod can be the central, so every pod keeps a full copy of the program store.

- Every change through this API increases the store **generation** (see `info`/`list`).
- When the pods meet over ESP-NOW (after a program was selected, while no game runs),
  they compare generation and content hash in every PING/PONG. The pod with the older
  store **pulls** the newer one: manifest first, then only the changed files. Each file
  is checked against its CRC, and all files are switched together at the end. Files the
  source does not have are deleted.
- Sync works in both directions: a store edited on any pod spreads to the whole set.
- Sync pauses while a game runs and continues in the menu-to-game phases (discovery,
  confirm) or during a pause.
- A local change always gets a generation above every generation the pod has seen. So an
  upload to a pod that was offline for a while still wins over the older set.
- **Limitation**: if two pods are edited separately before they meet again, only one
  store survives (higher generation, then higher hash). Edit one pod, let the set sync
  (start any program once with all pods on), then edit again.

Details of the pod-to-pod part: [link-protocol.md](link-protocol.md) §5.2.

## 7. Typical handover from configuration software

```
connect "ReactPod <xxxx>", subscribe to Response, (request MTU 517)
info                              → check firmware / blockTypes
auth (if info.pinRequired)        → ask the user for the PIN
for each program file and include:
    put (chunks of ≤ 2048 characters, crc on the final chunk)
put /programs.json                → new menu, pod reloads it
validate each program in the menu → show errors to the user
disconnect
```

On the pod: select any program once with all pods switched on, to spread the new programs
to the whole set (about 0.5 s per pod for a typical program set; estimate).

## 8. Security

There is no BLE pairing. Without a PIN, anyone in BLE range can change programs while a
central is in the program menu. This is acceptable for a training device.

**Optional PIN** (firmware ≥ 2.6) for public places:
- Set it over USB serial: `{"op":"setPin","pin":"1234"}` (4–6 digits, stored in NVS on that
  pod). Clear it with `{"op":"setPin","pin":""}`. `setPin` is refused over BLE, so a lost PIN
  can always be cleared by the owner with a USB cable.
- With a PIN set, `info` over BLE reports `"pinRequired": true`. `put`, `delete` and `setName`
  over BLE then return `auth_required` until the client sent `{"op":"auth","pin":"1234"}` on
  the **same connection**. The authentication ends with the connection.
- Read ops (`info`, `list`, `get`, `validate`, …) stay open. USB serial never needs the PIN.
- After a wrong PIN, `auth` is refused for 3 s (`auth_failed`), which makes guessing a
  4-digit PIN take hours.
- The PIN is stored per pod, not synced. Set it on every pod that may become the central.
- Not covered: the control ops (`select`, `start`, `stop`, `reboot`, …) and the MaxLoop
  characteristic stay open. The PIN travels in clear text (no BLE encryption).
