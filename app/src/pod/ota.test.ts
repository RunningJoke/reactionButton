import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PodClient } from "./client";
import type { FirmwareImage } from "./firmwareUpdate";
import { OTA_CHUNK, OtaCancelled, otaBlocker, runUpdate, type OtaEnv, type OtaHandlers, type OtaStep } from "./ota";
import { PodError, type InfoResponse, type StatusResponse } from "./protocol";
import { SimulatedPod, type SimulatedPodOptions } from "./simulated/SimulatedPod";
import { SimulatedTransport } from "./simulated/SimulatedTransport";

function makeImage(size = 20_000, version = "2.20.0"): FirmwareImage {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xe9;
  for (let i = 1; i < size; i++) bytes[i] = (i * 31) & 0xff;
  return { version, sha256: createHash("sha256").update(bytes).digest("hex"), size, data: bytes.buffer };
}

/** A demo pod with a clock that `sleep` moves, and an environment that reconnects the way the session does. */
async function rig(options: SimulatedPodOptions = {}, podClockStuck = false) {
  const clock = { ms: 1_000_000 };
  const pod = new SimulatedPod({ firmware: "2.19", clock: podClockStuck ? () => 1_000_000 : () => clock.ms, ...options });
  const ops: string[] = [];
  const handle = pod.handle.bind(pod);
  pod.handle = (line) => (ops.push(JSON.parse(line).op), handle(line));
  const transport = new SimulatedTransport(pod);
  let client!: PodClient;
  const connect = async () => {
    await transport.connect();
    client = new PodClient(transport);
  };
  await connect();
  const reconnects: boolean[] = [];
  const env: OtaEnv = {
    now: () => clock.ms,
    sleep: async (ms) => void (clock.ms += ms),
    async next(_old, allowSame) {
      if (!transport.connected) {
        reconnects.push(allowSame);
        await connect();
      }
      return client;
    },
  };
  const steps: OtaStep[] = [];
  const progress: number[] = [];
  const abort = new AbortController();
  const handlers: OtaHandlers = {
    signal: abort.signal,
    step: (s: OtaStep) => void (steps.at(-1) !== s && steps.push(s)),
    progress: (done: number) => void progress.push(done),
  };
  const writes = () => ops.filter((op) => op === "otaWrite").length;
  const info = async () => (await env.next(null, true, abort.signal)).info();
  const state = async () => (await client.status()).ota?.state;
  return { pod, ops, transport, env, handlers, steps, progress, abort, reconnects, writes, state, info, client: () => client, clock };
}

