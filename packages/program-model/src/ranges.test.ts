import { describe, expect, it } from "vitest";
import { validateProgram, type Issue } from "./index";

const PATH = "/prog/t.json";

function reversed(blocks: unknown[], variables?: Record<string, number>): Issue[] {
  const text = JSON.stringify({ version: 1, name: "T", ...(variables ? { variables } : {}), blocks });
  return validateProgram(PATH, (p) => (p === PATH ? text : undefined)).issues.filter((i) => i.code === "rangeReversed");
}

describe("random ranges (programs.md §7.3)", () => {
  it("warns when a pause's longest time is below its shortest", () => {
    expect(reversed([{ name: "P", type: "delay", minMs: 3000, maxMs: 1000 }])).toEqual([
      { severity: "warning", code: "rangeReversed", file: PATH, block: "P", field: "minMs", params: { min: 3000, max: 1000 } },
    ]);
  });

  it("reads variables with their start value", () => {
    const blocks = [{ name: "B", type: "button", minTimeoutMs: "LOW", maxTimeoutMs: "HIGH" }];
    expect(reversed(blocks, { LOW: 2000, HIGH: 500 })).toHaveLength(1);
    expect(reversed(blocks, { LOW: 500, HIGH: 2000 })).toHaveLength(0);
  });

  it("accepts equal values and unknown variables", () => {
    expect(reversed([{ name: "P", type: "delay", minMs: 1000, maxMs: 1000 }])).toHaveLength(0);
    expect(reversed([{ name: "P", type: "delay", minMs: "X", maxMs: 1000 }])).toHaveLength(0);
  });
});
