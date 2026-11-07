# Pod link protocol (ESP-NOW) and phone BLE

Code: `Link/Protocol.h` (wire format), `Link/EspNowLink` (transport), `Roles/Central/PodNetwork`,
`Roles/Peripheral/PeripheralRole`, `Store/StoreSync`, `Roles/Central/PhoneConfig`.

## 1. Radio

WiFi station, no AP, channel `ESPNOW_CHANNEL` = 1 (same on all pods), no encryption (frames filtered by
version and set id). Power save: `WIFI_PS_MIN_MODEM` while the BT controller is on (always on a central
since fw 2.12; `WIFI_PS_NONE` aborts the driver with BT), else `WIFI_PS_NONE`; ESP-NOW frames are still
received. Frames ≤ 250 bytes; game frames ≤ 72 (toggle ARM), only sync responses are large.

## 2. Frames

Header (8 bytes, packed, LE): `magic` u8 `0x52` · `version` u8 = 1 (other versions ignored; never changed
by compatible extensions, §7) · `type` u8 · `seq` u8 (per sender, kept on retransmission → dedupe) ·
`setId` u32 (0 = unpaired peripheral).

| Type | Dir | Payload | Purpose |
|---|---|---|---|
| `HELLO` | P → bcast | fwMajor, fwMinor | unclaimed peripheral, every 250 ms |
| `CLAIM` | C → P | podId | take into the set |
| `CLAIM_ACK` | P → C | podId, linkFeatures (≥ 2.8) | accept, announce features (§7) |
| `PING` | P → C | t1 (stamped at tx), store generation + hash, batteryMv (≥ 2.13), otaState + otaPercent (≥ 2.20) | heartbeat 200 ms, clock sync, store state, battery, firmware update state |
| `PONG` | C → P | t1, t2 (rx), t3 (tx), store generation + hash, flags (bit 0 sync allowed, bit 1 identify, bit 2 ota, bit 3 ota pull) | clock sync, store state, firmware update (§5.3) |
| `ARM` | C → P | cmdSeq, mode, colorActive, colorAfter, startAtUs; appended: waiting EffectDesc (≥ 2.8), HoldParams (≥ 2.9, CHARGE/RELEASE), toggle params (≥ 2.10, TOGGLE) | light now (`startAtUs` 0) or at a central-clock time |
| `RESET` | C → P | – | off, cancel pending activation |
| `PRESSED` | P → C | podId, cmdSeq, result (HIT/AVOID_HIT), reactionUs; appended owner + flipCount (TOGGLE) | press while active; CHARGE/RELEASE: hold started; TOGGLE: flipped |
| `SYNC_READ_REQ` | either | reqId, offset, path (32 bytes) | read a store file chunk, `@manifest`, or (≥ 2.20) the update image `@ota` (§5.3) |
| `SYNC_READ_RESP` | either | reqId, status, offset, total, len, data ≤ 200 | the chunk |
| `EFFECT` (11) | C → P | EffectDesc, startAtUs (i64, 0 = now) | ring effect (only to pods with `effects`) |
| `RELEASED` (12) | P → C | podId, cmdSeq, flags, heldMs, reactionUs, chargeMs | end of a hold (§2.2) |
| `OTA_OFFER` (13) | C → P | size u32, sha256 [32], flags u8, version char[12] | start a firmware update of the pod (§5.3), acked, repeated |
| `OTA_ACTIVATE` (14) | C → P | sha256 prefix [8] | boot the received image (§5.3), acked |
| `OTA_CHUNK` (15) | C → bcast | index u16, data ≤ 200 | one chunk of the image, no ack (§5.3) |

PodMode: `1 HIT`, `2 AVOID`, `3 CHARGE`, `4 RELEASE`, `5 TOGGLE`. Colour indices: `0 red, 1 green,
2 blue, 3 yellow, 4 magenta, 5 cyan, 6 white, 255 off`; `7 orange`, `8 violet`, `10 cream` = identity colours
(10 from revision 5, fw 2.15), never sent by a central. `9 amber` is local to a pod (its own battery warning),
never sent by a central.

### 2.1 Effects (fw ≥ 2.8)

Described once with a start time on the synced clock; each pod computes its frames: frame = f(now −
start), so pods with the same start show the same frame and a late pod joins mid-animation.

`EffectDesc` (12 bytes): `effect` u8 · `color` u8 · `color2` u8 (target of `colorShift`, background of
the others, 255 dark) · `brightness` u8 (`dim`: end) · `durationMs` u32 (periodic: 0 = endless) ·
`periodMs` u16 (0 = 1000) · `param` u8 (`spin` segment, 0 = 3; `dim` start brightness; `level` percent) ·
`flags` u8 (bit 0 `reverse`, bit 1 `endOff`).