describe("runUpdate on the demo pod", () => {
  it("sends the image in chunks of at most 2048 bytes, activates it and waits for the verdict", async () => {
    const r = await rig();
    const image = makeImage();
    const outcome = await runUpdate(r.env, r.client(), image, r.handlers);
    expect(outcome).toBe("success");
    expect(r.writes()).toBe(Math.ceil(image.size / OTA_CHUNK));
    expect(r.steps).toEqual(["sending", "checking", "restarting", "testing"]);
    expect(r.progress.at(-1)).toBe(image.size);
    expect(r.reconnects).toEqual([false]);
    // the verdict came after the 15 s trial, not before
    expect(r.clock.ms - 1_000_000).toBeGreaterThanOrEqual(15_000);
    expect((await r.info()).firmware).toBe("2.20.0");
  });

  it("resumes after a dropped connection where the pod stopped, without sending anything twice", async () => {
    const r = await rig();
    const image = makeImage();
    let dropped = false;
    r.handlers.progress = (done) => {
      r.progress.push(done);
      if (!dropped && done >= 3 * OTA_CHUNK) {
        dropped = true;
        void r.transport.disconnect();
      }
    };
    expect(await runUpdate(r.env, r.client(), image, r.handlers)).toBe("success");
    expect(r.reconnects[0]).toBe(true);
    expect(r.writes()).toBe(Math.ceil(image.size / OTA_CHUNK));
    // the progress went back to where the pod was, not to 0
    expect(r.progress.filter((p) => p === 0)).toHaveLength(1);
  });

  it("skips otaEnd when the pod holds the verified image already (finished upload, trap 1)", async () => {
    const r = await rig();
    const image = makeImage();
    await r.client().request("otaBegin", { size: image.size, sha256: image.sha256, version: image.version });
    const bytes = new Uint8Array(image.data);
    for (let o = 0; o < image.size; o += 3072) {
      await r.client().request("otaWrite", { offset: o, data: Buffer.from(bytes.subarray(o, o + 3072)).toString("base64") });
    }
    await r.client().request("otaEnd");
    expect(await r.state()).toBe("ready");
    const before = r.ops.length;
    expect(await runUpdate(r.env, r.client(), image, r.handlers)).toBe("success");
    // info, status (single pod or set?), otaBegin, status (to see `ready`), otaActivate: no write and no otaEnd (that would be not_ready)
    expect(r.ops.slice(before, before + 5)).toEqual(["info", "status", "otaBegin", "status", "otaActivate"]);
  });

  it("a rolled-back image is a rollback, not a success", async () => {
    const r = await rig();
    r.pod.otaSelfTestFails = true;
    expect(await runUpdate(r.env, r.client(), makeImage(), r.handlers)).toBe("rolledBack");
    expect((await r.info()).firmware).toBe("2.19");
  });

  it("a stale lastResult of the earlier update is not the verdict of this one", async () => {
    const r = await rig();
    expect(await runUpdate(r.env, r.client(), makeImage(8000, "2.20.0"), r.handlers)).toBe("success");
    expect((await r.info()).ota?.lastResult).toBe("ok");
    r.pod.otaSelfTestFails = true;
    expect(await runUpdate(r.env, r.client(), makeImage(9000, "2.21.0"), r.handlers)).toBe("rolledBack");
  });

  it("answers wrongVersion when the pod runs valid firmware that is not the target", async () => {
    const r = await rig();
    const image = makeImage(8000, "2.20.0");
    const orig = r.env.next;
    // after the restart the pod claims another version
    r.env.next = async (old, same, signal) => {
      const c = await orig(old, same, signal);
      if (!same) r.pod.firmware = "2.25";
      return c;
    };
    expect(await runUpdate(r.env, r.client(), image, r.handlers)).toBe("wrongVersion");
  });

  it("stays unconfirmed when no verdict comes in time", async () => {
    const r = await rig({}, true);
    expect(await runUpdate(r.env, r.client(), makeImage(8000), r.handlers)).toBe("unconfirmed");
  });

  it("cancel sends otaAbort and leaves the old firmware", async () => {
    const r = await rig();
    r.handlers.progress = (done) => {
      if (done >= 2 * OTA_CHUNK) r.abort.abort();
    };
    await expect(runUpdate(r.env, r.client(), makeImage(), r.handlers)).rejects.toBeInstanceOf(OtaCancelled);
    expect(await r.state()).toBe("idle");
    expect((await r.info()).firmware).toBe("2.19");
  });

  describe("errors", () => {
    const code = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (e) {
        return e instanceof PodError ? e.code : "other";
      }
      return "none";
    };

    it("busy: not in the menu", async () => {
      const r = await rig();
      r.pod.state = "RUN";
      expect(await code(() => runUpdate(r.env, r.client(), makeImage(), r.handlers))).toBe("busy");
    });

    it("low_battery", async () => {
      const r = await rig();
      r.pod.selfBatteryMv = 3650;
      expect(await code(() => runUpdate(r.env, r.client(), makeImage(), r.handlers))).toBe("low_battery");
    });

    it("auth_required, then works after auth", async () => {
      const r = await rig({ pin: "1234" });
      expect(await code(() => runUpdate(r.env, r.client(), makeImage(), r.handlers))).toBe("auth_required");
      await r.client().auth("1234");
      expect(await runUpdate(r.env, r.client(), makeImage(), r.handlers)).toBe("success");
    });

    it("too_large", async () => {
      const r = await rig();
      expect(await code(() => runUpdate(r.env, r.client(), makeImage(1_835_009), r.handlers))).toBe("too_large");
    });

    it("ota_failed: an image without the header, nothing stays open", async () => {
      const r = await rig();
      const image = makeImage();
      new Uint8Array(image.data)[0] = 0;
      expect(await code(() => runUpdate(r.env, r.client(), image, r.handlers))).toBe("ota_failed");
      expect(await r.state()).toBe("idle");
    });

    it("ota_failed: the pod's image check rejects it (otaEnd)", async () => {
      const r = await rig();
      r.pod.otaFailNextVerify = true;
      expect(await code(() => runUpdate(r.env, r.client(), makeImage(), r.handlers))).toBe("ota_failed");
      expect(await r.state()).toBe("idle");
      // a new try works
      expect(await runUpdate(r.env, r.client(), makeImage(), r.handlers)).toBe("success");
    });

    it("gives up after repeated lost links during the upload", async () => {
      const r = await rig();
      r.handlers.progress = () => void r.transport.disconnect();
      expect(await code(() => runUpdate(r.env, r.client(), makeImage(), r.handlers))).toBe("disconnected");
    });
  });
});

async function uploaded(r: Awaited<ReturnType<typeof rig>>, image: FirmwareImage) {
  const c = r.client();
  await c.request("otaBegin", { size: image.size, sha256: image.sha256, version: image.version });
  const bytes = new Uint8Array(image.data);
  for (let o = 0; o < image.size; o += 3072) await c.request("otaWrite", { offset: o, data: Buffer.from(bytes.subarray(o, o + 3072)).toString("base64") });
  await c.request("otaEnd");
  return c;
}

