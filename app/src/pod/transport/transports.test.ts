import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SimulatedPod } from "../simulated/SimulatedPod";
import type { SimulatedTransport } from "../simulated/SimulatedTransport";
import { PodClient } from "../client";
import { encodeUtf8 } from "../utf8";

/* ---------------------------------------------------------------- Web Serial */

/** Fake SerialPort: requests go to a SimulatedPod, responses come back in 7-byte pieces with log noise. */
class FakeSerialPort extends EventTarget {
  readonly pod = new SimulatedPod();
  readonly written: string[] = [];
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  openOptions: unknown = null;
  signalsTouched = false;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  async open(options: unknown) {
    this.openOptions = options;
    let pending = "";
    this.readable = new ReadableStream({ start: (c) => (this.controller = c) });
    this.writable = new WritableStream({
      write: (chunk) => {
        pending += new TextDecoder().decode(chunk, { stream: true });
        let nl: number;
        while ((nl = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, nl);
          pending = pending.slice(nl + 1);
          this.written.push(line);
          this.emit(`I (42) log: got request\r\n${this.pod.handle(line)}\r\n`);
        }
      },
    });
  }

  emit(text: string) {
    const bytes = encodeUtf8(text);
    for (let i = 0; i < bytes.length; i += 7) this.controller?.enqueue(bytes.slice(i, i + 7));
  }

  unplug() {
    this.controller?.error(new Error("device lost"));
    this.readable = null;
  }

  async setSignals() {
    this.signalsTouched = true;
  }

  async close() {
    this.readable = null;
    this.writable = null;
  }
}

