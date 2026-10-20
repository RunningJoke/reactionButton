import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { formatProgram, hasErrors, validateStore } from "./index";

/** The shipped programs as the pod sees them: store path ("/prog/solo.json") → text. */
const DATA = join(import.meta.dirname, "../../../firmware/data");
function readStore(dir: string, files: Record<string, string> = {}): Record<string, string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) readStore(full, files);
    else if (entry.name.endsWith(".json")) files["/" + relative(DATA, full).split(sep).join("/")] = readFileSync(full, "utf8");
  }
  return files;
}
const files = readStore(DATA);

describe("shipped programs (firmware/data)", () => {
  it("are all valid", () => {
    const results = validateStore((p) => files[p]);
    expect(results.size).toBeGreaterThan(1);
    for (const [path, issues] of results) expect(hasErrors(issues), `${path}: ${JSON.stringify(issues)}`).toBe(false);
  });

  it("survive formatProgram unchanged in content", () => {
    for (const [path, text] of Object.entries(files)) {
      if (path === "/programs.json") continue;
      const doc = JSON.parse(text) as Record<string, unknown>;
      expect(JSON.parse(formatProgram(doc)), path).toEqual(doc);
    }
  });
});
