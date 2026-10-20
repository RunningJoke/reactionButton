import { describe, expect, it } from "vitest";
import { DEFAULT_FILES } from "../defaults";
import { colorToRgb, isColor, isNamedColor } from "@reactpod/program-model";
import { formatIndex, formatProgram } from "@reactpod/program-model";
import { isValidPath, MAX_PATH, pathForName } from "@reactpod/program-model";

describe("defaults", () => {
  it("bundles the shipped programs from firmware/data/", () => {
    expect(Object.keys(DEFAULT_FILES)).toEqual(
      expect.arrayContaining(["/programs.json", "/prog/solo.json", "/prog/duo.json", "/prog/lib/loop.json"]),
    );
    expect(Object.keys(DEFAULT_FILES)).not.toContain("/homepage.html");
  });
});

describe("paths", () => {
  it.each([
    ["/programs.json", true],
    ["/prog/solo.json", true],
    ["/prog/lib/loop.json", true],
    ["/prog/a_b-c.1.json", true],
    ["/prog/", false],
    ["/prog/x/", false],
    ["/prog//x.json", false],
    ["/prog/../x.json", false],
    ["/prog/ü.json", false],
    ["/prog/a b.json", false],
    ["/other.json", false],
    ["/prog/" + "a".repeat(MAX_PATH - 6), true],
    ["/prog/" + "a".repeat(MAX_PATH - 5), false],
    ["/prog/" + "a".repeat(MAX_PATH - 11) + ".json", true],
  ])("isValidPath(%s) = %s", (path, valid) => {
    expect(isValidPath(path)).toBe(valid);
  });

  it("makes valid paths from names", () => {
    expect(pathForName("Übung Sprint 2")).toBe("/prog/uebung-sprint-2.json");
    expect(pathForName("   ")).toBe("/prog/program.json");
    const long = pathForName("A very long program name that does not fit");
    expect(long.length).toBeLessThanOrEqual(MAX_PATH);
    expect(isValidPath(long)).toBe(true);
  });

  it("avoids taken paths and the library", () => {
    expect(pathForName("solo", new Set(["/prog/solo.json"]))).toBe("/prog/solo-2.json");
    expect(pathForName("x", new Set(["/prog/x.json", "/prog/x-2.json"]))).toBe("/prog/x-3.json");
  });
});

describe("colours", () => {
  it("accepts the firmware colour forms", () => {
    expect(isColor("red")).toBe(true);
    expect(isColor("Black")).toBe(true);
    expect(isColor("#FF8800")).toBe(true);
    expect(isColor([255, 136, 0])).toBe(true);
    expect(isColor("#F80")).toBe(false);
    expect(isColor([256, 0, 0])).toBe(false);
    expect(isColor("orange")).toBe(false);
  });

  it("allows only named colours towards peripherals", () => {
    expect(isNamedColor("green")).toBe(true);
    expect(isNamedColor("#00FF00")).toBe(false);
  });

  it("converts to RGB", () => {
    expect(colorToRgb("cyan")).toEqual([0, 255, 255]);
    expect(colorToRgb("#FF8800")).toEqual([255, 136, 0]);
    expect(colorToRgb("black")).toEqual([0, 0, 0]);
  });
});

describe("format", () => {
  it("round-trips every shipped file without changing its content", () => {
    for (const [path, text] of Object.entries(DEFAULT_FILES)) {
      if (path === "/programs.json") continue;
      const doc = JSON.parse(text) as Record<string, unknown>;
      const formatted = formatProgram(doc);
      expect(JSON.parse(formatted), path).toEqual(doc);
      // the shipped files use the same layout, so the size stays about the same
      expect(formatted.length, path).toBeLessThan(text.length * 1.1 + 20);
    }
  });

  it("writes one block per line in a stable key order", () => {
    const text = formatProgram({
      blocks: [{ next: "B", ms: 100, type: "delay", name: "A" }],
      name: "X",
      version: 1,
    });
    expect(text).toBe('{\n  "version": 1,\n  "name": "X",\n  "blocks": [\n    { "name": "A", "type": "delay", "ms": 100, "next": "B" }\n  ]\n}\n');
  });

  it("formats the index like firmware/data/programs.json", () => {
    const index = JSON.parse(DEFAULT_FILES["/programs.json"]!) as { programs: string[] };
    expect(formatIndex(index.programs).replace(/\r\n/g, "\n")).toBe(DEFAULT_FILES["/programs.json"]!.replace(/\r\n/g, "\n"));
  });
});
