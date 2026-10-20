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

PROGRAM_FORMAT = 2   # revision of the block types below

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
}

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
        if btype == "button" and ("minTimeoutMs" in block) != ("maxTimeoutMs" in block):
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
        if btype == "led":
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

    def check_program(self, fs_path):
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
