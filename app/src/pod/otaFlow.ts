/**
 * The update of the connected pod as the sheet shows it (#129): one flow at a time, kept outside React so it
 * survives the pod page unmounting while the pod restarts. `ota.ts` is the protocol; this binds it to the session.
 */
import { create } from "zustand";
import type { PodClient } from "./client";
import { FirmwareError, type FirmwareImage } from "./firmwareUpdate";
import { OtaCancelled, OTA_STEPS, RECONNECT_TIMEOUT_MS, runUpdate, type OtaEnv, type OtaOutcome, type OtaStep } from "./ota";
import { PodError } from "./protocol";
import { connectPod, usePodSession } from "./session";
import type { Transport, TransportKind } from "./transport/Transport";

export type OtaFlow = {
  /** null = no sheet */
  phase: "confirm" | "running" | "done" | "error" | null;
  /** the firmware the pod runs and the release version to install */
  from: string;
  version: string;
  step: OtaStep | null;
  done: number;
  total: number;
  /** the upload (or its resume) began at this time and byte count: the rate is measured from there */
  startedAt: number;
  startDone: number;
  outcome: OtaOutcome | null;
  /** key under firmware.update.errors */
  error: string | null;
  /** USB: the port is gone after the restart and the user has to choose it again */
  needsReconnect: boolean;
};

const IDLE: OtaFlow = { phase: null, from: "", version: "", step: null, done: 0, total: 0, startedAt: 0, startDone: 0, outcome: null, error: null, needsReconnect: false };

export const useOtaFlow = create<OtaFlow>(() => IDLE);
const set = useOtaFlow.setState;

/** Test seams: the real environment sleeps and reads the clock. */
export const otaTiming = {
  sleep: (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => (clearTimeout(timer), reject(new OtaCancelled())), { once: true });
    }),
  now: () => Date.now(),
  pollMs: 500,
  reconnectTimeoutMs: RECONNECT_TIMEOUT_MS,
};

let controller: AbortController | null = null;
let prepare: (() => Promise<FirmwareImage>) | null = null;

/** Opens the sheet for an update from `from` to `version`; `prepareImage` yields the checked image (stored one or a download). */
export function openUpdate(from: string, version: string, prepareImage: () => Promise<FirmwareImage>) {
  if (useOtaFlow.getState().phase === "running") return;
  prepare = prepareImage;
  set({ ...IDLE, phase: "confirm", from, version });
}

/** Closes the sheet; a running update is cancelled (otaAbort before the image is activated). */
export function closeUpdate() {
  controller?.abort();
  controller = null;
  prepare = null;
  set(IDLE);
}

function connectedClient(): PodClient | null {
  const s = usePodSession.getState();
  return s.state === "connected" && s.client?.transport.connected ? s.client : null;
}

function makeEnv(kind: TransportKind, transport: Transport): OtaEnv {
  return {
    now: () => otaTiming.now(),
    sleep: (ms, signal) => otaTiming.sleep(ms, signal),
    async next(old, allowSame, signal) {
      const deadline = otaTiming.now() + otaTiming.reconnectTimeoutMs;
      for (;;) {
        if (signal.aborted) throw new OtaCancelled();
        const client = connectedClient();
        if (client && (allowSame || client !== old)) {
          set({ needsReconnect: false });
          return client;
        }
        // BLE reconnects by itself (session.ts). The demo pod comes back at once. USB needs the user (the chooser).
        const s = usePodSession.getState();
        if (s.state === "disconnected" && !s.client) {
          if (kind === "simulated") await connectPod("simulated", { transport }).catch(() => undefined);
          else set({ needsReconnect: true });
        }
        if (otaTiming.now() >= deadline) throw new PodError("timeout", "the pod did not come back", "reconnect");
        await otaTiming.sleep(otaTiming.pollMs, signal);
      }
    },
  };
}

/** USB: the user chose to reconnect (must run from a click: the browser shows the port chooser). */
export function reconnectUsb() {
  void connectPod("serial");
}

function errorKey(e: unknown): string {
  if (e instanceof FirmwareError) return e.code;
  if (e instanceof PodError) return e.op === "reconnect" ? "reconnect_timeout" : e.code;
  return "unknown";
}

/** Starts the update from the confirm screen. A PIN, if the pod needs one, was sent by the sheet already. */
export async function startUpdate() {
  const session = usePodSession.getState();
  const client = session.client;
  if (!client || !prepare || useOtaFlow.getState().phase === "running") return;
  const abort = new AbortController();
  controller = abort;
  const env = makeEnv(client.transport.kind, client.transport);
  const flowIsMine = () => controller === abort;
  set({ phase: "running", step: "preparing", error: null, outcome: null, done: 0, total: 0, needsReconnect: false });
  try {
    const image = await prepare();
    if (abort.signal.aborted) throw new OtaCancelled();
    const outcome = await runUpdate(env, client, image, {
      signal: abort.signal,
      // each (re)start of the upload fixes a new point for the rate: startDone is taken from its first progress
      step: (step) => flowIsMine() && set(step === "sending" ? { step, startedAt: otaTiming.now(), startDone: -1 } : { step }),
      progress: (done, total) => {
        if (!flowIsMine()) return;
        set((s) => ({ done, total, startDone: s.startDone < 0 ? done : s.startDone }));
      },
    });
    if (flowIsMine()) set({ phase: "done", step: "done", outcome });
  } catch (e) {
    if (!flowIsMine() || e instanceof OtaCancelled) return;
    set({ phase: "error", error: errorKey(e) });
  }
}

export { OTA_STEPS };