describe("WebSerialTransport", () => {
  let port: FakeSerialPort;
  let serial: EventTarget & { requestPort: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    port = new FakeSerialPort();
    serial = Object.assign(new EventTarget(), { requestPort: vi.fn(async () => port) });
    vi.stubGlobal("navigator", { serial });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("talks to the pod, filters by Espressif VID and never touches DTR/RTS", async () => {
    const { WebSerialTransport } = await import("./WebSerialTransport");
    const transport = new WebSerialTransport();
    await transport.connect();
    expect(serial.requestPort).toHaveBeenCalledWith({ filters: [{ usbVendorId: 0x303a }] });
    expect(port.openOptions).toMatchObject({ baudRate: 115200 });

    const client = new PodClient(transport, { timeoutMs: 500 });
    const logs: string[] = [];
    client.onLog((l) => logs.push(l));
    const info = await client.info();
    expect(info.ok).toBe(true);
    expect(logs).toEqual(["I (42) log: got request"]);
    expect(port.written).toHaveLength(1);
    expect(port.signalsTouched).toBe(false);
    await transport.disconnect();
    expect(transport.connected).toBe(false);
  });

  it("reports a lost device", async () => {
    const { WebSerialTransport } = await import("./WebSerialTransport");
    const transport = new WebSerialTransport();
    await transport.connect();
    const lost = new Promise<void>((resolve) => transport.onDisconnect(resolve));
    port.unplug();
    await lost;
    expect(transport.connected).toBe(false);
  });
});

/* ---------------------------------------------------------------- BLE */

const ble = vi.hoisted(() => ({
  pod: null as unknown as import("../simulated/SimulatedPod").SimulatedPod,
  writes: [] as Uint8Array[],
  notify: null as ((value: DataView) => void) | null,
  onDisconnect: null as (() => void) | null,
  mtu: null as number | null,
}));

vi.mock("@capacitor-community/bluetooth-le", () => {
  let pending = new Uint8Array(0);
  return {
    BleClient: {
      initialize: vi.fn(async () => {}),
      requestDevice: vi.fn(async () => ({ deviceId: "dev1", name: "ReactPod 91c2" })),
      connect: vi.fn(async (_id: string, onDisconnect: () => void) => {
        ble.onDisconnect = onDisconnect;
      }),
      getMtu: vi.fn(async () => {
        if (ble.mtu === null) throw new Error("getMtu is not available on web.");
        return ble.mtu;
      }),
      startNotifications: vi.fn(async (_id: string, _s: string, _c: string, cb: (v: DataView) => void) => {
        ble.notify = cb;
      }),
      stopNotifications: vi.fn(async () => {}),
      disconnect: vi.fn(async () => ble.onDisconnect?.()),
      write: vi.fn(async (_id: string, _s: string, _c: string, value: DataView) => {
        const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
        ble.writes.push(bytes);
        const merged = new Uint8Array(pending.length + bytes.length);
        merged.set(pending);
        merged.set(bytes, pending.length);
        pending = merged;
        const nl = pending.indexOf(0x0a);
        if (nl < 0) return;
        const line = new TextDecoder().decode(pending.subarray(0, nl));
        pending = pending.slice(nl + 1);
        // indications of MTU − 3 = 20 bytes, like the firmware's sendLine at MTU 23
        const out = encodeUtf8(`${ble.pod.handle(line)}\n`);
        queueMicrotask(() => {
          for (let i = 0; i < out.length; i += 20) ble.notify?.(new DataView(out.slice(i, i + 20).buffer));
        });
      }),
    },
  };
});

describe("BleTransport", () => {
  beforeEach(() => {
    ble.pod = new SimulatedPod({ files: { "/prog/ü.json": "{}" } });
    ble.writes = [];
    ble.mtu = null;
  });

  it("writes in 20-byte pieces on the web and reassembles indications", async () => {
    const { BleTransport } = await import("./BleTransport");
    const transport = new BleTransport();
    await transport.connect();
    expect(transport.name).toBe("ReactPod 91c2");
    expect(transport.maxWrite).toBe(20);
    const client = new PodClient(transport, { timeoutMs: 500 });
    const list = await client.list();
    expect(list.files).toHaveLength(1);
    expect(ble.writes.every((w) => w.length <= 20)).toBe(true);
  });

  it("uses the native MTU when the platform reports it", async () => {
    ble.mtu = 247;
    const { BleTransport } = await import("./BleTransport");
    const transport = new BleTransport();
    await transport.connect();
    expect(transport.maxWrite).toBe(244);
    transport.setMtu(9999);
    expect(transport.maxWrite).toBe(512);
  });

  it("reports the pod switching BLE off (program selected)", async () => {
    const { BleTransport } = await import("./BleTransport");
    const transport = new BleTransport();
    await transport.connect();
    const lost = new Promise<void>((resolve) => transport.onDisconnect(resolve));
    ble.onDisconnect?.();
    await lost;
    expect(transport.connected).toBe(false);
  });
});

/* ---------------------------------------------------------------- session */

describe("pod session", () => {
  it("connects to the demo pod and reads info, role and files", async () => {
    const { usePodSession, isReadOnly } = await import("../session");
    await usePodSession.getState().connect("simulated");
    const s = usePodSession.getState();
    expect(s.state).toBe("connected");
    expect(s.role).toBe("central");
    expect(isReadOnly(s)).toBe(false);
    expect(s.list?.menu).toHaveLength(12);
    await s.disconnect();
    expect(usePodSession.getState().state).toBe("disconnected");
    expect(isReadOnly({ role: "peripheral" })).toBe(true);
  });

  it("authenticates and renames the set", async () => {
    const { usePodSession, needsPin, setLabel } = await import("../session");
    await usePodSession.getState().connect("simulated");
    const client = usePodSession.getState().client!;
    const pod = (client.transport as SimulatedTransport).pod;
    expect(setLabel(usePodSession.getState())).toBe(`ReactPod ${pod.setId.slice(-4)}`);

    pod.pin = "4711";
    await usePodSession.getState().refresh();
    expect(needsPin(usePodSession.getState())).toBe(true);
    await expect(usePodSession.getState().renameSet("Halle 2")).rejects.toMatchObject({ code: "auth_required" });
    await expect(usePodSession.getState().authenticate("1")).rejects.toMatchObject({ code: "auth_failed" });
    await usePodSession.getState().authenticate("4711");
    expect(needsPin(usePodSession.getState())).toBe(false);
    await usePodSession.getState().renameSet("Halle 2");
    expect(usePodSession.getState().info?.setName).toBe("Halle 2");
    expect(setLabel(usePodSession.getState())).toBe("Halle 2");

    await usePodSession.getState().disconnect();
    expect(usePodSession.getState().authenticated).toBe(false);
  });
});
