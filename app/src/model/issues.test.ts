import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import { ISSUE_CODES } from "@reactpod/program-model";

describe("issue messages", () => {
  it("every issue code has a message", () => {
    expect(Object.keys(en.issues).sort()).toEqual([...ISSUE_CODES].sort());
  });
});
