# Testing over USB (and BLE)

Tool: `tools/reactpod_serial.py` (`pip install pyserial`) on the pod's USB port; ops are config-api §5.

## 1. Setup
- Close other serial monitors (one program per port). `--port COM4` is optional (default: first Espressif port).
- Git Bash: prefix commands with pod paths with `MSYS_NO_PATHCONV=1` (else `/prog/x` becomes a Windows path).

## 2. Flash
`pio run -d firmware -e NewBoard -t upload --upload-port COM4`, then `-t uploadfs`. The pod usually stays
in download mode: `reactpod_serial.py --port COM4 wait-boot` tells you when to press **RESET** (not BOOT)
and prints role, state, firmware, generation, last reset. Flash every pod of a set. Firmware from the first release with the ADR 0009 partition table needs one full flash of every pod (`-t upload`, then `-t uploadfs`), because the partition table changed; programs on the pod are lost.

## 3. Monitor
`reactpod_serial.py --port COM4 monitor --log pod.log`: firmware log (grey), `[boot]` (green; red with
`panic during step '…'` after a crash), `[state]` (blue), `RESULT`/`SUMMARY`, yellow `>>>` = manual action,
responses cyan. Type ops (`status`, `programs`, `select 8`, `start`, `press`, `results`, `trace on`,
`help`); `quit` ends. Reconnects by itself after a reset. Attach the log to bug reports.

## 4. Single commands
`status` · `reboot central|peripheral` (asks for RESET if needed) · `programs` · `select 8|/prog/duo.json|Duo`
· `start` · `press` · `stop` (back to the menu in place, no reboot) · `push firmware/data` / `pull backup` · `results` · `trace on` ·
`set-pin 1234` · `ota firmware.bin [--no-activate]` (§14).

## 5. Guided test
`reactpod_serial.py --port COM4 --log test.log test --program /prog/duo.json --auto-press`: connects, makes
the pod central, validates the program, waits for the peripherals (switch them on, Enter), runs it (press the
peripheral when green; `--auto-press` simulates the central), reports link statistics, reaction times,
misses → `ALL PASSED` or the failed checks. Options: `--push firmware/data`, `--rounds 6`, `--yes`
(unattended), `-v` (firmware log), `--keep-running`. Duo: 1 peripheral, alternating, random 0.5–2 s, miss
after 5 s, summary after 10 rounds.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `waiting for download` / no output after flashing | RESET or power-cycle (`wait-boot`) |
| `[boot] … panic during step '…'` / pod comes back as peripheral after `select` | crash: send the log and the step |
| peripheral never joins | yellow? same firmware? same set (`status.setId`; else hold 3 s while yellow) |
| `could not open port` | another program holds it |
| program not found | `uploadfs` or `--push firmware/data` |
| PC stops seeing BLE devices | Windows adapter: Bluetooth off and on |

