# Testing with USB

This guide covers flashing a pod, watching its log, and running a guided test with
[tools/reactpod_serial.py](../tools/reactpod_serial.py). The tool talks to the pod's
built-in USB serial port (the same cable used for flashing). The commands it sends are
described in [config-api.md](config-api.md).

## 1. Preparation (once)

```sh
pip install pyserial
```

- Use a normal terminal (PowerShell, cmd, macOS/Linux shell).
  In **Git Bash** on Windows, prefix commands that contain paths with `MSYS_NO_PATHCONV=1`.
  Otherwise Git Bash turns `/prog/duo.json` into `C:/Program Files/Git/prog/duo.json`.
- Close other serial monitors (`pio device monitor`, Arduino IDE). Only one program can
  use the port.
- `--port COM4` is optional. Without it, the first Espressif USB port is used.

## 2. Flash a pod

```sh
pio run -e NewBoard -t upload --upload-port COM4     # firmware
pio run -e NewBoard -t uploadfs --upload-port COM4   # program files (data/)
```

**After flashing, the pod usually stays in download mode** and does not start by
itself. Then:

```sh
python tools/reactpod_serial.py --port COM4 wait-boot
```

The tool waits for the pod and tells you when to **press RESET** (not BOOT) or switch the
pod off and on. As soon as the pod runs, it prints role, state, firmware, store
generation and the *last reset* reason.

Firmware 2.x pods only talk to each other if all of them run the same protocol version,
so flash every pod of the set.

## 3. Watch the log

```sh
python tools/reactpod_serial.py --port COM4 monitor --log pod.log
```

Shows everything the pod prints:

| Shown as | Meaning |
|---|---|
| grey lines `I (1234) TAG: ...` | firmware log |
| `[boot] central firmware 2.0, last reset: power-on` (green) | the pod started |
| `[boot] ... last reset: panic during step 'select: radio start'` (red) | the pod restarted after a crash; the step shows where |
| `[state] CONFIRM pods 1/1 /prog/duo.json` (blue) | central state change |
| `RESULT,...` / `SUMMARY,...` | measured reaction times |
| yellow `>>>` lines | something to do by hand (e.g. press RESET) |

You can type commands while monitoring, for example `status`, `programs`, `select 8`,
`start`, `press`, `results`, `trace on`, `help`. Responses are printed in cyan. `quit`
ends the monitor. `--log` keeps everything in a file. Send that file along when you
report a problem.

If the port disappears (pod restarted, cable), the monitor waits and continues automatically.

## 4. Single steps

| Command | What it does |
|---|---|
| `status` | role, state, program, peripherals with MAC and link statistics, last reset |
| `reboot central` / `reboot peripheral` | restart in that role, without holding the button. If the pod does not restart by itself, the tool asks you to press RESET; the role is kept for that start |
| `programs` | the menu (index, name, path, peripherals) |
| `select 8` / `select /prog/duo.json` / `select Duo` | choose a program (central, in the menu) |
| `start` | start it (all peripherals connected) |
| `press` | simulate the button of the pod on USB |
| `stop` | end the program, back to the menu (the pod restarts) |
| `push data` / `pull backup` | upload / download all program files |
| `results` | statistics of the recorded metrics |
| `trace on` | report every block the program enters (for automated tests) |

Example (central on COM4, a peripheral switched on):

```sh
python tools/reactpod_serial.py --port COM4 reboot central
python tools/reactpod_serial.py --port COM4 select /prog/duo.json
python tools/reactpod_serial.py --port COM4 status        # shows the connected peripheral
python tools/reactpod_serial.py --port COM4 start
python tools/reactpod_serial.py --port COM4 monitor       # watch the results
```

## 5. Guided test

```sh
python tools/reactpod_serial.py --port COM4 --log test.log test --program /prog/duo.json --auto-press
```

What happens, and what you do:

| Step | The tool | You |
|---|---|---|
| 1 connect | waits until the pod answers | press RESET if asked (e.g. right after flashing) |
| 2 central in menu | restarts the pod as central if needed | press RESET if it does not restart by itself |
| 3 programs | checks that the program exists and validates it | — |
| 4 connect peripherals | selects the program, waits for the peripherals | switch the peripheral on (yellow), press Enter |
| 5 run | starts the program (after Enter), prints each result | press the **peripheral** when it lights green. With `--auto-press` the central's presses are simulated; without it, press the central too |
| 6 report | prints connection data, link statistics, reaction times, misses | — |

At the end you get `ALL PASSED` or the list of failed checks. The pod returns to the
program menu (`--keep-running` leaves it in the game).

Useful options:

| Option | Effect |
|---|---|
| `--push data` | upload the program files from `data/` first (e.g. after changing a JSON file) |
| `--rounds 6` | stop after 6 results instead of waiting for the summary |
| `--yes` | no Enter prompts (unattended; manual steps must already be done) |
| `-v` | also show the firmware log |
| `--log FILE` | write everything to a file |

The Duo program ([data/prog/duo.json](../data/prog/duo.json)) needs one peripheral.
Central and peripheral take turns, each after a random 0.5–2 s pause. A target not
pressed within 5 s counts as a miss. After 10 rounds a summary is printed.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `waiting for download` in the log | download mode: press RESET (not BOOT) or power-cycle |
| no output at all after flashing | same as above; `wait-boot` guides you |
| `[boot] ... last reset: panic during step '...'` | crash; send the log file and the step name |
| pod comes back as **peripheral** after `select` | it restarted (crash or reset); see the `[boot]` line |
| peripheral never connects | is it yellow? Same firmware? Paired with another set: hold its button 3 s while yellow (white flash) |
| `could not open port` / permission | another program uses the port; close it |
| program not found | upload programs: `pio run -t uploadfs` or `--push data` |

## 7. Note on the serial port (firmware detail)

With `framework = arduino, espidf` the Arduino core is built without
`ARDUINO_USB_CDC_ON_BOOT`, so `Serial` is UART0 (GPIO 20/21) and not the USB port. The
firmware therefore uses its own USB console object (`Console`,
[src/Config/Console.h](../src/Config/Console.h)), which also receives the ESP-IDF log
output. Do not add `ARDUINO_USB_CDC_ON_BOOT`/`ARDUINO_USB_MODE` to `platformio.ini`.
With "arduino, espidf" they only reach `src/`, so `Serial` would mean two different
objects. Crash dumps of the panic handler still go to UART0; the `[boot]` line with
reset reason and last step replaces them for normal use.
