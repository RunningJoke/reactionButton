import { describe, expect, it } from "vitest";
import { DEFAULT_FILES } from "../../defaults";
import { crcHex } from "../crc32";
import { SimulatedPod } from "./SimulatedPod";

type Json = Record<string, unknown>;

function call(pod: SimulatedPod, request: Json): Json {
  return JSON.parse(pod.handle(JSON.stringify(request))) as Json;
}

describe("SimulatedPod (config API)", () => {
  it("echoes op and id, rejects bad requests", () => {
    const pod = new SimulatedPod();
    expect(call(pod, { op: "info", id: "x1" })).toMatchObject({ op: "info", id: "x1", ok: true });
    expect(JSON.parse(pod.handle("not json"))).toMatchObject({ ok: false, error: "bad_request" });
    expect(call(pod, { op: "fly" })).toMatchObject({ ok: false, error: "bad_request" });
  });

  it("reports limits and block types in info", () => {
    const info = call(new SimulatedPod(), { op: "info" });
    expect(info).toMatchObject({ maxFileSize: 16384, maxPathLength: 31, maxRequest: 12288, maxGetChunk: 4096 });
    expect(info.blockTypes).toContain("remoteMultiPress");
  });

  it("lists files sorted, with CRCs and the menu", () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES });
    const list = call(pod, { op: "list" }) as { files: { path: string; crc: string }[]; menu: string[] };
    expect(list.files.map((f) => f.path)).toEqual([...Object.keys(DEFAULT_FILES)].sort());
    expect(list.files.find((f) => f.path === "/prog/solo.json")!.crc).toBe(crcHex(DEFAULT_FILES["/prog/solo.json"]!));
    expect(list.menu[0]).toBe("/prog/solo.json");
  });

  it("serves chunks that never end inside a character", () => {
    const text = JSON.stringify({ name: "äöü".repeat(20) });
    const pod = new SimulatedPod({ files: { "/prog/u.json": text } });
    const first = call(pod, { op: "get", path: "/prog/u.json", offset: 0, length: 10 });
    expect(first).toMatchObject({ ok: true, size: new TextEncoder().encode(text).length, eof: false, crc: crcHex(text) });
    expect(new TextEncoder().encode(first.data as string).length).toBeLessThanOrEqual(10);
    expect(call(pod, { op: "get", path: "/prog/nope.json" })).toMatchObject({ error: "not_found" });
    expect(call(pod, { op: "get", path: "/prog/u.json", offset: 10_000 })).toMatchObject({ error: "bad_offset" });
    expect(call(pod, { op: "get", path: "/etc/passwd" })).toMatchObject({ error: "bad_path" });
  });

  it("stores a chunked upload atomically and bumps the generation", () => {
    const pod = new SimulatedPod({ files: { "/prog/a.json": "{}" }, generation: 7 });
    const text = '{"name":"Übung"}';
    expect(call(pod, { op: "put", path: "/prog/a.json", offset: 0, data: text.slice(0, 5), final: false })).toMatchObject({ ok: true, received: 5 });
    expect(pod.files.get("/prog/a.json")).toBe("{}"); // untouched until the final chunk
    const done = call(pod, { op: "put", path: "/prog/a.json", offset: 5, data: text.slice(5), final: true, crc: crcHex(text) });
    expect(done).toMatchObject({ ok: true, size: 17, crc: crcHex(text), generation: 8 });
    expect(pod.files.get("/prog/a.json")).toBe(text);
  });

  it("rejects wrong offsets, CRC mismatches and invalid JSON without storing", () => {
    const pod = new SimulatedPod({ files: { "/prog/a.json": "{}" } });
    expect(call(pod, { op: "put", path: "/prog/a.json", offset: 3, data: "x" })).toMatchObject({ error: "bad_offset" });
    expect(call(pod, { op: "put", path: "/prog/a.json", data: '{"x":1}', crc: "00000000" })).toMatchObject({ error: "crc_mismatch" });
    expect(call(pod, { op: "put", path: "/prog/a.json", data: "{ nope" })).toMatchObject({ error: "invalid_json" });
    expect(call(pod, { op: "put", path: "/prog/a.json", data: "x".repeat(16385) })).toMatchObject({ ok: false });
    expect(pod.files.get("/prog/a.json")).toBe("{}");
    expect(pod.generation).toBe(1);
  });

  it("answers busy while a game runs", () => {
    const pod = new SimulatedPod({ files: { "/prog/a.json": "{}" } });
    pod.state = "RUN";
    expect(call(pod, { op: "put", path: "/prog/a.json", data: "{}" })).toMatchObject({ error: "busy" });
    expect(call(pod, { op: "delete", path: "/prog/a.json" })).toMatchObject({ error: "busy" });
    expect(call(pod, { op: "validate", path: "/prog/a.json" })).toMatchObject({ error: "busy" });
  });

  it("deletes files", () => {
    const pod = new SimulatedPod({ files: { "/prog/a.json": "{}" } });
    expect(call(pod, { op: "delete", path: "/prog/a.json" })).toMatchObject({ ok: true, generation: 2 });
    expect(call(pod, { op: "delete", path: "/prog/a.json" })).toMatchObject({ error: "not_found" });
  });

  it("validates programs with their includes", () => {
    const pod = new SimulatedPod({ files: { ...DEFAULT_FILES, "/prog/bad.json": JSON.stringify({ name: "Bad", blocks: [{ name: "Hit", type: "buton" }] }) } });
    expect(call(pod, { op: "validate", path: "/prog/duo.json" })).toMatchObject({ ok: true, blocks: 15 });
    const bad = call(pod, { op: "validate", path: "/prog/bad.json" });
    expect(bad).toMatchObject({ ok: false, error: "invalid_program" });
    expect(bad.message).toContain("'Hit'");
  });

  it("reports the firmware 2.9 fields in info: program format 3 with the effect block", () => {
    const info = call(new SimulatedPod({ setName: "Halle 2" }), { op: "info" });
    expect(info).toMatchObject({ firmware: "2.9", setName: "Halle 2", pinRequired: false, programFormat: 3 });
    expect(info.features).toEqual(["validateInline", "listMeta"]); // no feature flag, the format says it
    expect(info.blockTypes).toContain("repeat");
    expect(info.blockTypes).toContain("effect");
  });

  it("simulates a central with programFormat 2: no effect block", () => {
    const pod = new SimulatedPod({ programFormat: 2 });
    const info = call(pod, { op: "info" });
    expect(info).toMatchObject({ firmware: "2.8", programFormat: 2 });
    expect(info.blockTypes).not.toContain("effect");
    expect(info.blockTypes).toContain("repeat");
  });

  it("simulates an older central with programFormat 1", () => {
    const info = call(new SimulatedPod({ programFormat: 1 }), { op: "info" });
    expect(info).toMatchObject({ firmware: "2.7", programFormat: 1 });
    expect(info.blockTypes).not.toContain("repeat");
  });

  const format2 = JSON.stringify({
    name: "Laps",
    blocks: [
      { name: "R", type: "repeat", count: 3, body: "Go", done: "End" },
      { name: "Go", type: "led", color: "green", timerStart: "lap", next: "Wait" },
      { name: "Wait", type: "button", timerStop: "lap", next: "R" },
      { name: "End", type: "summary", metric: "lap" },
    ],
  });
  const timersOnly = JSON.stringify({
    name: "Lap",
    blocks: [
      { name: "Go", type: "led", color: "green", timerStart: "lap", next: "Wait" },
      { name: "Wait", type: "button", timerStop: "lap", next: "Go" },
    ],
  });

  it("accepts format-2 programs (repeat, timers)", () => {
    const pod = new SimulatedPod({ files: { "/prog/laps.json": format2 } });
    expect(call(pod, { op: "validate", path: "/prog/laps.json" })).toMatchObject({ ok: true, blocks: 4 });
    expect(call(pod, { op: "validate", path: "/prog/x.json", data: timersOnly })).toMatchObject({ ok: true, blocks: 2 });
  });

  it("a format-1 central rejects repeat but ignores timer fields, like older firmware", () => {
    const pod = new SimulatedPod({ programFormat: 1 });
    const repeat = call(pod, { op: "validate", path: "/prog/x.json", data: format2 });
    expect(repeat).toMatchObject({ ok: false, error: "invalid_program" });
    expect(repeat.message).toContain("unsupportedType");
    expect(call(pod, { op: "validate", path: "/prog/x.json", data: timersOnly })).toMatchObject({ ok: true });
  });

  it("reports status.timers.orphanStops on a central in a game (format 2)", () => {
    const pod = new SimulatedPod();
    expect(call(pod, { op: "status" })).not.toHaveProperty("timers");
    pod.state = "RUN";
    pod.orphanStops = 2;
    expect(call(pod, { op: "status" })).toMatchObject({ timers: { orphanStops: 2 } });
    pod.state = "PAUSED";
    expect(call(pod, { op: "status" })).toMatchObject({ timers: { orphanStops: 2 } });
    const old = new SimulatedPod({ programFormat: 1 });
    old.state = "RUN";
    expect(call(old, { op: "status" })).not.toHaveProperty("timers");
    const peripheral = new SimulatedPod({ role: "peripheral" });
    peripheral.state = "RUN";
    expect(call(peripheral, { op: "status" })).not.toHaveProperty("timers");
  });

  it("reports program metadata in list (listMeta)", () => {
    const pod = new SimulatedPod({ files: { ...DEFAULT_FILES, "/prog/broken.json": "{" } });
    const files = (call(pod, { op: "list" }) as { files: Json[] }).files;
    const byPath = new Map(files.map((f) => [f.path, f]));
    const duo = JSON.parse(DEFAULT_FILES["/prog/duo.json"]!) as Json;
    expect(byPath.get("/prog/duo.json")).toMatchObject({ name: duo.name, peripherals: duo.peripherals, menu: duo.menu });
    expect(byPath.get("/prog/lib/loop.json")).toMatchObject({ fragment: true });
    expect(byPath.get("/prog/lib/loop.json")).not.toHaveProperty("name");
    expect(byPath.get("/programs.json")).toEqual({ path: "/programs.json", size: expect.any(Number), crc: expect.any(String) });
    expect(Object.keys(byPath.get("/prog/broken.json")!)).toEqual(["path", "size", "crc"]);
  });

  it("validates inline data without storing it (validateInline)", () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES });
    const generation = pod.generation;
    const good = DEFAULT_FILES["/prog/duo.json"]!;
    expect(call(pod, { op: "validate", path: "/prog/new.json", data: good })).toMatchObject({ ok: true, path: "/prog/new.json", blocks: 15 });
    const bad = call(pod, { op: "validate", path: "/prog/new.json", data: JSON.stringify({ name: "X", blocks: [{ name: "Hit", type: "buton" }] }) });
    expect(bad).toMatchObject({ ok: false, error: "invalid_program" });
    expect(bad.message).toContain("'Hit'");
    expect(call(pod, { op: "validate", path: "bad", data: good })).toMatchObject({ error: "bad_path" });
    expect(pod.files.has("/prog/new.json")).toBe(false);
    expect(pod.generation).toBe(generation);
  });

  it("stores the set name", () => {
    const pod = new SimulatedPod();
    expect(call(pod, { op: "setName", name: " Halle 2 " })).toMatchObject({ ok: true, setName: "Halle 2" });
    expect(call(pod, { op: "info" })).toMatchObject({ setName: "Halle 2" });
    expect(call(pod, { op: "setName", name: "ä".repeat(9) })).toMatchObject({ error: "bad_request" });
    expect(call(pod, { op: "setName", name: "a\tb" })).toMatchObject({ error: "bad_request" });
    expect(call(pod, { op: "setName" })).toMatchObject({ ok: true, setName: "" });
  });

  it("needs the PIN for writes when one is set", () => {
    const pod = new SimulatedPod({ files: { "/prog/a.json": "{}" }, pin: "1234" });
    expect(call(pod, { op: "info" })).toMatchObject({ pinRequired: true });
    expect(call(pod, { op: "put", path: "/prog/a.json", data: "[]" })).toMatchObject({ error: "auth_required" });
    expect(call(pod, { op: "delete", path: "/prog/a.json" })).toMatchObject({ error: "auth_required" });
    expect(call(pod, { op: "setName", name: "x" })).toMatchObject({ error: "auth_required" });
    expect(call(pod, { op: "get", path: "/prog/a.json" })).toMatchObject({ ok: true });
    expect(call(pod, { op: "auth", pin: "0000" })).toMatchObject({ error: "auth_failed" });
    expect(call(pod, { op: "auth", pin: "1234" })).toMatchObject({ ok: true });
    expect(call(pod, { op: "put", path: "/prog/a.json", data: "[]" })).toMatchObject({ ok: true });
    expect(call(pod, { op: "setPin", pin: "" })).toMatchObject({ error: "bad_request" });
    pod.newSession();
    expect(call(pod, { op: "put", path: "/prog/a.json", data: "{}" })).toMatchObject({ error: "auth_required" });
  });

  it("changes the store hash with the content", () => {
    const pod = new SimulatedPod({ files: { "/prog/a.json": "{}" } });
    const before = pod.storeHash;
    call(pod, { op: "put", path: "/prog/a.json", data: "[]" });
    expect(pod.storeHash).not.toBe(before);
    expect(pod.manifest()).toBe(`/prog/a.json\t2\t${crcHex("[]")}\n`);
  });
});