## 8. Start spread on a logic analyser (#24) – optional, not run
No logic analyser available; the spread is accepted as measured by the peripherals only (timing §4, §6).
Procedure if one becomes available: WS2812 data line (GPIO 7) of the central and two peripherals, ≥ 1 MHz, first LED frame after the 3 s pause
of `run` per round, ≥ 50 rounds, with and without a phone. Pass < 15 ms (relaxed from 5 ms for #24). All pods in one set; with BLE on
ESP-NOW uses modem sleep (ADR 0005).

## 9. Hold blocks (`charge`, `release`, fw ≥ 2.9) – not yet run on hardware
Demo programs `charge.json`, `release.json`, central + 1 peripheral, `status.pods[0].hold` true. Record
results in #57 / #58, do not mark them passed here.

| # | Check | Expected |
|---|---|---|
| 1 | `charge` on the central, each style | ring follows after `onsetMs`; release → `released`, `CENTRAL_CHARGE` = hold − onset |
| 2 | same with `"pod": 0` | same, animated on the pod |
| 3 | hold < `onsetMs` | `early` (→ `released`), charge 0 |
| 4 | hold until full | flash, `full` at once, flash not reset |
| 5 | `timeoutMs` + countdown | idle ring counts down, a hold stops it, `timeout` after the limit |
| 6 | `accumulate` + `decayMs` on pod 0 | release freezes / drains, holding again continues; full or timeout ends; `POD_CHARGE` set |
| 7 | held ms vs stopwatch | ± 5 ms |
| 8 | `release` trigger, held before the block (`allowHeld`) | `next` at release, `HOLD_MS` set; `noHold`, `maxHoldMs` paths work |
| 9 | `release` signal | reaction ± 2 ms of a `remotePress` measurement; release 1 ms before the switch → `falseStart` |
| 10 | peripheral fw ≤ 2.8 in the set | `timeout` at once, log "cannot measure holds" |

## 10. Toggle block (fw ≥ 2.10) – not yet run on hardware
`domination.json`, central + 2 peripherals, `status.pods[].toggle` true. Record results in #59.

| # | Check | Expected |
|---|---|---|
| 1 | game start | all light together: red, blue, red (alternate, central last) |
| 2 | press a pod | flips at once, `FLIPS` counts |
| 3 | 60 s, 4 pods, video count of owner changes | `RED_PODS`/`BLUE_PODS`, `RED_MS`/`BLUE_MS` match (± 1 flip, ± 50 ms per flip) |
| 4 | presses within `cooldownMs` | only the first flips |
| 5 | all one colour, `allA`/`allB` connected / unconnected | leaves via `allA`/`allB` / goes on to `next` |
| 6 | press after the block ended | no change |
| 7 | countdown + flip | animation continues in the new colour |
| 8 | peripheral fw ≤ 2.9 | left out, log "cannot toggle" |
| 9 | `start: "off"` | dark until pressed; first press → A |

## 11. Live over BLE (`reactpod_config.py live`, fw ≥ 2.12)
`pip install bleak`. `python tools/reactpod_config.py live` (first pod found) or `--name "ReactPod 91c2" live
--auto --athlete ath_42`. Keeps the connection through a game, prints `state` and `report`, fetches and
acks reports (also after a reconnect; rescans by `--name` / `--address`). Keys: `c` continue, `r` repeat,
`s` stop, `p` pause, `u` resume, `v NAME=VALUE …`, `a NAME` athlete (`a` clears), `?` status, `q` quit.
`--auto` answers every `communicate` with `continue` (soak tests). `[connection] lost` = the link dropped
(fw < 2.12 always drops at select; `live` warns). Unit tests: `python tools/test_reactpod_config.py`.

## 12. Release checklist (before every `fw-v*` tag)
Release build on every pod of a set (`upload` + `uploadfs`). Put date, firmware, pods and result of each
line in the release PR. Automated lines: `python tools/reactpod_hwtest.py --central COM3 --peripheral COM4
--peripheral COM5` (§12.1).

| # | Check | Pass | Auto |
|---|---|---|---|
| 1 | 150 `status` requests at 0.3 s on each pod (USB) | 0 timeouts (#74) | yes |
| 2 | every shipped program: select, discovery, start | DISCOVERY → CONFIRM → RUN ≤ 30 s, no ERROR | yes |
| 3 | a full set (up to 7) joins | all claimed, central green | partly |
| 4 | phone pause / resume, also with a pod lost during the pause | config-api "Two kinds of PAUSED" | yes |
| 5 | power-cycle a peripheral mid-game | PAUSED, RUN ≤ 10 s after it is back | yes |
| 6 | cycle report over USB and BLE | report with the cycle metric; `--auto` continues | USB yes, BLE `live --auto` |
| 7 | 30 min soak per mode (`run`, `dreieck`, a hold program) with `live --auto` | no BLE disconnect, `txLost` 0, min free heap > 40 KB, no restart | no |
| 8 | two sets in one room | no cross-joining, no PAUSED caused by the other set | no |
| 9 | battery run-down from full | ≥ 1 h, low-battery warning before power-off | no |
| 10 | start spread (§8), only with a logic analyser, after link / clock / LED timing changes | < 15 ms with and without phone | no |
| 11 | app against the release: BLE + USB, push, restore defaults, training view | as the app acceptance tests | no |
| 12 | auto power-off: unclaimed pod and phone-less central in MENU sleep after 10 min (build with 1 for a quick check), on battery / plain charger (a computer keeps it awake; over USB check `status.powerOff.idleMs` counts and resets on press / claim); drain, a press wakes into a normal boot; claimed pods, a central with phone or in DISCOVERY never sleep | as described | no |
| 13 | OTA signature (§14.1): unsigned image, image signed with another key → `ota_failed`, old firmware keeps running; correct image accepted; the same for a peripheral through `ota-set` | as described | yes (§14.2) |
| 14 | OTA power loss, simulated by a hard reset (§14.2) at each stage on central and peripheral: during the upload to the central, during the slot erase of a peripheral, mid distribution, with the image `ready`, in the first 15 s after the restart | old firmware or the update runs, pod usable, the next update works | yes (§14.2) |
| 15 | OTA rollback: reset inside the 15 s trial; an image that panics at boot | `rolledBack`, old firmware, a central stays central | yes (§14.2) |
| 16 | 10 update cycles in a row over `ota-set` (2.22 ↔ 2.23, signed) | both slots alternate, every `lastResult` `ok`, no pod lost | yes (§14.2) |
| 17 | after the updates: line 2, 4, 5 (`reactpod_hwtest.py --quick`) and a game | all pass | yes |
| 18 | OTA from the app: phone leaves during the transfer and comes back; pod out of range (switched off) during distribution; update refused below 30 % battery; update with a nearly full store | resumes or fails with a message, no pod left unusable | no (user) |
| 19 | OTA real power-off (switch / unplug battery) at each stage, also in the first 15 s after the restart | as line 14 | no (user) |
| 20 | the user updates a set from the app on a phone, from one published release to the next | `info.firmware` of every pod = release, `lastResult` `ok` | no (user) |

### 12.1 `reactpod_hwtest.py`
Central + ≥ 1 peripheral of one set on USB. Reboots the central into the menu, runs lines 1, 2, 4, 5, 6 (USB),
PASS / FAIL per check, exit 1 on failure. Takes peripherals out by rebooting them as central and back;
restores every pod's role at the end. `--quick` skips line 6 (~2 min).

## 13. Host unit tests (`native` env)
Unity tests on the PC, no pod needed: `firmware/test/` (`test_variables`, `test_link_frames`, `test_engine`).
Only the pure modules are built (`build_src_filter` in `firmware/platformio.ini`); the stubs in
`tools/fw_syntax_check/stubs` stand in for Arduino / ESP-IDF names, `test/host_stubs.cpp` defines the few
functions the modules call. Runs in CI on every firmware PR.

```sh
pio test -d firmware -e native            # all suites; needs a host g++ (on Windows: MSYS2 ucrt64 on PATH)
pio test -d firmware -e native -f test_link_frames   # one suite
```

A module that needs the runtime (block classes, BlockManager, BlockFactory, LEDManager) is not built here:
add it to `build_src_filter` only with its runtime stubs in `test/host_stubs.cpp`.

## 14. Firmware update (`ota`, fw ≥ 2.19)
`reactpod_serial.py --port COM3 ota firmware/.pio/build/NewBoard/firmware.bin [--no-activate]` (USB), and the
same command in `reactpod_config.py` (BLE, central in the menu; `--name`, `--address`, `--pin` as for the other ops).
Both use the steps of config-api "Firmware update" from `tools/reactpod_ota.py`: SHA-256, `otaBegin`, `otaWrite`
chunks (2048 raw bytes, progress line every 5 %), `otaEnd`, `otaActivate`, wait for the restart, then print
`info.firmware`, `info.ota.running` (before and after) and `info.ota.lastResult`; exit 1 on `rolledBack`.
`--no-activate` stops after `otaEnd`: the image is verified and the update stays `ready` (`status.ota.state`).
A failed step prints `update failed: <code>: <message>`, sends `otaAbort` while the update is open and exits 1.
A run that is interrupted (Ctrl+C, cable) leaves the update open: the same command resumes it from `received`.
Measured over USB with fw 2.19 (1.11 MB, 2048-byte chunks, 543 requests): upload 30 s at 37 kB/s, 34 s with
the activation and the restart. The reader no longer waits 100 ms per answer (#122).
Tests: `python tools/test_reactpod_config.py` (fake pod: normal run, resume, `bad_offset` with abort, `--no-activate`).

### 14.1 Signed images and keys (fw ≥ 2.20, #134)
Every `firmware.bin` is signed after the build by `firmware/sign_ota.py` (secure boot v2 signature block, RSA-3072; **no**
secure boot, no eFuse, USB flashing unchanged; architecture §4.2). A pod trusts the key **its own running image** was signed
with, so an update must be signed with the key of the firmware the pod runs now.
- **Developer builds:** key `firmware/ota_test_key.pem`, created on the first build, git-ignored (`*.pem`). Flash the file
  `firmware/.pio/build/NewBoard/firmware.bin` (it is the signed one) over USB or OTA. Pods flashed from source update from
  source builds of the same checkout. Another PC / a fresh clone makes another test key: reflash the pods over USB or copy
  the file. `OTA_SIGNING_KEY_FILE=<pem>` selects another key (tests with a wrong key). The first build installs the Python
  modules `cryptography` and `ecdsa` into the PlatformIO python (`espsecure.py` needs them).
- **Release key** (once, by the user, never in the repo or in chat):
  1. `python ~/.platformio/packages/tool-esptoolpy/espsecure.py generate_signing_key --version 2 --scheme rsa3072 ota_release_key.pem`
     (or `pip install esptool` and `espsecure.py …`; do it outside the repo).
  2. Offline backup before anything else: at least two copies (password manager and an encrypted USB stick). **If the key is
     lost or leaked, no pod accepts a new key by OTA: every pod must be flashed again over USB** with a build signed by a new key.
  3. `gh secret set OTA_SIGNING_KEY < ota_release_key.pem`, then delete the working copy or keep it only with the backups.
  4. `release-firmware.yml` passes the secret to `firmware.yml`, which writes it to a temporary file (`OTA_SIGNING_KEY_FILE`);
     the release fails without the secret, the signature is checked with the same key right after signing.
  5. First release: flash every pod over USB with the release's `bootloader.bin`, `partitions.bin`, `firmware.bin`
     (`esptool.py write_flash 0x0 bootloader.bin 0x8000 partitions.bin 0x10000 firmware.bin`, then `uploadfs` or
     `spiffs.bin` at `0x390000`). Pods with developer builds reject the release image with `ota_failed`, by design.
- **Check an image by hand:** `espsecure.py verify_signature --version 2 --keyfile <pem> firmware.bin` (a pod holding an
  older, valid signature in the sector behind a shorter unsigned image of the same content would accept it: the signature
  covers the content, so this is not a hole, but it makes "unsigned" tests with a truncated signed file meaningless; use a
  real unsigned build).
- CI builds (PRs, `main`) sign with a throw-away key. The signature block adds 13 KB to `firmware.bin`
  (1 121 296 → 1 134 592 bytes, 63 % of a slot), which the flash-usage step already counts.

### 14.2 Hardware checks of the update (lines 13 to 17 of §12)
Three pods on USB (central COM4, peripherals COM3 / COM5 here), all with the same developer build. A **power cut** is
simulated by a hard reset through the open USB port, so the tool keeps running: `ser.rts = True; ser.dtr = False;
sleep 0.2; ser.rts = False; ser.dtr = False` (pyserial; setting only RTS does nothing on Windows). The pod comes back
as a peripheral (a hard reset forgets the one-shot central role): `reactpod_serial.py reboot central`. Images: the
developer build with `FW_VERSION_MINOR` raised (2.22 / 2.23, restore afterwards), a copy re-signed with
`OTA_SIGNING_KEY_FILE=<other.pem>` or `espsecure.py sign_data --version 2 --keyfile other.pem`, an unsigned build from an
older checkout and a build with `abort();` first in `setup()` (panics at boot). A shorter image that is the prefix of a
signed one is no unsigned image (§14.1).

| Stage | How | Expected | Run 2026-11-07 (fw 2.20 source + 2.21 … 2.24 test images) |
|---|---|---|---|
| unsigned image, single pod | `ota unsigned.bin` | `ota_failed: image rejected`, pod keeps running, uptime not reset | pass (COM3, 2 images) |
| other key, single pod | `ota other.bin` | same | pass |
| unsigned image, `ota-set` | central rejects at `otaEnd`, nothing is distributed | same | pass |
| other key at a peripheral | peripheral flashed with the other key, central (test key) distributes | peripheral `failed`, the other pod `ready`, nothing runs the new image after `otaAbort` | pass |
| signed image, single pod / set | `ota good.bin`, `ota-set` | new version, `ok` | pass (COM3; set of 3) |
| reset of the central during the upload (otaWrite 250 of 554) | | old firmware running, slot not corrupt, new update from the start works | pass |
| reset of a peripheral during the USB upload | same | same | pass |
| reset of a peripheral during its slot erase (`transferring` +1 s) | `stage` | rejoins, distribution finishes (70 s instead of 30 s), activation fine | pass |
| reset of a peripheral mid distribution (40 to 50 %) | | same | pass |
| reset of a peripheral with the image `ready` | | pod rejoins the update, `ready` again, `otaActivate` updates all | pass |
| reset of the central 15 s into the distribution | | peripherals fall back to UNCLAIMED, running old firmware; central comes back (as peripheral), a new `ota-set` works | pass |
| reset of a peripheral 5 s after the activation (trial) | | `rolledBack`, old firmware, others updated (mixed set plays) | pass |
| reset of the central in the trial | | `rolledBack`, old firmware, central role kept | pass |
| image that panics at boot (peripheral) | `ota crash.bin` | bootloader returns to the old slot, `rolledBack`, tool says so | pass |
| 10 cycles `ota-set` 2.22 / 2.23 | | slots alternate app0 / app1 on each pod, `ok` every time, about 3 min per cycle | pass 10 of 10 |
| after the updates | `reactpod_hwtest.py --quick` (2 peripherals) | line 2, 4, 5 | 23 passed, 0 failed |

Not run from the PC: phone leaves / returns, out of range, low battery (refusal below 30 %), nearly full store, a real power
cut, the update from the app on a phone (lines 18 to 20). A pod that reports `lastResult` `rolledBack` keeps it until the next
`otaBegin` or `otaActivate`; a USB flash does not clear it.
