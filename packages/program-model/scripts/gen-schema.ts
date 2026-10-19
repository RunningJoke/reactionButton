/** Writes spec/program.schema.json. `--check` fails if the checked-in file is out of date. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProgramSchema } from "../src/jsonSchema";

const file = join(import.meta.dirname, "../../../spec/program.schema.json");
const text = JSON.stringify(buildProgramSchema(), null, 2) + "\n";

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  } catch {}
  if (current !== text) {
    console.error("spec/program.schema.json is out of date. Run: cd packages/program-model && npm run schema");
    process.exit(1);
  }
  console.log("spec/program.schema.json is up to date");
} else {
  writeFileSync(file, text);
  console.log(`wrote ${file}`);
}
