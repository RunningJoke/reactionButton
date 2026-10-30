/**
 * The connections to pods, as the UI sees them (#46). One session per connected set: transport,
 * PodClient, `info`, `status`, `list`, files and the serial log. The sessions are kept in a list
 * (`usePodSessions`), one of them is the *active* session. `usePodSession` reads the active one, so the
 * Pod, Programs and Sync pages keep their single-connection code.
 *
 * A BLE link that drops is opened again while the page lives (`reconnect`). Then the app reads the
 * reports the pod kept meanwhile and acknowledges them (`linkResults`). Serial and the demo pod do not reconnect.
 */
import { create, createStore, useStore, type StoreApi } from "zustand";
import { DEFAULT_FILES } from "../defaults";
import { fileCache } from "../store/fileCache";
import { PodClient } from "./client";
import { readFile } from "./files";
import { linkResults } from "../results/podLink";
import { sendCommand, type CommandName } from "../results/podReports";
import { useResults } from "../results/results";
import { PROGRAM_FORMAT } from "@reactpod/program-model";
import { PodError, type InfoResponse, type ListResponse, type PodEvent, type PodRole, type StatusResponse } from "./protocol";
import { SimulatedPod } from "./simulated/SimulatedPod";
import { SimulatedTransport } from "./simulated/SimulatedTransport";
import { BleTransport } from "./transport/BleTransport";
import type { Transport, TransportKind, Unsubscribe } from "./transport/Transport";
import { WebSerialTransport } from "./transport/WebSerialTransport";

export type SessionState = "disconnected" | "connecting" | "connected" | "reconnecting";

/** Firmware major version the app is written for. */
export const SUPPORTED_FIRMWARE_MAJOR = 2;

export type SessionError = { code: string; message: string };

export type LogEntry = { t: number; kind: "log" | "event"; text: string };

const LOG_LIMIT = 300;
/** The delay of a reconnect try doubles per failed try, up to this. */
const RECONNECT_MAX_MS = 30_000;

/** Demo sets: distinct set ids and names, so several demo pods can be connected at once (#46). */
export const DEMO_SETS = [
  { setId: "5f3a91c2", setName: "" },
  { setId: "9b2e7d40", setName: "Halle 2" },
  { setId: "c71f0a8e", setName: "Halle 3" },
  { setId: "3e6d9b15", setName: "Halle 4" },
];

export type ConnectOptions = {
  /** a ready transport instead of the one for the kind (tests) */
  transport?: Transport;
  /** delay of the first reconnect try in ms, doubled per failed try (tests use 0) */
  retryBaseMs?: number;
};

