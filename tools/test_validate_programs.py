#!/usr/bin/env python3
"""
Tests of tools/validate_programs.py: one negative (and positive) example per rule, from
tools/validator_cases.json. The app validator (packages/program-model/src/validatorCases.test.ts)
runs the same cases, so both must agree.

    python tools/test_validate_programs.py
"""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate_programs  # noqa: E402

CASES = json.loads((Path(__file__).resolve().parent / "validator_cases.json").read_text(encoding="utf-8"))["cases"]


def run(blocks):
    """Validates one program in a temporary data directory. Returns (errors, warnings)."""
    program = {"version": 1, "name": "T", "peripherals": 2, "blocks": blocks + [{"name": "L", "type": "led", "color": "off"}]}
    with tempfile.TemporaryDirectory() as tmp:
        data = Path(tmp)
        (data / "prog").mkdir()
        (data / "programs.json").write_text(json.dumps({"programs": ["/prog/t.json"]}), encoding="utf-8")
        (data / "prog" / "t.json").write_text(json.dumps(program), encoding="utf-8")
        old = validate_programs.DATA_DIR
        validate_programs.DATA_DIR = data
        try:
            validator = validate_programs.Validator()
            with contextlib.redirect_stdout(io.StringIO()):
                validator.run()
        finally:
            validate_programs.DATA_DIR = old
        return validator.errors, validator.warnings


class ValidatorCases(unittest.TestCase):
    def test_cases(self):
        for case in CASES:
            with self.subTest(case["name"]):
                errors, warnings = run(case["blocks"])
                self.assertEqual(not errors, case["valid"], f"errors: {errors}")
                if case.get("warns"):
                    self.assertTrue(warnings, "expected a warning")

    def test_program_format(self):
        self.assertEqual(validate_programs.PROGRAM_FORMAT, 4)
        self.assertIn("toggle", validate_programs.BLOCK_TYPES)

    def test_toggle_error_texts(self):
        errors, _ = run([{"name": "T", "type": "toggle", "colors": ["red"], "next": "L"}])
        text = "\n".join(errors)
        self.assertIn("two named colours", text)
        self.assertIn("needs 'durationMs'", text)


if __name__ == "__main__":
    unittest.main()
