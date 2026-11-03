import { describe, expect, it } from "vitest";
import { canFind, podHealth } from "./setView";

describe("pod health", () => {
  it("is low below 15 %, online from 15 %", () => {
    expect(podHealth(true, { percent: 14, mv: 3600 })).toBe("low");
    expect(podHealth(true, { percent: 15, mv: 3600 })).toBe("online");
  });
  it("never calls an unknown battery low; a pod that does not answer is offline", () => {
    expect(podHealth(true, undefined)).toBe("online");
    expect(podHealth(false, { percent: 90, mv: 4100 })).toBe("offline");
  });
  it("lets Find work only before a game starts", () => {
    expect(canFind("MENU")).toBe(true);
    expect(canFind(undefined)).toBe(true);
    expect(canFind("RUN")).toBe(false);
  });
});