| Id | Name | Frames | End |
|---|---|---|---|
| 0 | `none` | EFFECT: stop + off; ARM: no waiting effect | – |
| 1 | `solid` | all `color` | static |
| 2 | `fill` | LED n lights at n/18 of `durationMs` | full |
| 3 | `drain` | full, LEDs go out one by one | `color2` |
| 4 | `dim` | brightness `param` → `brightness`, linear | `brightness` |
| 5 | `colorShift` | RGB blend `color` → `color2` | `color2` |
| 6 | `trafficLight` | green, yellow, red, ⅓ each | red |
| 7 | `blink` | `color` first half of a period, `color2` second | `color` |
| 8 | `pulse` | `brightness` → 0 → `brightness` per period (eased) | `color` |
| 9 | `spin` | `param` LEDs of `color` turn once per period on `color2` | `color` |
| 10 | `level` | first `param` % in `color`, rest `color2` | static |

Effects start with a visible frame, so reaction times from the first LED update mean the same as with a
static colour. Unknown id → ignored (ARM shows `colorActive`). The pod's brightness cap is not on the link.

- **EFFECT** changes only the LEDs, not the state; the next ARM / press / RESET replaces it. Urgent, 5 retries.
- **ARM waiting effect** (appended): played instead of `colorActive` while waiting, timed from `startAtUs`
  (or the activation). Only sent to pods with `effects`; `colorActive` is the static fallback. Programs
  use it for countdowns (programs.md §7.12).

### 2.2 Hold activations (revision 2, fw ≥ 2.9)

For `charge` / `release` (programs.md §7.13, §7.14). Only pods with `hold` get them; for others the block
takes `timeout` at once. The central sends one ARM; the pod measures, animates and reports PRESSED (hold
start) and RELEASED (end). ARM: waiting effect (may be `none`) + `HoldParams`; `colorActive` = idle colour,
`colorAfter` = after the end, `startAtUs` 0. A hold ARM without HoldParams is ignored.

`HoldParams` (36 bytes): `flags` u8 (bit 0 `allowHeld` RELEASE, bit 1 `signal` RELEASE, bit 2 `accumulate`
CHARGE) · `heldColor` u8 · `goColor` u8 · reserved u8 · `onsetMs` u32 · `maxMs` u32 (≥ 1) · `decayMs` u32
(0 = keep) · `goDelayMs` u32 · `limitMs` u32 (accumulate time limit, 0 = none) · `effect` EffectDesc (CHARGE:
the charge with `durationMs = maxMs`; RELEASE trigger: countdown over `maxHoldMs` from the hold start;
signal: countdown over `timeoutMs` from the switch; `none` = static `heldColor` / `goColor`).

Pod (`HoldSession`, the central runs the same code for its own button):
- Only a press edge after the activation starts a hold (except RELEASE `allowHeld`: starts at activation).
  Each hold start sends PRESSED (`reactionUs` = activation → press, 0 if already held).
- CHARGE: frame frozen at the current charge at hold start, runs from `start + onsetMs` (a charge of `c` ms
  = effect started `c` ms in the past); draining (`decayMs`) redraws ≈ every 33 ms. Full → flash (200 ms
  period, 600 ms, dark), RELEASED with `full` at once.
- RELEASE `signal`: switch at `hold start + goDelayMs`; release before = false start; `reactionUs` = switch
  (LED update) → release.
- All times from button edge timestamps on the pod.

`RELEASED` (23 bytes): `podId`, `cmdSeq` u8 · `flags` u8 (bit 0 `falseStart`, bit 1 `full`, bit 2 `limit`,
bit 3 `early`) · `heldMs` u32 (accumulate with full/limit: all holds) · `reactionUs` i32 (signal, else 0) ·
`chargeMs` u32. A release of an accumulating charge is not reported. Urgent, 8 retries, after the PRESSED
of the same hold. The pod keeps its ring until ARM / RESET; the central sends RESET after every end
except `full`.

### 2.3 Toggle activations (revision 3, fw ≥ 2.10)

For `toggle` (programs.md §7.15). Only pods with `toggle`; others are left out. The pod flips between team
colours itself (no round trip). ARM (72 bytes, shorter is ignored): waiting effect (game countdown, may be
`none`), zeroed HoldParams, then `startOwner` u8 (0 A, 1 B, 2 nobody: dark until the first press makes it
A) · reserved u8 · `cooldownMs` u16 (presses closer than this to the last accepted one are ignored; the
first always counts). `colorActive` = team A, `colorAfter` = team B.

