import { describe, expect, it } from "vitest";
import { formatMs, formatSeconds } from "./stats";

describe("formatSeconds (#147 B3)", () => {
  it("shows set-up durations without trailing zeros, at most 2 decimals", () => {
    expect(formatSeconds(500, "en")).toBe("0.5 s");
    expect(formatSeconds(2000, "en")).toBe("2 s");
    expect(formatSeconds(450, "en")).toBe("0.45 s");
    expect(formatSeconds(1234, "en")).toBe("1.23 s");
    expect(formatSeconds(1500, "de")).toBe("1,5 s");
  });

  it("leaves measured times on the fixed rule", () => {
    expect(formatMs(500, "en")).toBe("0.50 s");
  });
});
