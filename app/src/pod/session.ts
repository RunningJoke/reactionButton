/**
 * The connection to one pod, as the UI sees it. Owns the transport and the PodClient,
 * reads `info`, `status` and `list` after connecting, keeps the serial log for the debug console.
 */
import { create } from "zustand";
import { DEFAULT_FILES } from "../defaults";
import { fileCache } from "../store/fileCache";
import { PodClient } from "./client";
import { readFile } from "./files";
import { linkResults } from "../results/podLink";
import { PROGRAM_FORMAT } from "@reactpod/program-model";
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
  /** file texts read from the pod (path → text), filled after connecting */
  files: Record<string, string>;
  /** download progress while files are read */
  loading: { done: number; total: number } | null;
  error: SessionError | null;
  log: LogEntry[];
  client: PodClient | null;
  /** the PIN was accepted on this connection (`auth`) */
  authenticated: boolean;

  connect: (kind: TransportKind) => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  clearLog: () => void;
  /** Sends the PIN. Rejects with PodError `auth_failed` on a wrong PIN. */
  authenticate: (pin: string) => Promise<void>;
  /** Stores the set name ("" clears it). Needs `authenticate` first if `needsPin`. */
  renameSet: (name: string) => Promise<void>;
};

/** Writes are only allowed on a central (decision O6). */
export function isReadOnly(session: Pick<PodSession, "role">): boolean {
  return session.role !== "central";
}

export function firmwareSupported(info: InfoResponse | null): boolean {
  if (!info) return true;
  return Number.parseInt(info.firmware, 10) === SUPPORTED_FIRMWARE_MAJOR;
}

/** The pod's block types have fields, ports or semantics the app does not know (firmware CR-2). */
export function programFormatNewer(info: InfoResponse | null): boolean {
  return (info?.programFormat ?? 1) > PROGRAM_FORMAT;
}

/** Write ops (put, delete, setName) need the PIN first. */
export function needsPin(session: Pick<PodSession, "info" | "authenticated">): boolean {
  return session.info?.pinRequired === true && !session.authenticated;
}

export function hasFeature(info: InfoResponse | null, feature: string): boolean {
  return info?.features?.includes(feature) ?? false;
}

/** Name to show for the set: the stored set name, else the advertised name, else the set id. */
export function setLabel(session: Pick<PodSession, "info" | "deviceName">): string | null {
  return session.info?.setName || session.deviceName || (session.info ? `ReactPod ${session.info.setId.slice(-4)}` : null);
}

function createTransport(kind: TransportKind): Transport {
  switch (kind) {
    case "ble":
      return new BleTransport();
    case "serial":
      return new WebSerialTransport();
    case "simulated":
      // the demo pod is program format 5 (firmware 2.11): reports and remote ops (#41 / #42)
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
    set({ state: "disconnected", client: null, info: null, role: null, list: null, deviceName: null, files: {}, loading: null, authenticated: false });
  };

  /** Reads every listed file that is not cached yet (by size + CRC). */
  const loadFiles = async (client: PodClient, list: ListResponse) => {
    const files: Record<string, string> = {};
    const missing: ListResponse["files"] = [];
    for (const entry of list.files) {
      const cached = await fileCache.get(entry.size, entry.crc);
      if (cached !== undefined) files[entry.path] = cached;
      else missing.push(entry);
    }
    set({ files: { ...files }, loading: missing.length ? { done: 0, total: missing.length } : null });
    for (const [i, entry] of missing.entries()) {
      const { text } = await readFile(client, entry.path, { chunkBytes: get().info?.maxGetChunk ?? 2048 });
      await fileCache.put(text);
      files[entry.path] = text;
      if (get().client !== client) return; // disconnected meanwhile
      set({ files: { ...files }, loading: i + 1 < missing.length ? { done: i + 1, total: missing.length } : null });
    }
  };

  return {
    state: "disconnected",
    kind: null,
    deviceName: null,
    info: null,
    role: null,
    list: null,
    files: {},
    loading: null,
    error: null,
    log: [],
    client: null,
    authenticated: false,

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
        return;
      }
      // a failed download is reported, the connection stays
      await loadFiles(client, get().list!).catch((e: unknown) => set({ error: toSessionError(e), loading: null }));
      // reports of `communicate` blocks (#41): only pods with the "reports" feature
      if (get().client === client) {
        const results = linkResults(client, get().info!, {
          programText: (path) => (get().client === client ? get().files[path] : undefined),
          log: (text) => append({ t: Date.now(), kind: "log", text }),
        });
        unsubscribe.push(results.stop);
        await results.started;
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
        await loadFiles(client, list);
      } catch (e) {
        set({ error: toSessionError(e), loading: null });
      }
    },

    clearLog() {
      set({ log: [] });
    },

    async authenticate(pin) {
      const client = get().client;
      if (!client) throw new PodError("disconnected", "not connected", "auth");
      try {
        await client.auth(pin);
      } catch (e) {
        if (get().client === client) set({ authenticated: false });
        throw e;
      }
      if (get().client === client) set({ authenticated: true });
    },

    async renameSet(name) {
      const client = get().client;
      if (!client) throw new PodError("disconnected", "not connected", "setName");
      const response = await client.setName(name);
      const info = get().info;
      if (get().client === client && info) set({ info: { ...info, setName: response.setName } });
    },
  };
});