PRESSED adds `owner` u8 (after this press) and `flipCount` u16 (accepted flips since ARM). The central takes
the owner from the newest PRESSED, drops frames whose `flipCount` is not higher, and counts skipped ones
(lost frames). With a countdown, a flip replays the effect in the new colour with the **original** start.
The pod stays armed until RESET / next ARM; the central ends the game with a plain HIT ARM in the final
colour (its PRESSED has another `cmdSeq`).

### 2.4 Pod identity (revision 4, fw ≥ 2.13; revision 5, fw ≥ 2.15)

Number 1…7 (pod id + 1), fixed colour from `Identity::PALETTE`; reported as `status.pods[].number`, `color`
(`#rrggbb`).
- Palette: revision 4 (2.13–2.14) red, green, blue, magenta, cyan, orange, violet. Revision 5 (2.15) blue,
  cyan, violet, magenta, yellow, orange, cream (pods 1 … 7).
- Shown as n LEDs from LED 0 (pod 3 = LEDs 0–2), as in revision 4.
- PONG flag bit 1 `identify`: set in MENU, DISCOVERY, CONFIRM. While set, a claimed pod plays JOINED
  (architecture §7.1): its LED flashes twice after a claim, then stays at 30 %; LEDs 8–17 breathe green.
  Flag cleared: dark. Revision 4: the number spins (one turn / 3 s). Older pods ignore the bit (no feature bit).
- Never in RUN / PAUSED; ARM always takes the ring. Low battery (< 15 %, idle) plays LOW_BATTERY instead.
- `blink` op: EFFECT `blink` in the pod's colour, 500 ms period, 2 s, end off (pods with `effects`); the
  central blinks white.
- Unclaimed: revision 5 plays SEARCH (amber spot over LEDs 8–17, not synced). Revision 4: yellow with a
  2-LED segment, colour and position from the MAC.

## 3. Transport rules (`EspNowLink`)

- Unicast is reliable and ordered per peer: one frame on air per peer; next after the ESP-NOW ack. Retries:
  ARM/RESET/EFFECT 5, PRESSED/RELEASED 8, CLAIM 3, PING/PONG 0. Tx timeout 100 ms per attempt. Queue 8
  frames per peer (oldest unsent dropped when full).
- Urgent (ARM, RESET, EFFECT, PRESSED, RELEASED) skip ahead of PING/PONG, stay ordered among themselves.
- Duplicates dropped by `seq`. Clock-sync timestamps written right before tx, taken in the rx callback.
- Broadcast (HELLO) is not acked.

## 4. Sequences

- **Join:** P sends HELLO (stored setId or 0) → central in DISCOVERY accepts setId 0 or its own → CLAIM
  (next free id; one at a time, ids without gaps) → P stores setId, CLAIM_ACK, READY → PING/PONG every 200 ms.
- **Activation:** ARM(cmdSeq n) → P lights, `t0` → press → PRESSED(n, dt µs) → block matches pod + cmdSeq
  (stale events ignored) → RESET.
- **Synchronous start:** every pod gets `startAtUs` = now + `syncStartMs` (default 20 ms) on the central
  clock and converts it; the central lights itself at the same time (esp_timer). An ARM that arrives late
  lights at once and measures from its actual onset.
- **Effects on several pods:** EFFECT with the same start to each; nothing more is sent while it runs.

## 5. Pairing, supervision, recovery

| Situation | Behaviour |
|---|---|
| New pod (setId 0) | any central claims it; it adopts the set id |
| Pod of another set | ignored |
| Central without set id | random id on the first program start, stored in NVS |
| Clear pairing | unclaimed peripheral, hold 3 s → white flash, setId 0 |
| Pod silent > 1.5 s | central PAUSED (whole ring amber, §7.1 of architecture) |
| No PONG > 2 s | peripheral → UNCLAIMED |
| `stop` on the central | RESET to every pod (READY, off), PONG goes on in the MENU: the pods stay claimed, no reboot, no new frame |
| Pod back | re-claimed with its old id; all back → current block restarted |

All pods of a set share one set id, so any of them can be the central.

### 5.1 Clock sync
`offset = ((t2 − t1) + (t3 − t4)) / 2` (central = local + offset), `delay = (t4 − t1) − (t3 − t2)`. Last 8
samples, the one with the smallest delay wins. Drift (±20 ppm) is small against the 200 ms period.