describe("SimulatedPod (demo of reports and remote control, #41 / #42)", () => {
  it("is off by default, like today's firmware", () => {
    const pod = new SimulatedPod();
    expect(call(pod, { op: "reports" })).toMatchObject({ ok: false, error: "bad_request" });
    expect(() => pod.emitSampleReport()).toThrow();
  });

  it("keeps 8 reports until ack, tags the athlete, answers commands only while waiting", () => {
    const pod = new SimulatedPod({ results: true });
    expect(call(pod, { op: "info" }).features).toEqual(["validateInline", "listMeta", "reports", "remote"]);
    expect(call(pod, { op: "command", name: "continue" })).toMatchObject({ error: "not_ready" });
    expect(call(pod, { op: "session", athlete: "ath_42" })).toMatchObject({ ok: true, athlete: "ath_42" });
    for (let i = 0; i < 9; i++) pod.emitSampleReport(() => 0.5);
    const { reports } = call(pod, { op: "reports" }) as { reports: Json[] };
    expect(reports.map((r) => r.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(reports[0]).toMatchObject({ event: "report", athlete: "ath_42", program: "/prog/solo.json", setId: pod.setId });
    expect(call(pod, { op: "status" })).toMatchObject({ reports: { pending: 8, dropped: 1 } });
    expect(call(pod, { op: "ack", id: "req-1", reportId: 5 })).toMatchObject({ ok: true });
    expect(pod.pendingReports.map((r) => r.id)).toEqual([6, 7, 8, 9]);
    expect(call(pod, { op: "command", name: "repeat" })).toMatchObject({ ok: true });
    expect(call(pod, { op: "command", name: "repeat" })).toMatchObject({ error: "not_ready" });
  });
});