export type PodSession = {
  /** id in the session list (the set id is known only after connecting) */
  id: string;
  state: SessionState;
  kind: TransportKind | null;
  deviceName: string | null;
  info: InfoResponse | null;
  role: PodRole | null;
  /** `status` of the connection, refreshed on `state` / `report` events and after commands (central) */
  status: StatusResponse | null;
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

  /** Adds a connection to a set (a new session, which becomes the active one). */
  connect: (kind: TransportKind) => Promise<void>;
  /** Ends this connection; a lost BLE link is not ended this way (no reconnect after it). */
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  /** Continue / Repeat / Stop pressed while nothing waits: kept, sent when a block waits. A newer one replaces it. */
  queued: CommandName | null;
  /** the queued command was refused (a definite error response) */
  queueError: PodError | null;
  queueCommand: (name: CommandName) => void;
  cancelQueued: () => void;
  clearLog: () => void;
  /** Sends the PIN. Rejects with PodError `auth_failed` on a wrong PIN. */
  authenticate: (pin: string) => Promise<void>;
  /** Stores the set name ("" clears it). Needs `authenticate` first if `needsPin`. */
  renameSet: (name: string) => Promise<void>;
  /** Internal: opens this session's connection. Use `connect`. */
  open: (kind: TransportKind, options: ConnectOptions) => Promise<void>;
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

function createTransport(kind: TransportKind, usedSetIds: string[]): Transport {
  switch (kind) {
    case "ble":
      return new BleTransport();
    case "serial":
      return new WebSerialTransport();
    case "simulated": {
      // the demo pod is program format 6 (firmware 2.13): reports and remote ops (#41 / #42), the summary bar.
      // A further demo connection gets a set of its own (#46).
      const demo = DEMO_SETS.find((d) => !usedSetIds.includes(d.setId)) ?? DEMO_SETS[0]!;
      const pod = new SimulatedPod({ files: DEFAULT_FILES, setId: demo.setId, setName: demo.setName });
      return new SimulatedTransport(pod, { latencyMs: 30 });
    }
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

/** The session list. `activeId` is the session the single-connection pages use. */
export const usePodSessions = create<{ entries: { id: string; store: StoreApi<PodSession> }[]; activeId: string | null }>(() => ({
  entries: [],
  activeId: null,
}));

let nextSessionId = 1;

/** One session: its own transport, client and reconnect logic. Used by `connectPod`. */
function createSession(id: string): StoreApi<PodSession> {
  let self!: StoreApi<PodSession>;
  // link state that is not part of what the UI renders
  let transport: Transport | null = null;
  let offTransport: Unsubscribe | null = null;
  let offClient: Unsubscribe[] = [];
  /** the user ended the connection: nothing reconnects */
  let manual = false;
  /** the handshake (info, status, list) runs: a drop is handled by `attach` */
  let handshake = false;
  /** the first handshake succeeded: a lost link is retried (BLE) instead of ending the session */
  let established = false;
  let attempts = 0;
  let retryBaseMs = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  self = createStore<PodSession>((set, get) => {
    const append = (entry: LogEntry) => set((s) => ({ log: [...s.log.slice(-(LOG_LIMIT - 1)), entry] }));

    const detachClient = () => {
      for (const off of offClient) off();
      offClient = [];
      get().client?.dispose();
    };

    /** Ends the session: nothing reconnects, the list forgets it. */
    const forget = () => {
      manual = true;
      clearTimeout(retryTimer);
      retryTimer = undefined;
      offTransport?.();
      offTransport = null;
      detachClient();
      set({ state: "disconnected", client: null, info: null, role: null, list: null, status: null, deviceName: null, files: {}, loading: null, authenticated: false, queued: null });
      registryRemove(self);
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

    /** Reports of `communicate` blocks (#41): reads the pending ones, stores and acks them. Only with the feature. */
    const startReports = async (client: PodClient) => {
      if (get().client !== client) return;
      const results = linkResults(client, get().info!, {
        programText: (path) => (get().client === client ? get().files[path] : undefined),
        log: (text) => append({ t: Date.now(), kind: "log", text }),
      });
      offClient.push(results.stop);
      await results.started;
    };

    const refreshStatus = async () => {
      const client = get().client;
      if (!client) return;
      try {
        const status = await client.status();
        if (get().client !== client) return;
        set({ status, role: status.role });
        if (status.waiting) void flushQueued(client);
        // the game ended (menu, confirm): a command still queued for it is dropped
        else if (status.state && !["RUN", "PAUSED"].includes(status.state)) set({ queued: null });
      } catch {
        // the next event or refresh tries again
      }
    };

    /** Sends the queued command once a `communicate` block waits (#87). A timed-out one may have been applied: no error, the status shows it. */
    const flushQueued = async (client: PodClient) => {
      const name = get().queued;
      if (!name || get().client !== client) return;
      set({ queued: null, queueError: null });
      try {
        await sendCommand(client, name);
        if (name === "repeat") await useResults.getState().discardLast(get().info?.setId.toLowerCase() ?? "");
      } catch (e) {
        if (e instanceof PodError && e.code !== "timeout") set({ queueError: e });
      }
      void refreshStatus();
    };

    /** Runs the handshake on a transport (chooser or reconnect): info, status, list, files, reports. */
    const attach = async (t: Transport, reconnecting: boolean): Promise<boolean> => {
      handshake = true;
      detachClient();
      const client = new PodClient(t, { timeoutMs: t instanceof BleTransport ? 15000 : 5000 });
      offClient = [
        client.onLog((text) => append({ t: Date.now(), kind: "log", text })),
        client.onEvent((event: PodEvent) => {
          append({ t: Date.now(), kind: "event", text: JSON.stringify(event) });
          if (event.event === "report" || event.event === "state") void refreshStatus();
        }),
      ];
      set({ client, deviceName: t instanceof BleTransport ? (t.name ?? null) : null });
      try {
        const info = await client.info();
        if (t instanceof BleTransport && typeof info.mtu === "number") t.setMtu(info.mtu);
        const status = await client.status();
        const list = await client.list();
        set({ state: "connected", info, role: status.role, status, list, error: null });
      } catch (e) {
        if (!reconnecting) set({ error: toSessionError(e) });
        await t.disconnect().catch(() => undefined);
        detachClient();
        handshake = false;
        return false;
      }
      established = true;
      attempts = 0;
      handshake = false;
      // after a reconnect the files are still in memory: the reports come first, so they are acked soon
      if (reconnecting) await startReports(client);
      // a failed download is reported, the connection stays
      await loadFiles(client, get().list!).catch((e: unknown) => {
        if (get().client === client) set({ error: toSessionError(e), loading: null });
      });
      if (!reconnecting) await startReports(client);
      return true;
    };

    const scheduleRetry = () => {
      if (retryTimer !== undefined) return;
      const delay = Math.min(retryBaseMs * 2 ** attempts, RECONNECT_MAX_MS);
      attempts++;
      retryTimer = setTimeout(() => void retry(), delay);
    };

    /** One try to open the link again; a failed try schedules the next one. */
    const retry = async () => {
      retryTimer = undefined;
      const t = transport;
      if (manual || !t?.reconnect) return;
      try {
        await t.reconnect();
      } catch {
        if (!manual) scheduleRetry();
        return;
      }
      if (manual) {
        await t.disconnect().catch(() => undefined);
        return;
      }
      const ok = await attach(t, true);
      if (!ok && !manual) scheduleRetry();
    };

    /** The link dropped: BLE reconnects while the page lives, everything else ends the session. */
    const lost = () => {
      if (manual || handshake) return;
      if (!transport?.reconnect || !established) {
        forget();
        return;
      }
      detachClient();
      set({ state: "reconnecting", client: null, loading: null });
      scheduleRetry();
    };

    /**
     * The set is known now. A second session of a set that is connected already is dropped (the
     * existing one stays); an old session of the same set (reconnecting) is replaced.
     */
    const adoptSet = async () => {
      const setId = get().info!.setId.toLowerCase();
      const others = usePodSessions
        .getState()
        .entries.filter((e) => e.store !== self && e.store.getState().info?.setId.toLowerCase() === setId);
      const connected = others.find((e) => e.store.getState().state === "connected");
      if (connected) {
        await get().disconnect();
        usePodSessions.setState({ activeId: connected.id });
        return;
      }
      for (const other of others) await other.store.getState().disconnect();
    };

    return {
      id,
      state: "disconnected",
      kind: null,
      deviceName: null,
      info: null,
      role: null,
      status: null,
      list: null,
      files: {},
      loading: null,
      error: null,
      log: [],
      client: null,
      authenticated: false,
      queued: null,
      queueError: null,

      connect: (kind) => connectPod(kind),

      async disconnect() {
        manual = true;
        const t = transport;
        if (t) await t.disconnect().catch(() => undefined);
        forget();
      },

      async open(kind, options) {
        manual = false;
        established = false;
        attempts = 0;
        retryBaseMs = options.retryBaseMs ?? 1000;
        set({ state: "connecting", kind, error: null });
        const used = usePodSessions
          .getState()
          .entries.flatMap((e) => (e.store.getState().info ? [e.store.getState().info!.setId.toLowerCase()] : []));
        const t = options.transport ?? createTransport(kind, used);
        transport = t;
        try {
          await t.connect(); // shows the device chooser
        } catch (e) {
          set({ error: isUserCancel(e) ? null : toSessionError(e) });
          forget();
          return;
        }
        offTransport = t.onDisconnect(() => lost());
        if (!(await attach(t, false))) {
          forget();
          return;
        }
        await adoptSet();
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

      refreshStatus,

      queueCommand(name) {
        set({ queued: name, queueError: null });
        const client = get().client;
        if (client && get().status?.waiting) void flushQueued(client);
      },

      cancelQueued() {
        set({ queued: null });
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
  return self;
}

/** The session list, by id. Removing a session that is active makes the last one active. */
function registryRemove(store: StoreApi<PodSession>) {
  const { entries, activeId } = usePodSessions.getState();
  const left = entries.filter((e) => e.store !== store);
  if (left.length === entries.length) return;
  usePodSessions.setState({
    entries: left,
    activeId: left.some((e) => e.id === activeId) ? activeId : (left.at(-1)?.id ?? null),
  });
}

/** Stands in for the active session while there is none: never connected. */
const IDLE = createSession("idle");

/** The active session's store (IDLE if there is none). */
function activeStore(): StoreApi<PodSession> {
  const { entries, activeId } = usePodSessions.getState();
  return entries.find((e) => e.id === activeId)?.store ?? IDLE;
}

/**
 * Opens a connection to a set in a new session, which becomes the active one. Resolves when the
 * handshake is done (or the attempt failed); the session list shows it meanwhile.
 *
 * One set at a time: any existing session is ended first. Several sets at once (#46) did not work on
 * the phone and is on hold; the session list stays as the structure for it.
 */
export async function connectPod(kind: TransportKind, options: ConnectOptions = {}): Promise<void> {
  for (const entry of usePodSessions.getState().entries) await entry.store.getState().disconnect();
  const store = createSession(`s${nextSessionId++}`);
  const id = store.getState().id;
  usePodSessions.setState((s) => ({ entries: [...s.entries, { id, store }], activeId: id }));
  await store.getState().open(kind, options);
}

/** Makes a session the active one (the Pod, Programs and Sync pages show it). */
export function setActivePod(id: string) {
  if (usePodSessions.getState().entries.some((e) => e.id === id)) usePodSessions.setState({ activeId: id });
}

/** Ends one connection; the set leaves the list. */
export async function disconnectPod(id: string): Promise<void> {
  const entry = usePodSessions.getState().entries.find((e) => e.id === id);
  await entry?.store.getState().disconnect();
}

function identity<T>(value: T): T {
  return value;
}

/** The active session (the single-connection API of the app). */
export function usePodSession(): PodSession;
export function usePodSession<T>(selector: (s: PodSession) => T): T;
export function usePodSession<T>(selector?: (s: PodSession) => T): T | PodSession {
  const store = usePodSessions((s) => s.entries.find((e) => e.id === s.activeId)?.store ?? IDLE);
  return useStore(store, selector ?? identity<(s: PodSession) => T | PodSession>((s) => s));
}

/** Non-hook access to the active session, as the sync actions use it (and the tests). */
usePodSession.getState = (): PodSession => activeStore().getState();
usePodSession.setState = (partial: Partial<PodSession>) => activeStore().setState(partial);