### 5.2 Program store sync
- Every pod keeps the full store (`/programs.json`, `/prog/…`). Store state = generation (u32, NVS, +1 per
  local change) + CRC-32 of the manifest, in every PING/PONG.
- Newer = higher generation, then higher hash; the older pod pulls (both directions).
- Pull: `@manifest` (`path\tsize\tcrc-hex\n`, sorted) → each missing/different file into `/t/<n>`, checked
  by size + CRC → all renamed into place together, files not in the manifest deleted, generation taken
  over. Stop-and-wait, 300 ms timeout, 5 retries; on failure discard and retry after 3 s. Never half-replaced.
- Allowed in DISCOVERY, CONFIRM, PAUSED (PONG flag `sync allowed`); never in RUN (a running pull pauses).
- A local change (config API) takes a generation above every one seen (`seenGen`, NVS).
- Two pods edited separately before they meet: only one store survives.

### 5.3 Firmware update of the peripherals (revision 6, fw ≥ 2.20, `LINK_FEATURE_OTA`)

The central holds a verified image in its inactive app slot (config-api "Firmware update") and hands it to the
peripherals while it keeps running the old firmware, so the set stays playable until everything is ready. The
central op `otaDistribute` (valid from MENU) starts it: state `DISTRIBUTING`, ESP-NOW on, pods claimed as in
DISCOVERY (also pods that join later), program store sync off. `otaAbort`, `stop` or an `otaActivate` end it.

- **Supervision.** The central sets `PONG_FLAG_OTA` (bit 2) in every PONG while it distributes. A pod in `UPDATE`
  that gets a PONG without it discards its update and is `READY` again (this is how `otaAbort` reaches the
  pods; no frame can be lost). The pods go on with PING/PONG, so `txLost` and the 1.5 s supervision work as
  usual. A pod that loses the central (2 s without PONG) is unclaimed and discards the update.
- **`OTA_OFFER`** (acked by the radio, 5 retries; the central repeats it every 1.5 s while the pod reports no state).
  `flags` bit 0 = `broadcast`: the image will come as `OTA_CHUNK` first and the pod pulls only after the central
  sets `PONG_FLAG_OTA_PULL` (bit 3). A pod that does not know the flag pulls at once, which works as well. The pod:
  - refuses below 30 % battery (PING `otaState` 5);
  - otherwise reports `PREPARING` (PING sent first), erases the whole slot with a full-size `esp_ota_begin` (about
    4 s; it hears nothing meanwhile, so the central waits for `RECEIVING` before it starts a broadcast), then reports
    `RECEIVING`. The pod does not take the 4 s of silence for a lost central. `OTA_WITH_SEQUENTIAL_WRITES` is never
    used (it cannot recover from a lost chunk).
- **`PING` `otaState`** (appended, 0 = no update): 1 preparing, 2 receiving, 3 ready (complete, SHA-256 and image
  checked), 4 failed, 5 low battery. `otaPercent` = chunks received, 0 … 100. A PING without the fields (older firmware,
  `frameSize` stays the old minimum) means 0.
