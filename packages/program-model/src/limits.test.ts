import { describe, expect, it } from "vitest";
import { MAX_STORE_BYTES, storeOverBudget } from "./limits";

describe("storeOverBudget", () => {
  it("is not over at exactly the limit, over by one byte", () => {
    expect(storeOverBudget([MAX_STORE_BYTES])).toBe(false);
    expect(storeOverBudget([MAX_STORE_BYTES - 1, 1])).toBe(false);
    expect(storeOverBudget([MAX_STORE_BYTES, 1])).toBe(true);
  });

  it("sums all files; an empty set is not over", () => {
    expect(storeOverBudget([])).toBe(false);
    expect(storeOverBudget([10_000, 10_000, 10_000, 10_000])).toBe(false);
    expect(storeOverBudget([100_000, 50_000])).toBe(true);
  });
});
