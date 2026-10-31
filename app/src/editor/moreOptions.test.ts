import { describe, expect, it } from "vitest";
import { BLOCK_TYPES, type Block } from "@reactpod/program-model";
import { BEHAVIOURS } from "./behaviours";
import { moreFieldsOf } from "./MoreOptions";

/** Every block type in each of its modes and with an effect of every kind. */
function samples(type: string): Block[] {
  const base: Block = { name: "A", type };
  switch (type) {
    case "effect":
      return ["solid", "blink", "colorShift", "fill", "off"].map((effect) => ({ ...base, effect }));
    case "charge":
      return [{ ...base }, { ...base, mode: "accumulate" }];
    case "release":
      return [{ ...base }, { ...base, mode: "signal" }];
    case "remotePress":
      return [{ ...base }, { ...base, mode: "avoid" }];
    default:
      return [base];
  }
}

describe("More options", () => {
  it("lists at most 3 entries for every block, none of them owned by a Sprinkle", () => {
    const claimed = new Set(BLOCK_TYPES.flatMap((def) => def.fields.filter((f) => f.level === "switch").map((f) => f.name)));
    for (const def of BLOCK_TYPES) {
      for (const block of samples(def.type)) {
        const fields = moreFieldsOf(block);
        expect(fields.length, `${def.type} ${JSON.stringify(block)}`).toBeLessThanOrEqual(3);
        for (const f of fields) expect(claimed.has(f.name) && def.fields.find((x) => x.name === f.name)?.group !== undefined, `${def.type}.${f.name}`).toBe(false);
      }
    }
  });

  it("every field with a group names a behaviour of the registry", () => {
    const ids = new Set<string>([...BEHAVIOURS.map((b) => b.id), "randomPause"]);
    for (const def of BLOCK_TYPES) for (const f of def.fields) if (f.group) expect(ids.has(f.group), `${def.type}.${f.name}`).toBe(true);
  });
});
