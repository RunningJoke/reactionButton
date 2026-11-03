/** What a game row says about the pods it needs (programs.md §6). */
import type { TFunction } from "i18next";
import type { CatalogEntry } from "./catalog";

/** Pod software that introduced each program format. shortcut: extend when PROGRAM_FORMAT rises (programs.md §6) */
export const FIRMWARE_OF_FORMAT: Record<number, string> = { 2: "2.8", 3: "2.9", 4: "2.10", 5: "2.11", 6: "2.13" };

/** "Main pod only" / "Main pod + 2 pods" */
export function podsNeeded(peripherals: number, t: TFunction): string {
  return peripherals === 0 ? t("programs.mainOnly") : t("programs.mainPlus", { count: peripherals });
}

/** The first sentence of a description. A format note ("Needs programFormat …") is a chip, not a summary. */
export function summaryOf(description: string | undefined): string | undefined {
  return (description ?? "")
    .split(/\n|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .find((s) => s !== "" && !s.startsWith("Needs programFormat"));
}

/** The pod software a game needs, when the connected pod (its program format) is older. */
export function olderPodNeeds(entry: CatalogEntry, podFormat: number | undefined): string | undefined {
  if (entry.kind !== "program" || podFormat === undefined || entry.format <= podFormat) return undefined;
  return FIRMWARE_OF_FORMAT[entry.format];
}
