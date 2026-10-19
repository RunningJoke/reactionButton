# Configuration API (BLE and USB serial)

This API lets configuration software (phone app, PC tool) and test scripts read and
write the game programs of a ReactPod set and control a pod. It is reachable over two
transports with the same JSON messages:

| Transport | Where | When | Reference client |
|---|---|---|---|
| BLE | central | program menu only | [tools/reactpod_config.py](../tools/reactpod_config.py) (`bleak`) |
| USB serial | any pod (central or peripheral) | always | [tools/reactpod_serial.py](../tools/reactpod_serial.py) (`pyserial`), see [testing.md](testing.md) |

## 1. When the API is available (BLE)

The API runs on the **central** while it shows the **program menu**:

1. Switch the pod on and hold the button during the blue boot animation → central.
2. The pod advertises as **"ReactPod <xxxx>"** with service `12345678-1234-1234-1234-1234567890ab`
   (see §2.1). `<xxxx>` are the last 4 hex digits of the `setId`, so several sets in one hall
   can be told apart.
3. Connect, use the API.
4. When a program is selected on the pod (long press), BLE is switched off and the game
   starts (ESP-NOW). The connection drops.

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
← {"op":"info","ok":true,"firmware":"2.6","linkProtocol":1,"setId":"5f3a91c2","setName":"","pinRequired":false,
   "generation":7,"storeHash":"0a1b2c3d","freeBytes":1801234,"maxFileSize":16384,
   "maxPathLength":31,"maxRequest":12288,"maxGetChunk":4096,"mtu":247,"programFormat":1,"features":["validateInline","listMeta"],
   "blockTypes":["led","delay","button","if","setVariable","remotePress",
                 "remoteMultiPress","remoteResetAll","summary"]}
```
`setName` is the stored set name (`""` = none, firmware ≥ 2.2). `pinRequired` (firmware ≥ 2.6)
is true if a PIN is set and this transport needs it (BLE), see §8.
`blockTypes` lists what this firmware can run. `programFormat` is the revision of the
block fields, ports and semantics (firmware ≥ 2.3; missing = 1). Each increase is listed in
[programs.md](programs.md) §6. `features` lists optional API features (firmware ≥ 2.4; missing
= none): `validateInline` = `validate` accepts `data` (dry run); `listMeta` = `list` reports
program metadata. A program that uses another type fails `validate`.

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
| `status` | any | – | `role`, `state`, `firmware`, `uptimeMs`, `setId`, `store`, `lastReset {reason, lastStep}`. Central: `program`, `requiredPeripherals`, `radio`, `syncing`, `pods[] {id, mac, alive, lastSeenMs, link {txFrames, txRetries, txLost, rxFrames, rxDuplicates, ackUsLast, ackUsAvg, ackUsMax}}`, `block`, `variables`. Peripheral: `podId`, `central`, `lastPongMs`, `clock {synced, offsetUs}`, `link` |
| `programs` | central | – | menu: `programs[] {index, name, path, peripherals}`, `selected` |
| `select` | central, menu | `program`: index, path or name | loads the program, BLE off, radio on, searching for peripherals |
| `start` | central, CONFIRM | – | starts the program (like the confirm press). `not_ready` while peripherals are missing |
| `press` | any | – | simulates a short press of this pod's button (not for the menu) |
| `stop` | central | – | ends the program; the pod restarts as central into the menu |
| `results` | any | `reset` (bool) | statistics per metric since the last summary |
| `trace` | any | `on` (bool) | serial only: emits `{"event":"block","name":...}` whenever a block is entered |
| `reboot` | any | `role`: `central` / `peripheral` / `auto` | restarts; the role applies to the next start only (`auto` = button decides) |
| `auth` | any | `pin`: string | unlocks `put`, `delete`, `setName` for this BLE connection (§8). `ok` without a PIN set |
| `setPin` | any, **serial only** | `pin`: 4–6 digits as a string; `""` or missing clears it | stores the PIN in NVS. Response: `pinSet`. Serial text form: `setPin 1234` |
| `setName` | any | `name`: string, max 16 bytes UTF-8, no control characters; `""` or missing clears it | stores the set name in NVS, advertised as `ReactPod <name>` (§2.1). Response: `setName`. Serial text form: `setName Halle 2` |

Error codes in addition to §3.1: `busy` (not possible in the current state, e.g. file
changes during a game or a sync), `not_ready`.

### Events (USB serial)

Besides responses, the serial port carries event lines, also one JSON object per line:

| Event | Fields |
|---|---|
| `boot` | `role`, `firmware`, `lastReset {reason, lastStep}`: after every start. `reason` = `panic`/`*watchdog`/`brownout` means a crash, `lastStep` says where |
| `state` | `state`, `program`, `pods`, `required`: every central state change (MENU, DISCOVERY, CONFIRM, RUN, PAUSED, ERROR) |
| `block` | `name`, `t`: only while `trace` is on |

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
