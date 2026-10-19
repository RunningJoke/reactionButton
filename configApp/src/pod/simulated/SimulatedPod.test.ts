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

  it("changes the store hash with the content", () => {
    const pod = new SimulatedPod({ files: { "/prog/a.json": "{}" } });
    const before = pod.storeHash;
    call(pod, { op: "put", path: "/prog/a.json", data: "[]" });
    expect(pod.storeHash).not.toBe(before);
    expect(pod.manifest()).toBe(`/prog/a.json\t2\t${crcHex("[]")}\n`);
  });
});
