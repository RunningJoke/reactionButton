import { describe, expect, it } from "vitest";
import { z } from "zod";
import { uuidv7 } from "../src/core/ids";

describe("uuidv7", () => {
  it("is a valid UUID v7 and sorts in creation order, also within one millisecond", () => {
    const ids = Array.from({ length: 5000 }, () => uuidv7(1_800_000_000_000));
    for (const id of ids.slice(0, 10)) expect(z.uuid({ version: "v7" }).safeParse(id).success, id).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
