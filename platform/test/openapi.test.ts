import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { useCases } from "../src/core/registry";
import { buildOpenApi } from "../src/openapi";

describe("OpenAPI", () => {
  const doc = buildOpenApi();

  it("has one operation per use case", () => {
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p) as { operationId: string }[]);
    expect(ops.map((o) => o.operationId).sort()).toEqual(useCases.map((u) => u.name).sort());
  });

  it("matches the checked-in spec/platform-api.yaml", () => {
    const file = readFileSync(join(import.meta.dirname, "../../spec/platform-api.yaml"), "utf8");
    expect(parse(file)).toEqual(JSON.parse(JSON.stringify(doc)));
  });
});
