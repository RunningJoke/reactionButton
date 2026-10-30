import { describe, expect, it } from "vitest";
import { validateProgram, type Block } from "@reactpod/program-model";
import { BEHAVIOURS, behaviour, behavioursFor, modeOf, suggestTimerNames, timerNames } from "./behaviours";
import { ownBlocks, type ProgramJson } from "./ops";
import { stepList } from "./structure";

const files = import.meta.glob("../../../firmware/data/prog/**/*.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const texts = new Map(Object.entries(files).map(([k, v]) => [`/prog/${k.split("/prog/")[1]}`, v]));
const shipped = [...texts].map(([path, text]) => ({ path, doc: JSON.parse(text) as ProgramJson, lib: path.includes("/lib/") }));

const freeze = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const block = (doc: ProgramJson, name: string) => ownBlocks(doc).find((b) => b.name === name)!;
const issues = (path: string, doc: ProgramJson) =>
  validateProgram(path, (p) => (p === path ? JSON.stringify(doc) : texts.get(p)), { programFormat: 6 }).issues.filter((i) => i.severity === "error").map((i) => i.code);

describe("registry", () => {
  it("every behaviour has a unique id and a group", () => {
    const ids = BEHAVIOURS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(14); // the #88 table without the Fixed | Random control
  });

  it("applies per block, mode and pod format", () => {
    const ids = (b: Block, format?: number) => behavioursFor(b, format).map((x) => x.id);
    expect(ids({ name: "a", type: "led", color: "red" })).toEqual(["stopwatch", "goTo"]);
    expect(ids({ name: "a", type: "charge", maxMs: 1000 })).toEqual(["timeLimit", "holdFirst", "record", "keepResult", "stopwatch", "goTo", "podsOff"]);
    expect(ids({ name: "a", type: "charge", maxMs: 1000, mode: "accumulate" })).toContain("drains");
    expect(ids({ name: "a", type: "release", mode: "signal" })).toContain("record");
    expect(ids({ name: "a", type: "release" })).not.toContain("record");
    expect(ids({ name: "a", type: "summary", metric: "reaction" })).toContain("showBar");
    expect(ids({ name: "a", type: "summary", metric: "reaction" }, 5)).not.toContain("showBar");
    expect(ids({ name: "a", type: "communicate" })).toEqual(["timeLimit", "phoneSettings", "stopwatch", "goTo"]);
    expect(ids({ name: "a", type: "if", left: 1, right: 1 })).toEqual(["stopwatch"]);
    expect(ids({ name: "a", type: "toggle", durationMs: 1000 })).toEqual(["includeCentral", "keepResult", "stopwatch", "goTo", "podsOff"]);
    expect(ids({ name: "a", type: "effect", effect: "solid" })).not.toContain("podsOff");
    expect(ids({ name: "a", type: "effect", effect: "solid", target: "all" })).toContain("podsOff");
    expect(modeOf({ name: "a", type: "remotePress", mode: "avoid" })).toBe("avoid");
  });
});

describe("every behaviour on every block of the shipped programs", () => {
  const custom: string[] = [];
  for (const { path, doc, lib } of shipped) {
    it(`${path}: reading changes nothing, on / off round trip`, () => {
      const original = freeze(doc);
      const baseErrors = lib ? [] : issues(path, doc);
      for (const b of ownBlocks(doc)) {
        for (const beh of behavioursFor(b)) {
          const where = `${path} ${b.name} ${beh.id}`;
          const state = beh.isOn(b, doc);
          beh.summary(b, doc);
          expect(doc, `${where}: reading`).toEqual(original);
          if (state === "custom") {
            custom.push(where);
            expect(beh.turnOn(doc, b.name), `${where}: custom stays`).toBe(doc);
            expect(beh.turnOff(doc, b.name), `${where}: custom stays`).toBe(doc);
          } else if (state === "off") {
            expect(beh.turnOff(doc, b.name), `${where}: off stays`).toBe(doc);
            if (beh.id === "goTo") continue; // needs a target: tested below
            const on = beh.turnOn(doc, b.name);
            if (on === doc) continue; // nothing to add (e.g. no setting for the phone yet)
            expect(beh.isOn(block(on, b.name), on), `${where}: on`).toBe("on");
            if (!lib) expect(issues(path, on), `${where}: on is valid`).toEqual(baseErrors);
            const back = beh.turnOff(on, b.name);
            expect(beh.isOn(block(back, b.name), back), `${where}: off again`).toBe("off");
            if (!(beh.id === "avoid" && b.type === "remotePress")) expect(back, `${where}: round trip`).toEqual(original);
          } else {
            expect(beh.turnOn(doc, b.name), `${where}: on stays`).toBe(doc);
            const off = beh.turnOff(doc, b.name);
            if (off === doc) continue;
            expect(beh.isOn(block(off, b.name), off), `${where}: off`).toBe("off");
            if (!lib) expect(issues(path, off), `${where}: off is valid`).toEqual(baseErrors);
            const again = beh.turnOn(off, b.name);
            expect(beh.turnOff(again, b.name), `${where}: off, on, off`).toEqual(off);
          }
        }
      }
    });
  }

  it("lists the behaviours the registry sees only as custom", () => {
    // podsOff on a reset that other steps share (or that has fields) is custom, not guessed
    expect(custom.every((c) => c.endsWith("podsOff"))).toBe(true);
  });
});

const prog = (blocks: Block[], extra: ProgramJson = {}): ProgramJson => ({ version: 1, name: "t", start: blocks[0]!.name, blocks, ...extra });

describe("Stopwatch", () => {
  it("suggests an open timer first, then cycle and lap", () => {
    let doc = prog([
      { name: "A", type: "led", color: "red", next: "B" },
      { name: "B", type: "led", color: "blue" },
    ]);
    expect(suggestTimerNames(doc)).toEqual(["cycle", "lap"]);
    doc = behaviour("stopwatch").turnOn(doc, "A");
    expect(block(doc, "A").timerStart).toBe("cycle");
    expect(suggestTimerNames(doc)).toEqual(["cycle", "lap"]); // cycle is started and not stopped yet
    doc = behaviour("stopwatch").turnOn(doc, "B");
    expect(block(doc, "B")).toMatchObject({ timerStop: "cycle" });
    expect(block(doc, "B").timerStart).toBeUndefined();
    expect(behaviour("stopwatch").summary(block(doc, "B"), doc)).toBe("■ cycle");
  });

  it("takes names from the caller and keeps within 16 timers", () => {
    const doc = prog([{ name: "A", type: "led", color: "red" }]);
    expect(block(behaviour("stopwatch").turnOn(doc, "A", { timerStart: "lap", timerStop: "lap" }), "A")).toMatchObject({ timerStart: "lap", timerStop: "lap" });
    const full = prog([
      ...Array.from({ length: 16 }, (_, i) => ({ name: `T${i}`, type: "led", color: "red", timerStart: `t${i}` })),
      { name: "Z", type: "led", color: "red" },
    ]);
    expect(timerNames(full)).toHaveLength(16);
    expect(behaviour("stopwatch").turnOn(full, "Z", { timerStart: "extra" })).toBe(full);
    expect(block(behaviour("stopwatch").turnOn(full, "Z", { timerStart: "t3" }), "Z").timerStart).toBe("t3");
  });
});

describe("Turn pods off afterwards", () => {
  const multi = () => prog([{ name: "M", type: "remoteMultiPress", next: "End" }, { name: "End", type: "led", color: "red" }]);

  it("adds a bare reset right after the step and removes it again", () => {
    const original = multi();
    const on = behaviour("podsOff").turnOn(original, "M");
    expect(ownBlocks(on).map((b) => b.name)).toEqual(["M", "MPodsOff", "End"]);
    expect(block(on, "M").next).toBe("MPodsOff");
    expect(block(on, "MPodsOff")).toEqual({ name: "MPodsOff", type: "remoteResetAll", next: "End" });
    expect(behaviour("podsOff").isOn(block(on, "M"), on)).toBe("on");
    expect(behaviour("podsOff").turnOff(on, "M")).toEqual(original);
  });

  it("a reset with fields or other users is custom", () => {
    const withPods = prog([{ name: "M", type: "remoteMultiPress", next: "R" }, { name: "R", type: "remoteResetAll", pods: 2 }]);
    expect(behaviour("podsOff").isOn(block(withPods, "M"), withPods)).toBe("custom");
    const shared = prog([{ name: "M", type: "remoteMultiPress", next: "R", timeout: "R" }, { name: "R", type: "remoteResetAll" }]);
    expect(behaviour("podsOff").isOn(block(shared, "M"), shared)).toBe("custom");
    const bare = prog([{ name: "M", type: "remoteMultiPress", next: "R" }, { name: "R", type: "remoteResetAll" }]);
    expect(behaviour("podsOff").isOn(block(bare, "M"), bare)).toBe("on");
  });

  it("uses the main exit of charge (released) and a free name", () => {
    const doc = prog([{ name: "C", type: "charge", maxMs: 1000, released: "C" }, { name: "CPodsOff", type: "led", color: "red" }]);
    const on = behaviour("podsOff").turnOn(doc, "C");
    expect(block(on, "C").released).toBe("CPodsOff2");
  });
});

describe("Then go to…", () => {
  const chain = () =>
    prog([
      { name: "A", type: "led", color: "red", next: "B" },
      { name: "B", type: "delay", ms: 100, next: "C" },
      { name: "C", type: "led", color: "blue" },
    ]);

  it("is off for the next step and on for a jump back, listed as a branch", () => {
    expect(behaviour("goTo").isOn(block(chain(), "C"), chain())).toBe("off");
    const jump = behaviour("goTo").turnOn(chain(), "C", { target: "A" });
    expect(block(jump, "C").next).toBe("A");
    expect(behaviour("goTo").isOn(block(jump, "C"), jump)).toBe("on");
    expect(stepList(jump).find((s) => s.block === "C")!.branches[0]).toMatchObject({ port: "next", target: "A" });
    expect(behaviour("goTo").summary(block(jump, "C"), jump)).toBe("A");
    expect(behaviour("goTo").turnOn(chain(), "C", { target: "Nope" })).toEqual(chain());
    // re-aiming an exit that already jumps is allowed
    expect(block(behaviour("goTo").turnOn(jump, "C", { target: "B" }), "C").next).toBe("B");
  });

  it("off links to the step that follows in the list", () => {
    const back = prog([
      { name: "A", type: "led", color: "red", next: "B" },
      { name: "B", type: "delay", ms: 100, next: "A" },
      { name: "C", type: "led", color: "blue" },
    ]);
    const on = behaviour("goTo").isOn(block(back, "B"), back);
    expect(on).toBe("on");
    // nothing follows B in the list and it is in no loop: no guess
    expect(behaviour("goTo").turnOff(back, "B")).toBe(back);
  });
});

describe("other behaviours", () => {
  it("Central takes part is on by default and off writes false", () => {
    const doc = prog([{ name: "M", type: "remoteMultiPress" }]);
    const b = behaviour("includeCentral");
    expect(b.isOn(block(doc, "M"), doc)).toBe("on");
    const off = b.turnOff(doc, "M");
    expect(block(off, "M").includeCentral).toBe(false);
    expect(b.isOn(block(off, "M"), off)).toBe("off");
    expect(b.turnOn(off, "M")).toEqual(doc);
  });

  it("Hold first: onset on a charge, no-hold exit on a release", () => {
    const doc = prog([
      { name: "C", type: "charge", maxMs: 1000, next: "R" },
      { name: "R", type: "release", next: "End" },
      { name: "End", type: "led", color: "red" },
    ]);
    const b = behaviour("holdFirst");
    const c = b.turnOn(doc, "C");
    expect(block(c, "C").onsetMs).toBe(500);
    expect(b.turnOff(c, "C")).toEqual(doc);
    expect(block(b.turnOn(doc, "R"), "R").holdTimeoutMs).toBe(5000);
    const withExit = prog([
      { name: "R", type: "release", holdTimeoutMs: 3000, next: "End", noHold: "Cleanup" },
      { name: "End", type: "led", color: "red" },
      { name: "Cleanup", type: "led", color: "blue" },
    ]);
    const off = b.turnOff(withExit, "R");
    expect(block(off, "R").noHold).toBeUndefined();
    expect(ownBlocks(off).map((x) => x.name)).toEqual(["R", "End"]);
  });

  it("Drains over time only in accumulate mode", () => {
    const doc = prog([{ name: "C", type: "charge", maxMs: 1000, mode: "accumulate" }]);
    const b = behaviour("drains");
    expect(b.appliesTo(block(doc, "C"), "accumulate")).toBe(true);
    expect(b.appliesTo(block(doc, "C"), "release")).toBe(false);
    const on = b.turnOn(doc, "C");
    expect(block(on, "C").decayMs).toBe(2000);
    expect(b.turnOff(on, "C")).toEqual(doc);
  });

  it("Keep result: generated names, charge keeps ms and percent, toggle its five results", () => {
    const doc = prog([
      { name: "Hold", type: "charge", maxMs: 1000 },
      { name: "Game", type: "toggle", durationMs: 1000 },
    ]);
    const b = behaviour("keepResult");
    const c = b.turnOn(doc, "Hold");
    expect(block(c, "Hold")).toMatchObject({ storeAs: "HOLD_MS", storePercent: "HOLD_PERCENT" });
    expect(b.summary(block(c, "Hold"), c)).toBe("HOLD_MS +1");
    const t = b.turnOn(doc, "Game");
    expect(block(t, "Game")).toMatchObject({ storeA: "TEAM_A_PODS", storeFlips: "FLIPS" });
    expect(b.turnOff(t, "Game")).toEqual(doc);
  });

  it("Show average bar and Phone can change settings", () => {
    const doc = prog([{ name: "S", type: "summary", metric: "reaction" }, { name: "R", type: "communicate" }], { variables: { MAX_LOOPS: 3 } });
    const bar = behaviour("showBar").turnOn(doc, "S");
    expect(block(bar, "S")).toMatchObject({ show: true, targetMs: 500 });
    expect(behaviour("showBar").turnOff(bar, "S")).toEqual(doc);
    const phone = behaviour("phoneSettings").turnOn(doc, "R");
    expect(block(phone, "R").vars).toEqual(["MAX_LOOPS"]);
    expect(behaviour("phoneSettings").turnOff(phone, "R")).toEqual(doc);
    expect(behaviour("phoneSettings").turnOn(prog([{ name: "R", type: "communicate" }]), "R").blocks).toEqual([{ name: "R", type: "communicate" }]);
  });

  it("Time limit on a report: seconds and the time-out exit, off removes both", () => {
    const doc = prog([{ name: "R", type: "communicate", next: "End" }, { name: "End", type: "led", color: "red" }, { name: "Late", type: "led", color: "blue" }]);
    const b = behaviour("timeLimit");
    const on = b.turnOn(doc, "R");
    expect(block(on, "R").timeoutMs).toBe(30000);
    expect(b.isOn(block(on, "R"), on)).toBe("on");
    expect(b.isOn({ name: "R", type: "communicate", timeoutMs: 0 }, doc)).toBe("off");
    expect(b.turnOff({ ...on, blocks: ownBlocks(on).map((x) => (x.name === "R" ? { ...x, timeout: "Late" } : x)) }, "R").blocks).toHaveLength(2);
    expect(b.turnOff(on, "R")).toEqual(doc);
  });
});