describe("runUpdate on a set (#133)", () => {
  const setHandlers = (r: Awaited<ReturnType<typeof rig>>, extra: Record<string, unknown> = {}) => {
    const log = { stuck: [] as boolean[], states: [] as string[][], results: [] as { id: number; result: string }[] };
    Object.assign(r.handlers, {
      pods: (pods: { state: string }[], stuck: boolean) => void (log.stuck.push(stuck), log.states.push(pods.map((p) => p.state))),
      results: (res: { id: number; result: string }[]) => void (log.results = res),
      ...extra,
    });
    return log;
  };

  it("distributes, activates when every pod is ready, and reports each pod as updated", async () => {
    const r = await rig({ pods: 3 });
    const log = setHandlers(r);
    expect(await runUpdate(r.env, r.client(), makeImage(), r.handlers)).toBe("success");
    expect(r.steps).toEqual(["sending", "checking", "distributing", "restarting", "testing", "joining"]);
    expect(r.ops.filter((o) => o === "otaDistribute")).toHaveLength(1);
    expect(log.states.some((s) => s.includes("transferring"))).toBe(true);
    expect(log.results.map((p) => p.result)).toEqual(["updated", "updated", "updated"]);
  });

  it("a failing pod stops the activation until the user updates the ready ones: mixed set, the failed pod stays old", async () => {
    const r = await rig({ pods: 3, otaFailingPods: [1] });
    let force = false;
    const log = setHandlers(r, { forced: () => force });
    const record = r.handlers.pods as (pods: { state: string }[], stuck: boolean) => void;
    r.handlers.pods = (pods, stuck) => {
      record(pods, stuck);
      if (stuck) force = true;
    };
    expect(await runUpdate(r.env, r.client(), makeImage(), r.handlers)).toBe("mixed");
    expect(log.stuck).toContain(true);
    expect(log.results.map((p) => p.result)).toEqual(["updated", "old", "updated"]);
  });

  it("a pod whose new image fails its check rolls back and is listed as old", async () => {
    const r = await rig({ pods: 2, otaRollbackPods: [0] });
    const log = setHandlers(r);
    expect(await runUpdate(r.env, r.client(), makeImage(), r.handlers)).toBe("mixed");
    expect(log.results.map((p) => p.result)).toEqual(["old", "updated"]);
  });

  it("the central rolling back is still a rollback; the pods on the new version are reported", async () => {
    const r = await rig({ pods: 2 });
    r.pod.otaSelfTestFails = true;
    const log = setHandlers(r);
    expect(await runUpdate(r.env, r.client(), makeImage(), r.handlers)).toBe("rolledBack");
    expect(log.results.map((p) => p.result)).toEqual(["updated", "updated"]);
  });

  it("otaActivate answers not_ready with the pods that are not, and force activates the ready ones", async () => {
    const r = await rig({ pods: 3, otaFailingPods: [2], otaMsPerPod: 1000 });
    const c = await uploaded(r, makeImage());
    await c.request("otaDistribute");
    r.clock.ms += 10_000;
    const err = await c.request("otaActivate").catch((e: PodError) => e);
    expect((err as PodError).code).toBe("not_ready");
    await c.request("otaActivate", { force: true });
  });

  it("a central without the distribute feature updates itself only", async () => {
    const r = await rig({ pods: 2, otaDistribute: false });
    expect(await runUpdate(r.env, r.client(), makeImage(), r.handlers)).toBe("success");
    expect(r.ops).not.toContain("otaDistribute");
    expect(r.steps).not.toContain("distributing");
  });

  it("resumes at step 2 from the central's state, without an upload", async () => {
    const r = await rig({ pods: 2 });
    const image = makeImage();
    const c = await uploaded(r, image);
    await c.request("otaDistribute");
    const writes = r.writes();
    expect(await runUpdate(r.env, c, null, r.handlers, image.version)).toBe("success");
    expect(r.writes()).toBe(writes);
    expect(r.ops.filter((o) => o === "otaDistribute")).toHaveLength(1);
  });

  it("leaving the sheet keeps the distribution; cancelling aborts it", async () => {
    for (const detach of [true, false]) {
      const r = await rig({ pods: 2 });
      setHandlers(r, { detached: () => detach });
      r.handlers.step = (s) => void (s === "distributing" && r.abort.abort());
      await runUpdate(r.env, r.client(), makeImage(), r.handlers).catch(() => undefined);
      expect(r.ops.includes("otaAbort")).toBe(!detach);
      expect((await r.client().status()).ota?.state).toBe(detach ? "ready" : "idle");
    }
  });
});

describe("otaBlocker", () => {
  const info = (features: string[] = ["ota"]) => ({ features }) as unknown as InfoResponse;
  const status = (s: Partial<StatusResponse>) => ({ role: "central", state: "MENU", ...s }) as unknown as StatusResponse;

  it("allows a central in the menu, battery 30 % or more or unknown", () => {
    expect(otaBlocker(info(), status({}), false)).toBeNull();
    expect(otaBlocker(info(), status({ battery: { percent: 30, mv: 3700 } }), false)).toBeNull();
  });

  it("names the reason", () => {
    expect(otaBlocker(info([]), status({}), false)).toBe("unsupported");
    expect(otaBlocker(info(), status({ state: "RUN" }), false)).toBe("notMenu");
    expect(otaBlocker(info(), status({ battery: { percent: 29, mv: 3690 } }), false)).toBe("lowBattery");
    expect(otaBlocker(info(), status({}), true)).toBe("needsPin");
  });

  it("does not judge the state of a peripheral", () => {
    expect(otaBlocker(info(), status({ role: "peripheral", state: undefined }), false)).toBeNull();
  });
});