- **Pull (unicast, one at a time).** The pod asks for chunk i with `SYNC_READ_REQ` path `@ota`, offset 200 · i, the
  central answers with `SYNC_READ_RESP` from the slot (`NOT_FOUND` if it holds no verified image). Stop-and-wait,
  300 ms timeout, 5 retries, then a pause of 2 s and on. The pod keeps a bitmap of the chunks it has (about 700 B for 1.1 MB)
  and writes each with `esp_ota_write_with_offset`, in any order; when the bitmap is full it hashes the slot and
  runs `esp_ota_end`. The central offers the image to one pod at a time (the lowest id without it) and waits until that
  pod no longer reports `PREPARING` / `RECEIVING` or is lost, then offers to the next. A pod that reboots mid-transfer
  reports 0 again after its next claim and is offered the image again, a pod that is skipped because it was off is
  served after the others. A pod that already runs the offered version (central knows it from the pod's `HELLO`) is
  skipped (`current`).
- **Broadcast (`otaDistribute` mode `broadcast`, or `auto` with two or more pods).** After a join window of 2 s the
  central offers to all pods with the `broadcast` flag and waits (at most 20 s) until none reports `PREPARING`.
  Then it sets the radio rate to 1M (`esp_wifi_config_espnow_rate`, it sticks until reboot) and sends every chunk
  as `OTA_CHUNK` to the broadcast address, one frame per 4 ms (#122: 0 loss; 2 ms overruns the driver, 24M and 54M
  lose frames). The pods write what they hear. Afterwards `PONG_FLAG_OTA_PULL` is set: every pod pulls the chunks it
  misses with the unicast `@ota` pull (below 1 s per pod for the 0 … 3 % measured). Pods that got no offer in time are
  served one at a time like in the unicast mode. A second broadcast pass is not implemented: the pull of what is missing
  is shorter than a second pass, and nothing in the protocol tells the central how much each pod misses.
- **`OTA_ACTIVATE`** (acked, 5 retries) to every pod in state `ready` (the first 8 bytes of the hash say which image;
  a pod that holds another one ignores it). The pod selects the slot, keeps its role (peripheral) and restarts, then runs
  the rollback self-test (architecture §4.1) and joins again by the normal claim. The central then restarts too, as
  a central. A pod of the old firmware (after a rollback or because it was not ready) is listed in `status.pods[].firmware`.
- Game, sync and other traffic: the central does not run a game or the store sync during `DISTRIBUTING`; PING/PONG
  continue (the pods need them). Not measured: ESP-NOW speed while a phone is connected to the central over BLE.

## 6. Phone (BLE, central only)

BLE runs from boot through the game (fw ≥ 2.12, `liveBle`; before: switched off at program select).
- Connection interval: after `select` (and for a phone connecting in a game) the central requests 100 ms
  (80 units), latency 0, supervision 6 s; the result is in `status.ble.intervalMs` (0 = unknown).
- Advertising stops while connected, restarts on disconnect (also in a game).
- Responses and `report` events go into an 8-line queue, indicated by a task at priority 2; the game loop
  never waits. Full queue or no phone → line dropped (reports stay in the buffer, read with `reports`).
- `PhoneConfig::service()` runs in every state; file changes answer `busy` from DISCOVERY on.
- GATT and advertisement: config-api §2.

## 7. Compatibility

Version 1 (fw 2.0) is incompatible with fw 1.x. Within version 1, sets may mix firmware:
- New fields are appended; `Protocol::frameSize` stays the old minimum, receivers read a field only if the
  frame is long enough. New types are ignored by older pods.
- `CLAIM_ACK.linkFeatures` (short ACK = 0); the central keeps it per pod, sends feature frames only to
  pods that have it, reports it in `status.pods[]`.

| Bit | Feature | fw | Meaning | Without it |
|---|---|---|---|---|
| 0 | `effects` | 2.8 | EFFECT, ARM waiting effect | static colour |
| 1 | `hold` | 2.9 | CHARGE / RELEASE, RELEASED | `charge` / `release` take `timeout` |
| 2 | `toggle` | 2.10 | TOGGLE, owner / flipCount | left out of `toggle` (log "cannot toggle") |
| 3 | `battery` | 2.13 | `batteryMv` in PING (0 = unknown) | level unknown |
| 4 | `ota` | 2.20 | `OTA_OFFER`, `OTA_CHUNK`, `OTA_ACTIVATE`, `@ota`, PING `otaState` (§5.3) | cannot be updated by the central (`unsupported`) |

**Revision** (`Protocol::REVISION`, `info.linkRevision`) counts compatible extensions: 1 = fw 2.0–2.8,
2 = 2.9 (hold), 3 = 2.10 (toggle), 4 = 2.13 (identity flag, colours 7/8, battery),
5 = 2.15 (light language: colour 10 cream, new identity palette, JOINED / SEARCH patterns instead of the spin
and the MAC segment; no new frame or field),
6 = 2.20 (firmware update of the peripherals: `OTA_OFFER`, `OTA_CHUNK`, `OTA_ACTIVATE`, PING `otaState` / `otaPercent`,
PONG flags `ota` / `ota pull`, feature bit 4).

**Frozen for the update (fw ≥ 2.20).** A release must be able to update its own peripherals from an older
central or the older pods from a newer one, so these stay byte-compatible in every future link version: the header
(`magic`, `version`, `type`, `seq`, `setId`), `SYNC_READ_REQ` / `SYNC_READ_RESP`, `OTA_OFFER`, `OTA_ACTIVATE` and
`OTA_CHUNK` with the path `@ota`, the PING/PONG fields for the update (`otaState`, `otaPercent`, PONG flags 2 and 3),
and `CLAIM_ACK.linkFeatures`. Anything new is appended or gets a new type. A change of the header `version` (pods
ignore other versions) cannot be updated over the link, only over USB. `otaActivate {"force":true}` (config-api) leaves
pods behind that are not ready only when the new firmware's `linkProtocol` equals the running one: a mixed set
works within one link version. The new version comes from `ota-manifest.json` (`linkProtocol`) and `otaBegin`.
