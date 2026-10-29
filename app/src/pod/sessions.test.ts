import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FILES } from "../defaults";
import { MemoryResultStorage } from "../results/resultStore";
import { useResults } from "../results/results";
import { SimulatedPod } from "./simulated/SimulatedPod";
import { SimulatedTransport } from "./simulated/SimulatedTransport";
import { connectPod, disconnectPod, DEMO_SETS, setLabel, usePodSession, usePodSessions } from "./session";
import type { Transport, Unsubscribe } from "./transport/Transport";

/**
 * A BLE-like link to a SimulatedPod: the test drops it, `reconnect` brings it back to the same pod
 * (like BleTransport after a link loss, #46).
 */
class FlakyLink implements Transport {
  readonly kind = "ble" as const;
  readonly inner: SimulatedTransport;
  reconnects = 0;

  constructor(readonly pod: SimulatedPod) {
    this.inner = new SimulatedTransport(pod);
  }

  get connected() {
    return this.inner.connected;
  }

  connect() {
    return this.inner.connect();
  }

  disconnect() {
    return this.inner.disconnect();
  }

  reconnect = async () => {
    this.reconnects++;
    await this.inner.connect();
  };

  send(line: string) {
    return this.inner.send(line);
  }

  onLine(listener: (line: string) => void): Unsubscribe {
    return this.inner.onLine(listener);
  }

  onDisconnect(listener: () => void): Unsubscribe {
    return this.inner.onDisconnect(listener);
  }

  /** the radio link breaks without anybody asking */
  drop() {
    void this.inner.disconnect();
  }
}

const settle = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error("condition not reached in time");
    await settle(5);
  }
}

async function endAll() {
  for (const entry of usePodSessions.getState().entries) await entry.store.getState().disconnect();
  usePodSessions.setState({ entries: [], activeId: null });
}

function resetResults() {
  const storage = new MemoryResultStorage(true);
  useResults.setState({ loaded: false, athletes: [], sessions: [], reports: [], sets: {}, storage, durable: true });
}

describe("pod sessions", () => {
  beforeEach(async () => {
    await endAll();
    resetResults();
  });
  afterEach(endAll);

  it("keeps one set at a time: a new connection ends the previous one", async () => {
    await connectPod("simulated");
    const first = usePodSessions.getState().entries[0]!;
    expect(first.store.getState().state).toBe("connected");
    expect(first.store.getState().info!.setId).toBe(DEMO_SETS[0]!.setId);
    expect(usePodSession.getState().id).toBe(first.id);
    expect((await first.store.getState().client!.list()).menu.length).toBeGreaterThan(0);

    await connectPod("simulated");
    const entries = usePodSessions.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).not.toBe(first.id);
    expect(first.store.getState().state).toBe("disconnected");
    expect(entries[0]!.store.getState().state).toBe("connected");
    expect(usePodSessions.getState().activeId).toBe(entries[0]!.id);
    expect(setLabel(entries[0]!.store.getState())).toBeTruthy();

    await disconnectPod(entries[0]!.id);
    expect(usePodSessions.getState().entries).toHaveLength(0);
    expect(usePodSessions.getState().activeId).toBeNull();
  });

  it("reconnects a lost link and fetches and acks the reports the pod kept meanwhile", async () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES });
    const link = new FlakyLink(pod);
    await connectPod("ble", { transport: link, retryBaseMs: 0 });
    const id = usePodSessions.getState().activeId!;
    expect(usePodSession.getState().state).toBe("connected");

    link.drop();
    await waitFor(() => usePodSession.getState().state === "reconnecting" || link.reconnects > 0);
    // the set stays in the list with its data while the link is down
    expect(usePodSessions.getState().entries.map((e) => e.id)).toEqual([id]);
    expect(usePodSession.getState().info?.setId).toBe(DEMO_SETS[0]!.setId);

    // a report while nobody listens: the pod keeps it until it is acknowledged
    pod.emitSampleReport(() => 0.5);
    expect(pod.pendingReports).toHaveLength(1);

    await waitFor(() => usePodSession.getState().state === "connected");
    expect(link.reconnects).toBeGreaterThanOrEqual(1);
    await waitFor(() => pod.pendingReports.length === 0);
    expect(useResults.getState().reports).toHaveLength(1);
  });

  it("does not reconnect after the user disconnected", async () => {
    const pod = new SimulatedPod({ files: DEFAULT_FILES });
    const link = new FlakyLink(pod);
    await connectPod("ble", { transport: link, retryBaseMs: 40 });
    const id = usePodSessions.getState().activeId!;

    link.drop();
    expect(usePodSession.getState().state).toBe("reconnecting");
    await disconnectPod(id);
    await settle(120);
    expect(link.reconnects).toBe(0);
    expect(usePodSessions.getState().entries).toHaveLength(0);
  });

  it("ends a session whose link drops when the transport cannot reconnect (serial, demo)", async () => {
    await connectPod("simulated");
    const transport = usePodSession.getState().client!.transport as SimulatedTransport;
    await transport.disconnect();
    expect(usePodSessions.getState().entries).toHaveLength(0);
  });
});
