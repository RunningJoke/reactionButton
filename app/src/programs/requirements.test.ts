import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { DEFAULT_FILES } from "../defaults";
import { buildCatalog, type CatalogEntry } from "./catalog";
import { olderPodNeeds, podsNeeded, summaryOf } from "./requirements";

const t = i18n.getFixedT("en");
const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
  path: "/prog/x.json",
  kind: "program",
  name: "X",
  peripherals: 0,
  menu: [],
  blocks: 1,
  format: 1,
  size: 1,
  inMenu: true,
  issues: [],
  ...over,
});

describe("pods needed", () => {
  it("says main pod only, or the main pod and the pods besides it", () => {
    expect(podsNeeded(0, t)).toBe("Main pod only");
    expect(podsNeeded(1, t)).toBe("Main pod + 1 pod");
    expect(podsNeeded(2, t)).toBe("Main pod + 2 pods");
  });
});

describe("chip only for older pod software", () => {
  const run5 = entry({ format: 5 });

  it("names the firmware of the format when the connected pod is older", () => {
    expect(olderPodNeeds(run5, 4)).toBe("2.11");
    expect(olderPodNeeds(run5, 1)).toBe("2.11");
  });

  it("shows nothing without a pod, with a pod of the same or a newer format, or for fragments", () => {
    expect(olderPodNeeds(run5, undefined)).toBeUndefined();
    expect(olderPodNeeds(run5, 5)).toBeUndefined();
    expect(olderPodNeeds(run5, 6)).toBeUndefined();
    expect(olderPodNeeds(entry({ kind: "fragment", format: 5 }), 4)).toBeUndefined();
  });
});

describe("summary", () => {
  it("takes the first sentence of the shipped descriptions", () => {
    expect(summaryOf(JSON.parse(DEFAULT_FILES["/prog/solo.json"]!).description)).toBe("Central only.");
    expect(summaryOf(JSON.parse(DEFAULT_FILES["/prog/duo.json"]!).description)).toBe("Two pods: the central and one peripheral take turns.");
  });

  it("drops a format note, which the chip shows instead", () => {
    expect(summaryOf("Needs programFormat 5 (firmware 2.11) through lib/loop.json: the cycle report.")).toBeUndefined();
    expect(summaryOf(undefined)).toBeUndefined();
  });

  it("reads the format a shipped game needs through its includes", () => {
    const catalog = buildCatalog(Object.keys(DEFAULT_FILES), (p) => DEFAULT_FILES[p]);
    // lib/loop.json shows the summary (format 6), so run.json needs 2.13; its description still says 5
    expect(catalog.programs.find((e) => e.path === "/prog/run.json")?.format).toBe(6);
  });
});
