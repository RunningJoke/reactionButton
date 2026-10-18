/**
 * The connection to one pod, as the UI sees it. Owns the transport and the PodClient,
 * reads `info`, `status` and `list` after connecting, keeps the serial log for the debug console.
 */
import { create } from "zustand";
import { DEFAULT_FILES } from "../defaults";
import { PodClient } from "./client";
import { PodError, type InfoResponse, type ListResponse, type PodEvent, type PodRole } from "./protocol";
import { SimulatedPod } from "./simulated/SimulatedPod";
import { SimulatedTransport } from "./simulated/SimulatedTransport";
import { BleTransport } from "./transport/BleTransport";
import type { Transport, TransportKind } from "./transport/Transport";
import { WebSerialTransport } from "./transport/WebSerialTransport";

export type SessionState = "disconnected" | "connecting" | "connected";

/** Firmware major version the app is written for. */
export const SUPPORTED_FIRMWARE_MAJOR = 2;

export type SessionError = { code: string; message: string };

export type LogEntry = { t: number; kind: "log" | "event"; text: string };

const LOG_LIMIT = 300;

type PodSession = {
  state: SessionState;
  kind: TransportKind | null;
  deviceName: string | null;
  info: InfoResponse | null;
  role: PodRole | null;
  list: ListResponse | null;
  error: SessionError | null;
  log: LogEntry[];
  client: PodClient | null;

  connect: (kind: TransportKind) => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  clearLog: () => void;
};

/** Writes are only allowed on a central (decision O6). */
export function isReadOnly(session: Pick<PodSession, "role">): boolean {
  return session.role !== "central";
}

export function firmwareSupported(info: InfoResponse | null): boolean {
  if (!info) return true;
  return Number.parseInt(info.firmware, 10) === SUPPORTED_FIRMWARE_MAJOR;
}

function createTransport(kind: TransportKind): Transport {
  switch (kind) {
    case "ble":
      return new BleTransport();
    case "serial":
      return new WebSerialTransport();
    case "simulated":
      return new SimulatedTransport(new SimulatedPod({ files: DEFAULT_FILES }), { latencyMs: 30 });
  }
}

/** The user closed the browser's device chooser: not an error worth showing. */
function isUserCancel(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  const message = String((e as { message?: string } | null)?.message ?? e);
  return name === "NotFoundError" || name === "AbortError" || /cancel/i.test(message);
}

function toSessionError(e: unknown): SessionError {
  if (e instanceof PodError) return { code: e.code, message: e.message };
  const name = (e as { name?: string } | null)?.name;
  if (name === "NetworkError" || name === "InvalidStateError") return { code: "openFailed", message: String(e) };
  if (name === "SecurityError" || name === "NotAllowedError") return { code: "notAllowed", message: String(e) };
  return { code: "unknown", message: e instanceof Error ? e.message : String(e) };
}

let unsubscribe: (() => void)[] = [];

export const usePodSession = create<PodSession>((set, get) => {
  const append = (entry: LogEntry) => set((s) => ({ log: [...s.log.slice(-(LOG_LIMIT - 1)), entry] }));

  const reset = () => {
    for (const off of unsubscribe) off();
    unsubscribe = [];
    get().client?.dispose();
    set({ state: "disconnected", client: null, info: null, role: null, list: null, deviceName: null });
  };

  return {
    state: "disconnected",
    kind: null,
    deviceName: null,
    info: null,
    role: null,
    list: null,
    error: null,
    log: [],
    client: null,

    async connect(kind) {
      if (get().state !== "disconnected") return;
      set({ state: "connecting", kind, error: null });
      const transport = createTransport(kind);
      try {
        await transport.connect(); // shows the device chooser
      } catch (e) {
        set({ state: "disconnected", error: isUserCancel(e) ? null : toSessionError(e) });
        return;
      }

      const client = new PodClient(transport, { timeoutMs: kind === "ble" ? 15000 : 5000 });
      unsubscribe = [
        client.onLog((text) => append({ t: Date.now(), kind: "log", text })),
        client.onEvent((event: PodEvent) => append({ t: Date.now(), kind: "event", text: JSON.stringify(event) })),
        transport.onDisconnect(() => {
          if (get().client === client) reset();
        }),
      ];
      set({ client, deviceName: transport instanceof BleTransport ? (transport.name ?? null) : null });

      try {
        const info = await client.info();
        if (transport instanceof BleTransport && typeof info.mtu === "number") transport.setMtu(info.mtu);
        const status = await client.status();
        const list = await client.list();
        set({ state: "connected", info, role: status.role, list });
      } catch (e) {
        set({ error: toSessionError(e) });
        await transport.disconnect().catch(() => undefined);
        reset();
      }
    },

    async disconnect() {
      const client = get().client;
      if (!client) return;
      await client.transport.disconnect().catch(() => undefined);
      reset();
    },

    async refresh() {
      const client = get().client;
      if (!client) return;
      try {
        const [info, list] = [await client.info(), await client.list()];
        set({ info, list, error: null });
      } catch (e) {
        set({ error: toSessionError(e) });
      }
    },

    clearLog() {
      set({ log: [] });
    },
  };
});
