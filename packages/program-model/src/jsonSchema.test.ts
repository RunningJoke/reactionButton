import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { buildProgramSchema } from "./jsonSchema";

const DATA = join(import.meta.dirname, "../../../firmware/data/prog");
const read = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8"))] as const);

describe("program JSON Schema", () => {
  const schema = buildProgramSchema();
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addKeyword("x-programFormat");
  const validate = ajv.compile(schema);
  const validateFragment = ajv.compile({ $defs: schema.$defs, $ref: "#/$defs/fragment" });

  it("is a valid schema and accepts every shipped program", () => {
    for (const [file, doc] of read(DATA)) expect(validate(doc), `${file}: ${ajv.errorsText(validate.errors)}`).toBe(true);
  });

  it("accepts the shipped library fragments", () => {
    for (const [file, doc] of read(join(DATA, "lib"))) {
      expect(validateFragment(doc), `${file}: ${ajv.errorsText(validateFragment.errors)}`).toBe(true);
    }
  });

  it("rejects structural errors", () => {
    expect(validate({ name: "X", blocks: [{ name: "A", type: "led" }] })).toBe(false); // led needs color
    expect(validate({ name: "X", blocks: [{ name: "A", type: "teleport" }] })).toBe(false);
    expect(validate({ name: "X", peripherals: 9 })).toBe(false);
    expect(validate({ blocks: [] })).toBe(false); // name missing
  });

  it("matches the checked-in spec/program.schema.json", () => {
    const file = JSON.parse(readFileSync(join(import.meta.dirname, "../../../spec/program.schema.json"), "utf8"));
    expect(file).toEqual(schema);
  });
});
