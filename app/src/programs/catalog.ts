/** Overview of the programs and library fragments in a set of files (pod or shipped). */
import { INDEX_PATH, isLibraryPath } from "@reactpod/program-model";
import { isObject, isProgramFile, type MenuGroup } from "@reactpod/program-model";
import { resolveProgram, validateProgram, type FileSource, type Issue, type ValidateOptions } from "@reactpod/program-model";
import { byteLength } from "../pod/utf8";

export type CatalogEntry = {
  path: string;
  kind: "program" | "fragment" | "broken";
  name: string;
  description?: string;
  peripherals: number;
  menu: MenuGroup[];
  blocks: number;
  size: number;
  inMenu: boolean;
  issues: Issue[];
};

export type Catalog = {
  /** programs in menu order, then programs that are not in the menu */
  programs: CatalogEntry[];
  library: CatalogEntry[];
  /** menu entries whose file is missing */
  missing: string[];
};

export function menuOf(source: FileSource): string[] {
  try {
    const index = JSON.parse(source(INDEX_PATH) ?? "") as unknown;
    if (isObject(index) && Array.isArray(index.programs)) return index.programs.filter((p): p is string => typeof p === "string");
  } catch {
    // no or broken menu file
  }
  return [];
}

export function buildCatalog(paths: Iterable<string>, source: FileSource, options: ValidateOptions = {}): Catalog {
  const all = [...paths].filter((p) => p !== INDEX_PATH);
  const menu = menuOf(source);
  const inMenu = new Set(menu);
  const entries = new Map<string, CatalogEntry>();

  for (const path of all) {
    const text = source(path);
    if (text === undefined) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      doc = null;
    }
    const base = { path, size: byteLength(text), inMenu: inMenu.has(path) };
    if (isProgramFile(doc) && !isLibraryPath(path)) {
      const resolved = validateProgram(path, source, options);
      entries.set(path, {
        ...base,
        kind: "program",
        name: doc.name,
        description: typeof doc.description === "string" ? doc.description : undefined,
        peripherals: typeof doc.peripherals === "number" ? doc.peripherals : 0,
        menu: Array.isArray(doc.menu) ? doc.menu : [],
        blocks: resolved.blocks.length,
        issues: resolved.issues,
      });
    } else if (isObject(doc)) {
      const resolved = resolveProgram(path, source);
      entries.set(path, {
        ...base,
        kind: "fragment",
        name: fileName(path),
        description: typeof doc.description === "string" ? doc.description : undefined,
        peripherals: 0,
        menu: [],
        blocks: Array.isArray(doc.blocks) ? doc.blocks.length : 0,
        issues: resolved.issues,
      });
    } else {
      entries.set(path, { ...base, kind: "broken", name: fileName(path), peripherals: 0, menu: [], blocks: 0, issues: resolveProgram(path, source).issues });
    }
  }

  const programs = [
    ...menu.map((p) => entries.get(p)).filter((e): e is CatalogEntry => e !== undefined),
    ...[...entries.values()].filter((e) => !inMenu.has(e.path) && !isLibraryPath(e.path) && e.kind !== "fragment").sort(byPath),
  ];
  const library = [...entries.values()].filter((e) => isLibraryPath(e.path) || (e.kind === "fragment" && !inMenu.has(e.path))).sort(byPath);
  return { programs, library, missing: menu.filter((p) => !entries.has(p)) };
}

function byPath(a: CatalogEntry, b: CatalogEntry) {
  return a.path < b.path ? -1 : 1;
}

/** "/prog/lib/loop.json" → "loop" */
export function fileName(path: string): string {
  return path.split("/").pop()!.replace(/\.json$/, "");
}
