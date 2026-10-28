#!/usr/bin/env python3
"""
Checks the ReactPod program files in firmware/data/ before they are uploaded with
`pio run -t uploadfs`. Run from the repository root:

    python tools/validate_programs.py

It mirrors the rules of the firmware loader (src/BlockManager/BlockManager.cpp):
known block types, required fields, unique names, all port targets exist,
start block exists, colours valid, SPIFFS file name length.
Keep BLOCK_TYPES in sync with src/Block/BlockFactory/BlockFactory.cpp, and
PROGRAM_FORMAT with BlockFactory::PROGRAM_FORMAT (changelog: docs/firmware/programs.md §6).
"""
import json
import re
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "firmware" / "data"
INDEX = "/programs.json"
SPIFFS_MAX_PATH = 31  # CONFIG_SPIFFS_OBJ_NAME_LEN = 32 including the terminator

PROGRAM_FORMAT = 5   # revision of the block types below

NAMED_COLORS = {"off", "black", "red", "green", "blue", "yellow", "magenta", "cyan", "white"}

# type -> (ports, required fields, value fields (number or variable), colour fields, remote colour fields)
BLOCK_TYPES = {
    "led":              (["next"], ["color"], [], ["color"], []),
    "delay":            (["next"], [], ["ms", "minMs", "maxMs"], [], []),
    "button":           (["next", "short", "long", "pressed", "timeout"], [],
                         ["shortMs", "timeoutMs", "minTimeoutMs", "maxTimeoutMs"], [], []),
    "if":               (["true", "false"], ["left", "right"], ["left", "right"], [], []),
    "setVariable":      (["next"], ["var", "value"], ["value"], [], []),
    "remotePress":      (["next", "timeout"], ["pod"], ["pod", "timeoutMs"], [], ["color", "colorAfter"]),
    "remoteMultiPress": (["next", "avoidHit", "timeout"], [], ["pods", "avoid", "timeoutMs", "syncStartMs"], [],
                         ["hitColor", "avoidColor"]),
    "remoteResetAll":   (["next"], [], ["pods"], [], []),
    "summary":          (["next"], ["metric"], [], [], []),
    "repeat":           (["next", "body", "done"], ["count"], ["count"], [], []),
    # programFormat 3: ring effect; colours are named (also on the central)
    "effect":           (["next"], ["effect"], ["durationMs", "periodMs", "brightness", "syncStartMs"], [],
                         ["color", "color2"]),
    # programFormat 3: hold to charge (pod: "central" or a pod id / variable)
    "charge":           (["next", "released", "early", "full", "timeout"], ["maxMs"],
                         ["maxMs", "onsetMs", "decayMs", "timeoutMs", "minTimeoutMs", "maxTimeoutMs"], [],
                         ["color", "color2"]),
    # programFormat 3: release as trigger or on a colour switch
    "release":          (["next", "noHold", "falseStart", "timeout"], [],
                         ["goMs", "minGoMs", "maxGoMs", "holdTimeoutMs", "maxHoldMs", "timeoutMs"], [],
                         ["holdColor", "heldColor", "goColor"]),
    # programFormat 4: pods change team colour on every press ("colors" is checked in check_toggle)
    "toggle":           (["next", "allA", "allB"], [],
                         ["pods", "durationMs", "minDurationMs", "maxDurationMs", "cooldownMs", "syncStartMs"], [], []),
    # programFormat 5: report the measurements, wait for the client ("metrics", "vars", "editable": check_communicate)
    "communicate":      (["next", "pressed", "timeout", "repeat", "stop"], [], ["timeoutMs"], ["color"], []),
}
TOGGLE_STARTS = {"a", "b", "alternate", "random", "off"}
TOGGLE_STORES = ("storeA", "storeB", "storeTimeA", "storeTimeB", "storeFlips")

# blocks with modes: mode field -> (options, default), field -> the only mode it exists in
MODES = {
    "charge":  ("mode", ["release", "accumulate"], "release"),
    "release": ("mode", ["trigger", "signal"], "trigger"),
}
ONLY_MODE = {
    "charge":  {"decayMs": "accumulate"},
    "release": {"goColor": "signal", "goMs": "signal", "minGoMs": "signal", "maxGoMs": "signal",
                "timeoutMs": "signal", "record": "signal", "maxHoldMs": "trigger", "falseStart": "signal"},
}
CHARGE_STYLES = {"fill", "brightness", "trafficLight", "colorShift"}

