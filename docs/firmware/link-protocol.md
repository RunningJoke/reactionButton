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
| `PING` | P → C | t1 (stamped at tx), store generation + hash, batteryMv (≥ 2.13) | heartbeat 200 ms, clock sync, store state, battery |
| `PONG` | C → P | t1, t2 (rx), t3 (tx), store generation + hash, flags (bit 0 sync allowed, bit 1 identify) | clock sync, store state |
| `ARM` | C → P | cmdSeq, mode, colorActive, colorAfter, startAtUs; appended: waiting EffectDesc (≥ 2.8), HoldParams (≥ 2.9, CHARGE/RELEASE), toggle params (≥ 2.10, TOGGLE) | light now (`startAtUs` 0) or at a central-clock time |
| `RESET` | C → P | – | off, cancel pending activation |
| `PRESSED` | P → C | podId, cmdSeq, result (HIT/AVOID_HIT), reactionUs; appended owner + flipCount (TOGGLE) | press while active; CHARGE/RELEASE: hold started; TOGGLE: flipped |
| `SYNC_READ_REQ` | either | reqId, offset, path (32 bytes) | read a store file chunk or `@manifest` |
| `SYNC_READ_RESP` | either | reqId, status, offset, total, len, data ≤ 200 | the chunk |
| `EFFECT` (11) | C → P | EffectDesc, startAtUs (i64, 0 = now) | ring effect (only to pods with `effects`) |
| `RELEASED` (12) | P → C | podId, cmdSeq, flags, heldMs, reactionUs, chargeMs | end of a hold (§2.2) |

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

**Revision** (`Protocol::REVISION`, `info.linkRevision`) counts compatible extensions: 1 = fw 2.0–2.8,
2 = 2.9 (hold), 3 = 2.10 (toggle), 4 = 2.13 (identity flag, colours 7/8, battery),
5 = 2.15 (light language: colour 10 cream, new identity palette, JOINED / SEARCH patterns instead of the spin
and the MAC segment; no new frame or field).
