import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FILES } from "../defaults";
import { PodClient } from "./client";
import { crcHex } from "./crc32";
import { planChunks, readFile, writeFile } from "./files";
import { PodError } from "./protocol";
import { SimulatedPod } from "./simulated/SimulatedPod";
import { SimulatedTransport, type SimulatedTransportOptions } from "./simulated/SimulatedTransport";
import { Listeners, type Transport } from "./transport/Transport";
import { byteLength } from "./utf8";

async function connect(pod = new SimulatedPod({ files: DEFAULT_FILES }), options: SimulatedTransportOptions = {}) {
  const transport = new SimulatedTransport(pod, { chunkBytes: 20, ...options }); // MTU 23 → 20 bytes per indication
  await transport.connect();
  return { pod, transport, client: new PodClient(transport, { timeoutMs: 200 }) };
}

/** A program with umlauts and an emoji, big enough for several chunks. */
function bigProgram(blocks = 120) {
  return JSON.stringify(
    {
      version: 1,
      name: "Übung",
      description: "Läufer 🏃 \"schnell\"\n".repeat(10),
      blocks: Array.from({ length: blocks }, (_, i) => ({ name: `Schritt${i}`, type: "delay", ms: 100, next: `Schritt${(i + 1) % blocks}` })),
    },
    null,
    2,
  );
}

afterEach(() => vi.useRealTimers());

describe("PodClient", () => {
  it("sends requests one at a time and matches responses", async () => {
    const { client } = await connect();
    const [info, list] = await Promise.all([client.info(), client.list()]);
    expect(info.op).toBe("info");
    expect(list.menu).toContain("/prog/duo.json");
  });

  it("rejects with the pod's error code", async () => {
    const { client } = await connect();
    await expect(client.get("/prog/nope.json", 0, 100)).rejects.toMatchObject({ code: "not_found", op: "get" });
    // the queue keeps working after an error
    await expect(client.info()).resolves.toMatchObject({ ok: true });
  });

  it("sends validate with inline data, auth and setName", async () => {
    const { pod, client } = await connect(new SimulatedPod({ files: DEFAULT_FILES, pin: "1234" }));
    await expect(client.validate("/prog/x.json", DEFAULT_FILES["/prog/solo.json"])).resolves.toMatchObject({ ok: true, path: "/prog/x.json" });
    await expect(client.setName("Halle 2")).rejects.toMatchObject({ code: "auth_required", op: "setName" });
    await expect(client.auth("1234")).resolves.toMatchObject({ ok: true });
    await expect(client.setName("Halle 2")).resolves.toMatchObject({ setName: "Halle 2" });
    expect(pod.setName).toBe("Halle 2");
  });

  it("resends a request after overflow", async () => {
    const { pod, client } = await connect();
    pod.overflowNext = 2;
    await expect(client.info()).resolves.toMatchObject({ ok: true });
    pod.overflowNext = 10;
    await expect(client.info()).rejects.toMatchObject({ code: "overflow" });
  });

  it("separates firmware log lines and events from responses", async () => {
    const pod = new SimulatedPod();
    const { transport, client } = await connect(pod, { logLines: ["I (123) store: hello", '{"event":"state","state":"MENU"}'] });
    const logs: string[] = [];
    const events: unknown[] = [];
    client.onLog((l) => logs.push(l));
    client.onEvent((e) => events.push(e));
    await client.info();
    expect(logs).toEqual(["I (123) store: hello"]);
    expect(events).toEqual([{ event: "state", state: "MENU" }]);
    expect(transport.connected).toBe(true);
  });

  it("times out and fails pending requests on disconnect", async () => {
    const silent = new (class implements Transport {
      readonly kind = "simulated" as const;
      connected = true;
      lines = new Listeners<[string]>();
      drops = new Listeners<[]>();
      async connect() {}
      async disconnect() {
        this.connected = false;
        this.drops.emit();
      }
      async send() {}
      onLine(l: (line: string) => void) {
        return this.lines.add(l);
      }
      onDisconnect(l: () => void) {
        return this.drops.add(l);
      }
    })();
    const client = new PodClient(silent, { timeoutMs: 50 });
    await expect(client.info()).rejects.toMatchObject({ code: "timeout" });
    const pending = client.info();
    await silent.disconnect();
    await expect(pending).rejects.toMatchObject({ code: "disconnected" });
    await expect(client.info()).rejects.toBeInstanceOf(PodError);
  });
});

describe("file transfer", () => {
  it("reads every shipped file byte-exact over a 20-byte link", async () => {
    const { client } = await connect();
    for (const [path, text] of Object.entries(DEFAULT_FILES)) {
      const result = await readFile(client, path, { chunkBytes: 333 });
      expect(result.text, path).toBe(text);
      expect(result.crc).toBe(crcHex(text));
    }
  });

  it("writes and reads back a multi-chunk file with multi-byte characters", async () => {
    const { pod, client } = await connect(new SimulatedPod());
    const text = bigProgram();
    expect(byteLength(text)).toBeGreaterThan(4 * 1024);
    const progress: number[] = [];
    const done = await writeFile(client, "/prog/uebung.json", text, { chunkBytes: 1000, onProgress: (p) => progress.push(p.bytesDone) });
    expect(done).toMatchObject({ ok: true, size: byteLength(text), crc: crcHex(text), generation: 2 });
    expect(progress.length).toBeGreaterThan(4);
    expect(progress.at(-1)).toBe(byteLength(text));
    expect(pod.files.get("/prog/uebung.json")).toBe(text);
    expect((await readFile(client, "/prog/uebung.json", { chunkBytes: 77 })).text).toBe(text);
  });

  it("keeps every put request within maxRequest even with heavy JSON escaping", () => {
    const text = '"\\\n'.repeat(3000); // every character needs escaping
    const chunks = planChunks("/prog/x.json", text, 4096, 2000);
    expect(chunks.join("")).toBe(text);
    for (const data of chunks) expect(byteLength(JSON.stringify({ data })) + 100).toBeLessThan(2000);
  });

  it("refuses files the pod cannot store", async () => {
    const { client } = await connect(new SimulatedPod());
    await expect(writeFile(client, "/prog/x.json", "x".repeat(16385))).rejects.toMatchObject({ code: "too_large" });
  });

  it("detects a corrupted download", async () => {
    const pod = new SimulatedPod({ files: { "/prog/a.json": '{"a":1}' } });
    const { client } = await connect(pod);
    const original = pod.handle.bind(pod);
    pod.handle = (line) => original(line).replace('\\"a\\":1', '\\"a\\":2');
    await expect(readFile(client, "/prog/a.json")).rejects.toMatchObject({ code: "transfer_crc" });
  });

  it("leaves the old file intact when an upload fails", async () => {
    const pod = new SimulatedPod({ files: { "/prog/a.json": "{}" } });
    const { client } = await connect(pod);
    await expect(writeFile(client, "/prog/a.json", '{"broken": ')).rejects.toMatchObject({ code: "invalid_json" });
    expect(pod.files.get("/prog/a.json")).toBe("{}");
  });
});
