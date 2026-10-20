import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LIBRARY_DIR } from "@reactpod/program-model";

/** Reads the shipped library parts (<dataDir>/prog/lib/*.json) as store path → text. */
export function loadLibrary(dataDir: string): Record<string, string> {
  const dir = join(dataDir, LIBRARY_DIR);
  if (!existsSync(dir)) {
    console.warn(`library folder ${dir} not found; includes of /prog/lib/* will not resolve`);
    return {};
  }
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    if (name.endsWith(".json")) files[LIBRARY_DIR + name] = readFileSync(join(dir, name), "utf8");
  }
  return files;
}
