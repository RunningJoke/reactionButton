/**
 * Firmware update of the connected pod (config-api.md "Firmware update", #129): chunked upload with resume,
 * check, activate, then the wait for the verdict on the new image. The protocol follows tools/reactpod_ota.py.
 * Nothing here knows the session or React: `OtaEnv` says how to get the pod's client again after a lost link.
 */
import type { PodClient } from "./client";
import { compareVersions, type FirmwareImage } from "./firmwareUpdate";
import { PodError, type InfoResponse, type OtaBeginResponse, type OtaWriteResponse, type StatusResponse } from "./protocol";

/** Raw bytes per otaWrite: the pod's `maxChunk` (3072) capped here. BLE throughput is not measured yet (#129). */
export const OTA_CHUNK = 2048;
/** A new image is on trial for 15 s after boot (config-api.md); `lastResult` is known after that. */
export const TRIAL_WAIT_MS = 17_000;
/** The pod must be reachable again this soon after a restart or a lost link. */
export const RECONNECT_TIMEOUT_MS = 60_000;
/** Below this battery level `otaBegin` answers `low_battery`. */
export const OTA_MIN_BATTERY_PERCENT = 30;
/** Link losses during the upload before the update gives up (each resumes where the pod stopped). */
const MAX_STALLS = 5;
const VERDICT_POLL_MS = 2000;

export type OtaStep = "preparing" | "sending" | "checking" | "restarting" | "testing" | "done";
export const OTA_STEPS: OtaStep[] = ["preparing", "sending", "checking", "restarting", "testing", "done"];

/** `success`: the target runs and is valid. The others never read as success. */
export type OtaOutcome = "success" | "rolledBack" | "wrongVersion" | "unconfirmed";

export class OtaCancelled extends Error {}

export type OtaEnv = {
  /**
   * The client of a connected pod. `old` is the client that failed: with `allowSame` false only another
   * client counts (the pod restarted). Waits, and rejects with PodError "timeout" after RECONNECT_TIMEOUT_MS.
   */
  next(old: PodClient | null, allowSame: boolean, signal: AbortSignal): Promise<PodClient>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
};

export type OtaHandlers = {
  signal: AbortSignal;
  step(step: OtaStep): void;
  progress(done: number, total: number): void;
};

/** Why an update cannot start now, from `info` and `status`; null = allowed. */
export type OtaBlocker = "unsupported" | "notMenu" | "lowBattery" | "needsPin";

export function otaBlocker(info: InfoResponse, status: StatusResponse | null, needsPin: boolean): OtaBlocker | null {
  if (!info.features?.includes("ota")) return "unsupported";
  // a peripheral has no game state in `status`: the pod itself answers `busy`
  if (status?.role === "central" && status.state !== "MENU") return "notMenu";
  const percent = status?.battery?.percent;
  if (percent !== undefined && percent < OTA_MIN_BATTERY_PERCENT) return "lowBattery";
  return needsPin ? "needsPin" : null;
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function isLinkLoss(e: unknown): boolean {
  return e instanceof PodError && (e.code === "disconnected" || e.code === "timeout" || e.code === "bad_offset");
}

function check(signal: AbortSignal) {
  if (signal.aborted) throw new OtaCancelled();
}

/** otaBegin, the chunks, otaEnd (or nothing, if the pod holds the verified image already). */
async function uploadOnce(client: PodClient, image: FirmwareImage, h: OtaHandlers): Promise<void> {
  const bytes = new Uint8Array(image.data);
  const size = bytes.length;
  const begin = await client.request<OtaBeginResponse>("otaBegin", { size, sha256: image.sha256, version: image.version.slice(0, 31) });
  let offset = begin.received;
  const finished = offset === size;
  const chunk = Math.min(begin.maxChunk, OTA_CHUNK);
  h.step("sending");
  h.progress(offset, size);
  while (offset < size) {
    check(h.signal);
    const part = bytes.subarray(offset, offset + chunk);
    const reply = await client.request<OtaWriteResponse>("otaWrite", { offset, data: base64(part) });
    if (reply.received !== offset + part.length) throw new PodError("protocol", `otaWrite answered ${reply.received}, expected ${offset + part.length}`, "otaWrite");
    offset = reply.received;
    h.progress(offset, size);
  }
  check(h.signal);
  h.step("checking");
  // `otaBegin` on a verified image also answers received = size, and otaEnd in `ready` is refused (not_ready)
  const ready = finished && (await client.status()).ota?.state === "ready";
  if (!ready) await client.request("otaEnd");
}

/** The upload with resume: a lost link gets the client again and goes on from `received`. */
async function upload(env: OtaEnv, client: PodClient, image: FirmwareImage, h: OtaHandlers): Promise<PodClient> {
  let stalls = 0;
  for (;;) {
    try {
      await uploadOnce(client, image, h);
      return client;
    } catch (e) {
      if (!isLinkLoss(e) || stalls >= MAX_STALLS) throw e;
      stalls++;
      client = await env.next(client, true, h.signal);
    }
  }
}

/** Waits for the verdict on the new image: reads `info` until `lastResult` is known; tolerates another restart. */
async function verdict(env: OtaEnv, client: PodClient, target: string, h: OtaHandlers): Promise<OtaOutcome> {
  let since = env.now();
  let restarts = 0;
  h.step("testing");
  for (;;) {
    check(h.signal);
    try {
      const info = await client.info();
      const result = info.ota?.lastResult;
      if (result === "rolledBack") return "rolledBack";
      if (result === "ok") return compareVersions(info.firmware, target) === 0 ? "success" : "wrongVersion";
      if (env.now() - since >= TRIAL_WAIT_MS) return "unconfirmed";
      await env.sleep(VERDICT_POLL_MS, h.signal);
    } catch (e) {
      if (!isLinkLoss(e) || restarts >= 3) throw e;
      restarts++;
      h.step("restarting");
      // a timeout may leave the same link up; after a drop only the client of the new link is connected anyway
      client = await env.next(client, true, h.signal);
      since = env.now();
      h.step("testing");
    }
  }
}

/**
 * The whole update. `image` is checked already. Returns the outcome after the restart; throws PodError for a
 * refusal or a failure (the open update is aborted, except for a lost link: it can be resumed), OtaCancelled
 * after a cancel (otaAbort sent before the image was activated).
 */
export async function runUpdate(env: OtaEnv, client: PodClient, image: FirmwareImage, h: OtaHandlers): Promise<OtaOutcome> {
  let activated = false;
  try {
    client = await upload(env, client, image, h);
    check(h.signal);
    try {
      await client.request("otaActivate");
    } catch (e) {
      // the pod restarts at once: the answer may be lost with the link
      if (!isLinkLoss(e)) throw e;
    }
    activated = true;
    h.step("restarting");
    client = await env.next(client, false, h.signal);
    return await verdict(env, client, image.version, h);
  } catch (e) {
    if (!activated && (e instanceof OtaCancelled || !isLinkLoss(e))) await client.request("otaAbort").catch(() => undefined);
    throw e;
  }
}
