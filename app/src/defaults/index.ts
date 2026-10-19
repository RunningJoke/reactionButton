/**
 * The shipped programs (../firmware/data, the same files `pio run -t uploadfs` writes), bundled at build
 * time as raw text so sizes and CRCs match the pod byte for byte. Used for "restore defaults",
 * as the read-only library and in tests.
 */
const raw = import.meta.glob(["../../../firmware/data/programs.json", "../../../firmware/data/prog/**/*.json"], {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const PREFIX = "../../../firmware/data";

/** Store path ("/prog/solo.json") → file text. */
export const DEFAULT_FILES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(raw)
      .map(([key, text]) => [key.slice(PREFIX.length), text] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  ),
);

export function defaultFile(path: string): string | undefined {
  return DEFAULT_FILES[path];
}
