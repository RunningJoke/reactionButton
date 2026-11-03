import { describe, expect, it } from "vitest";
import { labelsOf, storyOf, validateProgram, type Issue } from "./index";

const PATH = "/prog/t.json";

function check(extra: Record<string, unknown>): Issue[] {
  const doc = { version: 1, name: "T", blocks: [{ name: "L", type: "led", color: "off" }], ...extra };
  return validateProgram(PATH, (p) => (p === PATH ? JSON.stringify(doc) : undefined)).issues.filter((i) => i.code.startsWith("text"));
}
const codes = (issues: Issue[]) => issues.map((i) => `${i.severity}:${i.code}`);

describe("program texts (story, labels)", () => {
  it("accepts en and de, at the limits (code points, not UTF-16 units)", () => {
    expect(check({ story: { en: "a".repeat(255), de: "😀".repeat(255) }, labels: { lap: { en: "Lap", de: "ä".repeat(32) } } })).toEqual([]);
  });

  it("rejects a story over 255 and a label over 32 characters", () => {
    expect(codes(check({ story: { en: "a".repeat(256) } }))).toEqual(["error:textTooLong"]);
    expect(codes(check({ labels: { lap: { de: "a".repeat(33) } } }))).toEqual(["error:textTooLong"]);
  });

  it("rejects control characters, empty and non-string texts, wrong shapes", () => {
    expect(codes(check({ story: { en: "one\ntwo" } }))).toEqual(["error:textControlChars"]);
    expect(codes(check({ story: { en: "tab\there" } }))).toEqual(["error:textControlChars"]);
    expect(codes(check({ story: { en: " " } }))).toEqual(["error:textInvalid"]);
    expect(codes(check({ story: { en: 5 } }))).toEqual(["error:textInvalid"]);
    expect(codes(check({ story: "text" }))).toEqual(["error:textInvalid"]);
    expect(codes(check({ labels: [] }))).toEqual(["error:textInvalid"]);
  });

  it("warns about other languages", () => {
    expect(codes(check({ story: { en: "x", fr: "y" } }))).toEqual(["warning:textLanguageUnknown"]);
  });

  it("storyOf / labelsOf: language, region suffix, English fallback", () => {
    const doc = { story: { en: "E", de: "D" }, labels: { lap: { en: "Lap", de: "Runde" }, x: { en: "X" } } };
    expect(storyOf(doc, "de-DE")).toBe("D");
    expect(storyOf({ story: { en: "E" } }, "de")).toBe("E");
    expect(storyOf({}, "en")).toBeUndefined();
    expect(labelsOf(doc, "de")).toEqual({ lap: "Runde", x: "X" });
    expect(labelsOf({}, "de")).toEqual({});
  });
});