# programFormat 3 (programs.md section 2 "Countdown"): optional fields of the timed blocks.
# type -> its named colour fields (countdownFrom: only delay and button have no lit colour of their own)
COUNTDOWN_FIELDS = {
    "delay":            ["countdownColor", "countdownFrom"],
    "button":           ["countdownColor", "countdownFrom"],
    "remotePress":      ["countdownColor"],
    "remoteMultiPress": ["countdownColor"],
    "charge":           ["countdownColor"],
    "release":          ["countdownColor"],
    "toggle":           ["countdownColor"],
}
COUNTDOWNS = {"secret", "drain", "fill", "dim", "colorShift", "trafficLight"}
EFFECTS = {"solid", "fill", "drain", "dim", "colorShift", "trafficLight", "blink", "pulse", "spin", "off"}
ENDLESS_EFFECTS = {"blink", "pulse", "spin"}  # endless without a durationMs > 0
TARGET_KEYWORDS = {"central", "all", "peripherals"}  # or a pod id (value)

# fields every block may carry (programFormat 2): timer name, handled by the engine
TIMER_FIELDS = ("timerStart", "timerStop")
MAX_TIMERS = 16  # BlockManager::MAX_TIMERS

IF_OPS = {"==", "=", "!=", "!", ">", "<", ">=", "<="}
SET_OPS = {"=", "set", "+", "add", "-", "sub", "?", "random", "!", "randomOther"}


def is_color(value):
    if isinstance(value, str):
        return value.lower() in NAMED_COLORS or re.fullmatch(r"#[0-9a-fA-F]{6}", value) is not None
    return isinstance(value, list) and len(value) == 3 and all(isinstance(c, int) and 0 <= c <= 255 for c in value)


