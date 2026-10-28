import { describe, expect, it } from "vitest";
import { DEFAULT_FILES } from "../defaults";
import { columnLayout } from "../editor/columnLayout";
import { blockSummary } from "../editor/summary";
import { buildGraph } from "../model/graph";
import { resolveProgram } from "@reactpod/program-model";
import { MemoryFileCache } from "../store/fileCache";
import { buildCatalog, fileName } from "./catalog";

const read = (p: string) => DEFAULT_FILES[p];
const graphOf = (path: string, files: Record<string, string | undefined> = DEFAULT_FILES) =>
  buildGraph(resolveProgram(path, (p) => files[p]));

describe("graph", () => {
  it("builds every shipped program: all edges resolve, start is set, nothing unreachable", () => {
    const menu = (JSON.parse(DEFAULT_FILES["/programs.json"]!) as { programs: string[] }).programs;
    for (const path of menu) {
      const graph = graphOf(path);
      expect(graph.start, path).toBeTruthy();
      expect(graph.nodes.filter((n) => n.external), path).toEqual([]);
      const ids = new Set(graph.nodes.map((n) => n.id));
      for (const edge of graph.edges) expect(ids.has(edge.target), `${path} ${edge.id}`).toBe(true);
      expect(graph.nodes.filter((n) => n.unreachable).map((n) => n.id), path).toEqual([]);
    }
  });

  it("marks the start block and blocks from includes", () => {
    const graph = graphOf("/prog/duo.json");
    expect(graph.start).toBe("StartLoop");
    expect(graph.nodes.find((n) => n.id === "StartLoop")).toMatchObject({ start: true, own: false, file: "/prog/lib/loop.json" });
    expect(graph.nodes.find((n) => n.id === "CentralPress")).toMatchObject({ own: true, ports: ["pressed", "timeout"] });
    expect(graph.includedFiles).toEqual(["/prog/lib/loop.json"]);
  });

  it("shows targets of a fragment that live in another file as external nodes", () => {
    const graph = graphOf("/prog/lib/star.json");
    expect(graph.start).toBeNull(); // a fragment has no start of its own
    expect(graph.nodes.find((n) => n.id === "EndLoop")).toMatchObject({ external: true });
  });

  it("knows the firmware fallback to next", () => {
    const node = graphOf("/prog/run5.json").nodes.find((n) => n.id === "ActivateAll")!;
    expect(node.ports).toEqual(["next", "avoidHit"]);
    expect(node.fallbackPorts).toEqual(["timeout"]);
  });

  it("finds blocks where the program ends and blocks that are never reached", () => {
    const files = {
      "/prog/x.json": JSON.stringify({
        name: "X",
        blocks: [
          { name: "A", type: "delay", ms: 1, next: "B" },
          { name: "B", type: "led", color: "red" },
          { name: "C", type: "delay", ms: 1, next: "A" },
        ],
      }),
    };
    const graph = graphOf("/prog/x.json", files);
    expect(graph.nodes.find((n) => n.id === "B")).toMatchObject({ ends: true });
    expect(graph.nodes.find((n) => n.id === "C")).toMatchObject({ unreachable: true });
  });
});

describe("column layout", () => {
  const all = Object.keys(DEFAULT_FILES).filter((p) => p.startsWith("/prog/"));

  it("stacks every block once, start first, and draws every connection that does not just continue", () => {
    for (const path of all) {
      const graph = graphOf(path);
      const layout = columnLayout(graph);
      expect([...layout.order].sort(), path).toEqual(graph.nodes.map((n) => n.id).sort());
      if (graph.start) expect(layout.order[0], path).toBe(graph.start);
      const drawn = new Set(layout.arrows.map((a) => a.edge.id));
      for (const edge of graph.edges) {
        const i = layout.order.indexOf(edge.source);
        const continues = layout.joined.has(edge.source) && layout.order[i + 1] === edge.target;
        expect(continues !== drawn.has(edge.id), `${path}: ${edge.id}`).toBe(true);
        const arrow = layout.arrows.find((a) => a.edge.id === edge.id);
        if (arrow) expect(arrow.side, `${path}: ${edge.id}`).toBe(layout.order.indexOf(edge.target) > i ? "right" : "left");
      }
    }
  });

  it("keeps a short branch between its fork and the join (Duo)", () => {
    const { order, joined, arrows } = columnLayout(graphOf("/prog/duo.json"));
    const at = (id: string) => order.indexOf(id);
    expect(at("CentralPress")).toBeLessThan(at("CentralMiss"));
    expect(at("CentralMiss") + 1).toBe(at("CentralOff"));
    expect(joined.has("CentralMiss")).toBe(true);
    // a choice: both ports of the button are arrows, even the one to a block below
    expect(arrows.filter((a) => a.edge.source === "CentralPress").map((a) => a.edge.port).sort()).toEqual(["pressed", "timeout"]);
  });

  it("puts overlapping trunks in different lanes and shares a lane for one target", () => {
    for (const path of all) {
      const layout = columnLayout(graphOf(path));
      const lane = new Map<string, number>();
      for (const a of layout.arrows) {
        const key = `${a.side}>${a.edge.target}`;
        expect(lane.get(key) ?? a.lane, `${path}: ${key}`).toBe(a.lane);
        lane.set(key, a.lane);
        expect(a.lane, path).toBeLessThan(layout.lanes[a.side]);
      }
    }
  });
});

