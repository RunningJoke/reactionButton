import { describe, expect, it } from "vitest";
import { batteryPercent } from "./battery";

describe("batteryPercent (firmware Battery.cpp table)", () => {
  it("is 0 % at 3.3 V and 100 % at 4.2 V, and clamps outside", () => {
    expect(batteryPercent(3300)).toBe(0);
    expect(batteryPercent(3000)).toBe(0);
    expect(batteryPercent(4200)).toBe(100);
    expect(batteryPercent(4500)).toBe(100);
  });

  it("interpolates linearly between the table points (rounded down)", () => {
    expect(batteryPercent(3600)).toBe(15);
    expect(batteryPercent(3950)).toBe(67);
    expect(batteryPercent(4080)).toBe(87);
    expect(batteryPercent(3760)).toBe(39);
  });

  it("is monotonic", () => {
    let last = -1;
    for (let mv = 3250; mv <= 4250; mv += 10) {
      const percent = batteryPercent(mv);
      expect(percent).toBeGreaterThanOrEqual(last);
      last = percent;
    }
  });
});