class Validator:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, where, message):
        self.errors.append(f"{where}: {message}")

    def warning(self, where, message):
        self.warnings.append(f"{where}: {message}")

    def load(self, fs_path, where):
        if len(fs_path) > SPIFFS_MAX_PATH:
            self.error(where, f"path '{fs_path}' longer than {SPIFFS_MAX_PATH} characters (SPIFFS limit)")
        file = DATA_DIR / fs_path.lstrip("/")
        if not file.is_file():
            self.error(where, f"file '{fs_path}' not found in firmware/data/")
            return None
        try:
            return json.loads(file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            self.error(fs_path, f"invalid JSON: {e}")
            return None

    def collect(self, fs_path, blocks, depth=0):
        """Loads a file and its includes, appends (file, block) tuples. Returns the document."""
        if depth > 3:
            self.error(fs_path, "includes nested too deep")
            return None
        doc = self.load(fs_path, fs_path)
        if doc is None:
            return None
        for include in doc.get("include", []):
            self.collect(include, blocks, depth + 1)
        for name, value in doc.get("variables", {}).items():
            if not isinstance(value, int):
                self.error(fs_path, f"variable '{name}' must be an integer")
            else:
                self.variables[name] = value
        for block in doc.get("blocks", []):
            blocks.append((fs_path, block))
        return doc

    def check_block(self, fs_path, block, names):
        name = block.get("name")
        btype = block.get("type")
        where = f"{fs_path} block '{name}'"
        if not isinstance(name, str) or not isinstance(btype, str):
            self.error(fs_path, "every block needs 'name' and 'type'")
            return
        if btype not in BLOCK_TYPES:
            self.error(where, f"unknown type '{btype}' (known: {', '.join(BLOCK_TYPES)})")
            return

        ports, required, values, colors, remote_colors = BLOCK_TYPES[btype]
        for field in required:
            if field not in block:
                self.error(where, f"missing '{field}'")
        for field in values:
            if field in block and not isinstance(block[field], (int, str)):
                self.error(where, f"'{field}' must be a number or a variable name")
        for field in colors:
            if field in block and not is_color(block[field]):
                self.error(where, f"invalid colour in '{field}'")
        for field in remote_colors:
            if field in block and (not isinstance(block[field], str) or block[field].lower() not in NAMED_COLORS):
                self.error(where, f"'{field}' must be a named colour (peripherals do not support RGB)")

        if btype == "delay" and "ms" not in block and not ("minMs" in block and "maxMs" in block):
            self.error(where, "needs 'ms' or 'minMs' + 'maxMs'")
        if btype in ("button", "charge") and ("minTimeoutMs" in block) != ("maxTimeoutMs" in block):
            self.error(where, "random timeout needs 'minTimeoutMs' and 'maxTimeoutMs'")
        if btype == "if" and block.get("op", "==") not in IF_OPS:
            self.error(where, f"unknown op '{block.get('op')}'")
        if btype == "setVariable" and block.get("op", "=") not in SET_OPS:
            self.error(where, f"unknown op '{block.get('op')}'")
        if btype == "remotePress" and block.get("mode", "hit") not in ("hit", "avoid"):
            self.error(where, "'mode' must be 'hit' or 'avoid'")
        for field in TIMER_FIELDS:
            if field in block and (not isinstance(block[field], str) or block[field] == ""):
                self.error(where, f"'{field}' must be a timer name")
        if btype == "repeat" and "storeIndex" in block and not isinstance(block["storeIndex"], str):
            self.error(where, "'storeIndex' must be a variable name")
        self.check_format3(where, btype, block)
        if btype == "toggle":
            self.check_toggle(where, block)
        if btype == "communicate":
            self.check_communicate(where, block)
        if btype in ("led", "effect"):
            for led in block.get("leds", []):
                if not isinstance(led, int) or not 0 <= led < 18:
                    self.error(where, f"led index {led} out of range 0..17")

        connected = False
        for port in ports:
            if port in block:
                connected = True
                if block[port] not in names:
                    self.error(where, f"port '{port}' points to unknown block '{block[port]}'")
        if not connected:
            print(f"  note: {where} has no outgoing connection, the program ends there")

    def check_toggle(self, where, block):
        """toggle block (programFormat 4): two named colours, start owner, game length."""
        colors = block.get("colors")
        if colors is not None and not (isinstance(colors, list) and len(colors) == 2 and all(
                isinstance(c, str) and c.lower() in NAMED_COLORS for c in colors)):
            self.error(where, "'colors' must be two named colours")
        if block.get("start", "alternate") not in TOGGLE_STARTS:
            self.error(where, f"unknown start '{block.get('start')}' (known: {', '.join(sorted(TOGGLE_STARTS))})")
        if "includeCentral" in block and not isinstance(block["includeCentral"], bool):
            self.error(where, "'includeCentral' must be true or false")
        has_range = "minDurationMs" in block and "maxDurationMs" in block
        if "durationMs" in block and ("minDurationMs" in block or "maxDurationMs" in block):
            self.error(where, "use either 'durationMs' or 'minDurationMs' + 'maxDurationMs', not both")
        elif "durationMs" not in block and not has_range:
            self.error(where, "needs 'durationMs' or 'minDurationMs' + 'maxDurationMs'")
        for name in TOGGLE_STORES:
            if name in block and (not isinstance(block[name], str) or block[name] == ""):
                self.error(where, f"'{name}' must be a variable name")

    def check_communicate(self, where, block):
        """communicate block (programFormat 5): metric and variable lists, editable ranges, timeout.
        vars and editable names must be variables the program declares (self.variables, includes too)."""
        def is_int(value):
            return isinstance(value, int) and not isinstance(value, bool)

        def is_name(value):
            return isinstance(value, str) and 0 < len(value) <= 32

        def names(field):
            value = block.get(field, [])
            if not isinstance(value, list) or not all(is_name(n) for n in value):
                self.error(where, f"'{field}' must be a list of names (1 to 32 characters)")
                return []
            if len(value) > 8:
                self.error(where, f"'{field}' has more than 8 entries")
            return value

        names("metrics")
        for name in names("vars"):
            if name not in self.variables:
                self.error(where, f"'vars' uses '{name}', which the program does not declare")
        editable = block.get("editable", {})
        if not isinstance(editable, dict):
            self.error(where, "'editable' must be an object: variable name -> {min, max}")
            editable = {}
        if not all(is_name(key) for key in editable):
            self.error(where, "'editable' names must be 1 to 32 characters")
        if len(editable) > 8:
            self.error(where, "'editable' has more than 8 entries")
        for name, span in editable.items():
            if not (isinstance(span, dict) and is_int(span.get("min")) and is_int(span.get("max")) and span["min"] <= span["max"]):
                self.error(where, f"'editable' entry '{name}' needs integers 'min' and 'max' with min <= max")
            if name not in self.variables:
                self.error(where, f"'editable' uses '{name}', which the program does not declare")
        if is_int(block.get("timeoutMs")) and block["timeoutMs"] < 0:
            self.error(where, "'timeoutMs' must be 0 or more")

    def check_format3(self, where, btype, block):
        """effect block and countdown fields (programFormat 3)."""
        def check_target(field):
            value = block[field]
            if isinstance(value, bool) or not isinstance(value, (int, str)) or value == "":
                self.error(where, f"'{field}' must be {', '.join(sorted(TARGET_KEYWORDS))}, a pod id or a variable name")

        if btype in MODES:
            self.check_modes(where, btype, block, check_target)
        if btype == "effect":
            if "effect" in block and block["effect"] not in EFFECTS:
                self.error(where, f"unknown effect '{block['effect']}' (known: {', '.join(sorted(EFFECTS))})")
            if "target" in block:
                check_target("target")
            if "wait" in block and not isinstance(block["wait"], bool):
                self.error(where, "'wait' must be true or false")
            duration = block.get("durationMs")
            if (block.get("wait") is True and block.get("effect") in ENDLESS_EFFECTS
                    and (duration is None or (isinstance(duration, int) and not isinstance(duration, bool) and duration <= 0))):
                self.error(where, f"'wait' with the endless effect '{block['effect']}' needs a durationMs > 0")
        if not any(f in block for f in ("countdown", "countdownColor", "countdownFrom", "countdownTarget")):
            return
        if btype not in COUNTDOWN_FIELDS:
            self.error(where, "countdown fields are only valid on delay, button, remotePress, remoteMultiPress, charge, release and toggle")
            return
        for field in ("countdownColor", "countdownFrom"):
            if field not in block:
                continue
            if field not in COUNTDOWN_FIELDS[btype]:
                self.error(where, f"'{field}' is not valid on {btype}")
            elif not isinstance(block[field], str) or block[field].lower() not in NAMED_COLORS:
                self.error(where, f"'{field}' must be a named colour")
        if "countdownTarget" in block:
            if btype != "delay":
                self.error(where, "'countdownTarget' is only valid on delay")
            else:
                check_target("countdownTarget")
        countdown = block.get("countdown", "secret")
        if countdown not in COUNTDOWNS:
            self.error(where, f"unknown countdown '{countdown}' (known: {', '.join(sorted(COUNTDOWNS))})")
        elif countdown != "secret" and btype not in ("delay", "toggle"):
            random_timeout = "minTimeoutMs" in block and "maxTimeoutMs" in block
            def positive(field):  # charge / release: 0 or less means no limit
                value = block.get(field)
                return field in block and not (btype in ("charge", "release") and isinstance(value, int)
                                               and not isinstance(value, bool) and value <= 0)
            if btype == "release":
                limit = "timeoutMs" if block.get("mode") == "signal" else "maxHoldMs"
                has_limit = positive(limit)
            else:
                limit = "timeoutMs"
                has_limit = positive("timeoutMs") or (random_timeout and btype in ("button", "charge"))
            if not has_limit:
                self.error(where, f"countdown '{countdown}' needs a time limit ('{limit}')")

    def check_modes(self, where, btype, block, check_target):
        """charge and release: mode, fields and ports of one mode only, the signal's switch time."""
        field, options, default = MODES[btype]
        mode = block.get(field, default)
        if mode not in options:
            self.error(where, f"unknown {field} '{mode}' (known: {', '.join(options)})")
            mode = None
        if "pod" in block:
            check_target("pod")
            if block["pod"] in ("all", "peripherals"):
                self.error(where, "'pod' must be 'central', a pod id or a variable name (one pod only)")
        if mode is not None:
            for name, needs in ONLY_MODE[btype].items():
                if name in block and needs != mode:
                    self.error(where, f"'{name}' is only valid in {field} '{needs}' (this block has '{mode}')")
        if (btype == "charge" and isinstance(block.get("maxMs"), int) and not isinstance(block["maxMs"], bool)
                and block["maxMs"] < 1):
            self.error(where, "'maxMs' must be at least 1")
        if btype == "charge" and block.get("style", "fill") not in CHARGE_STYLES:
            self.error(where, f"unknown style '{block['style']}' (known: {', '.join(sorted(CHARGE_STYLES))})")
        if btype == "release":
            if "allowHeld" in block and not isinstance(block["allowHeld"], bool):
                self.error(where, "'allowHeld' must be true or false")
            if mode == "signal":
                has_range = "minGoMs" in block and "maxGoMs" in block
                if "goMs" in block and ("minGoMs" in block or "maxGoMs" in block):
                    self.error(where, "use either 'goMs' or 'minGoMs' + 'maxGoMs', not both")
                elif "goMs" not in block and not has_range:
                    self.error(where, "signal mode needs 'goMs' or 'minGoMs' + 'maxGoMs'")
        for name in ("storeAs", "storePercent", "record"):
            if name in block and (not isinstance(block[name], str) or block[name] == ""):
                self.error(where, f"'{name}' must be a name")

    def check_timers(self, fs_path, blocks):
        started, stopped = set(), set()
        for _, block in blocks:
            if isinstance(block.get("timerStart"), str) and block["timerStart"]:
                started.add(block["timerStart"])
            if isinstance(block.get("timerStop"), str) and block["timerStop"]:
                stopped.add(block["timerStop"])
        if len(started | stopped) > MAX_TIMERS:
            self.error(fs_path, f"more than {MAX_TIMERS} different timer names")
        for name in sorted(started - stopped):
            self.warning(fs_path, f"timer '{name}' is started but never stopped")
        for name in sorted(stopped - started):
            self.warning(fs_path, f"timer '{name}' is stopped but never started")

    def check_repeats(self, blocks):
        """Warns when no path from a repeat block's body leads back to it."""
        by_name = {block.get("name"): block for _, block in blocks}

        def targets(block):
            ports = BLOCK_TYPES.get(block.get("type"), ([],))[0]
            return [block[port] for port in ports if isinstance(block.get(port), str)]

        for file, block in blocks:
            if block.get("type") != "repeat":
                continue
            name = block.get("name")
            first = block.get("body", block.get("next"))
            seen, todo = set(), [first] if isinstance(first, str) else []
            while todo and name not in seen:
                current = todo.pop()
                if current in seen or current not in by_name:
                    continue
                seen.add(current)
                todo.extend(targets(by_name[current]))
            if name not in seen:
                self.warning(f"{file} block '{name}'", "no path from 'body' leads back to this repeat block")

    def check_ranges(self, blocks):
        # with max <= min the firmware always uses min (programs.md 7.3); variables count with their start value
        def value(v):
            return v if isinstance(v, int) else self.variables.get(v) if isinstance(v, str) else None
        for file, block in blocks:
            fields = {"delay": ("minMs", "maxMs"), "button": ("minTimeoutMs", "maxTimeoutMs"),
                      "charge": ("minTimeoutMs", "maxTimeoutMs"), "release": ("minGoMs", "maxGoMs"),
                      "toggle": ("minDurationMs", "maxDurationMs")}.get(block.get("type"))
            if not fields:
                continue
            low, high = value(block.get(fields[0])), value(block.get(fields[1]))
            if low is not None and high is not None and high < low:
                self.warning(f"{file} block '{block.get('name')}'", f"'{fields[1]}' is below '{fields[0]}': the pod always uses '{fields[0]}'")

    def check_program(self, fs_path):
        self.variables = {}
        blocks = []
        doc = self.collect(fs_path, blocks)
        if doc is None:
            return
        names = {}
        for file, block in blocks:
            name = block.get("name")
            if name in names:
                self.error(file, f"duplicate block name '{name}' (also in {names[name]})")
            names[name] = file
        for file, block in blocks:
            self.check_block(file, block, names)

        self.check_timers(fs_path, blocks)
        self.check_repeats(blocks)
        self.check_ranges(blocks)

        start = doc.get("start")
        if start is not None and start not in names:
            self.error(fs_path, f"start block '{start}' not found")
        if not blocks:
            self.error(fs_path, "program has no blocks")
        for group in doc.get("menu", []):
            if not is_color(group.get("color")):
                self.error(fs_path, "menu entry with invalid colour")
        peripherals = doc.get("peripherals", 0)
        if not isinstance(peripherals, int) or not 0 <= peripherals <= 7:
            self.error(fs_path, "'peripherals' must be 0..7")
        print(f"  {fs_path}: '{doc.get('name', '?')}', {len(blocks)} blocks, {peripherals} peripherals")

    def run(self):
        index = self.load(INDEX, INDEX)
        if index is None:
            return False
        for path in DATA_DIR.rglob("*"):
            if path.is_file() and len("/" + path.relative_to(DATA_DIR).as_posix()) > SPIFFS_MAX_PATH:
                self.error(path.relative_to(DATA_DIR).as_posix(), "path too long for SPIFFS")
        for program in index.get("programs", []):
            self.check_program(program)
        return not self.errors


def main():
    validator = Validator()
    ok = validator.run()
    for warning in validator.warnings:
        print(f"WARNING {warning}")
    for error in validator.errors:
        print(f"ERROR {error}")
    print("OK" if ok else f"{len(validator.errors)} error(s)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