describe("catalog", () => {
  it("lists programs in menu order and the library separately", () => {
    const catalog = buildCatalog(Object.keys(DEFAULT_FILES), read);
    expect(catalog.programs.map((p) => p.name)).toEqual(["Solo", "Weiche", "Dreieck", "Quadrat", "Stern", "Dreizack", "Run", "Run5", "Duo", "Effects", "Charge", "Release", "Domination"]);
    expect(catalog.library.map((p) => p.name)).toEqual(["loop", "multi", "random", "star"]);
    expect(catalog.programs.find((p) => p.name === "Duo")).toMatchObject({ peripherals: 1, blocks: 15, inMenu: true, kind: "program" });
    expect(catalog.programs.every((p) => p.issues.every((i) => i.severity !== "error"))).toBe(true);
  });

  it("reports menu entries without file and programs outside the menu", () => {
    const files: Record<string, string> = {
      "/programs.json": JSON.stringify({ programs: ["/prog/gone.json"] }),
      "/prog/extra.json": JSON.stringify({ name: "Extra", blocks: [{ name: "A", type: "delay", ms: 1 }] }),
      "/prog/broken.json": "{ nope",
    };
    const catalog = buildCatalog(Object.keys(files), (p) => files[p]);
    expect(catalog.missing).toEqual(["/prog/gone.json"]);
    expect(catalog.programs.map((p) => [p.name, p.inMenu, p.kind])).toEqual([
      ["broken", false, "broken"],
      ["Extra", false, "program"],
    ]);
  });

  it("names files", () => {
    expect(fileName("/prog/lib/loop.json")).toBe("loop");
  });
});

describe("block summaries", () => {
  const t = (key: string, o?: Record<string, unknown>) => (o?.count !== undefined ? `${key}:${o.count}` : key);
  const texts = (block: Record<string, unknown>) =>
    blockSummary({ name: "B", type: "x", ...block }, t).map((p) => (p.kind === "text" ? p.text : `[${p.label}]`));

  it("summarises the main parameters", () => {
    expect(texts({ type: "delay", minMs: 500, maxMs: 2000 })).toEqual(["500–2000 ms"]);
    expect(texts({ type: "if", left: "RUNS", op: ">=", right: "MAX_LOOPS" })).toEqual(["RUNS >= MAX_LOOPS"]);
    expect(texts({ type: "setVariable", var: "RUNS", op: "+", value: 1 })).toEqual(["RUNS += 1"]);
    expect(texts({ type: "setVariable", var: "S", op: "randomOther", value: "NODE_COUNT" })).toEqual(["S = randomOther(NODE_COUNT)"]);
    expect(texts({ type: "led", color: "#FF8800", leds: [1, 2] })).toEqual(["[#FF8800]", "summary.leds:2"]);
    expect(texts({ type: "button", timeoutMs: 5000, record: "reaction" })).toEqual(["⏱ 5000 ms", "● reaction"]);
  });
});

describe("file cache", () => {
  it("finds files by size and CRC", async () => {
    const { crcHex } = await import("../pod/crc32");
    const { byteLength } = await import("../pod/utf8");
    const cache = new MemoryFileCache();
    const text = '{"a":"ü"}';
    await cache.put(text);
    expect(await cache.get(byteLength(text), "00000000")).toBeUndefined();
    expect(await cache.get(byteLength(text), crcHex(text).toUpperCase())).toBe(text);
  });
});

describe("pod session files", () => {
  it("reads all files after connecting and takes unchanged ones from the cache", async () => {
    const { usePodSession } = await import("../pod/session");
    const session = usePodSession.getState();
    await session.connect("simulated");
    expect(Object.keys(usePodSession.getState().files).sort()).toEqual(Object.keys(DEFAULT_FILES).sort());
    expect(usePodSession.getState().files["/prog/duo.json"]).toBe(DEFAULT_FILES["/prog/duo.json"]);
    expect(usePodSession.getState().loading).toBeNull();

    // second connection: everything comes from the cache, no get requests
    await usePodSession.getState().disconnect();
    await usePodSession.getState().connect("simulated");
    const client = usePodSession.getState().client!;
    const pod = (client.transport as unknown as { pod: { handle: (l: string) => string } }).pod;
    const ops: string[] = [];
    const original = pod.handle.bind(pod);
    pod.handle = (line) => {
      ops.push((JSON.parse(line) as { op: string }).op);
      return original(line);
    };
    await usePodSession.getState().refresh();
    expect(ops).toEqual(["info", "list"]);
    await usePodSession.getState().disconnect();
  });
});
