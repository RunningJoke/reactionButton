import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasErrors, validateProgram } from "./index";

/**
 * The cases of tools/validator_cases.json, which tools/test_validate_programs.py runs against
 * tools/validate_programs.py: both validators must give the same verdict (errors or not, warnings or not).
 */
type Case = { name: string; valid: boolean; warns?: boolean; blocks: unknown[] };
const FILE = join(import.meta.dirname, "../../../tools/validator_cases.json");
const { cases } = JSON.parse(readFileSync(FILE, "utf8")) as { cases: Case[] };

const PATH = "/prog/t.json";

describe("validator cases shared with tools/validate_programs.py", () => {
  it("has cases", () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  for (const c of cases) {
    it(c.name, () => {
      const program = { version: 1, name: "T", peripherals: 2, blocks: [...c.blocks, { name: "L", type: "led", color: "off" }] };
      const issues = validateProgram(PATH, (p) => (p === PATH ? JSON.stringify(program) : undefined)).issues;
      // the final LED block ends the program on purpose: that note is no verdict
      const relevant = issues.filter((i) => !(i.code === "noOutgoing" && i.block === "L"));
      expect(hasErrors(relevant), JSON.stringify(relevant)).toBe(!c.valid);
      if (c.warns) expect(relevant.some((i) => i.severity === "warning")).toBe(true);
    });
  }
});
