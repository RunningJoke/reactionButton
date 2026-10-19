/**
 * BLE via @capacitor-community/bluetooth-le: Web Bluetooth in the browser, native BLE in the
 * Capacitor app. GATT layout: config-api.md §2. The central only advertises in the program menu,
 * as "ReactPod <set name or last 4 digits of the setId>" (§2.1).
 *
 * Needs firmware ≥ 2.1 (CR-0): the Response characteristic offers indications only, so
 * `startNotifications` subscribes for indications. Firmware 2.0 also offered notify; the
 * browser then picked notifications and the pod's indications were dropped.
 */
import { BleClient } from "@capacitor-community/bluetooth-le";
import { PodError } from "../protocol";
import { encodeUtf8, LineDecoder } from "../utf8";
import { Listeners, type Transport, type Unsubscribe } from "./Transport";

export const SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";
export const COMMAND_UUID = "12345678-1234-1234-1234-1234567890b1";
export const RESPONSE_UUID = "12345678-1234-1234-1234-1234567890b2";
export const MAX_LOOP_UUID = "12345678-1234-1234-1234-1234567890a7";

/** Payload of one write at the default ATT MTU of 23. */
export const DEFAULT_WRITE_BYTES = 20;
/** Largest ATT attribute value. */
export const MAX_WRITE_BYTES = 512;

export function isWebBluetoothAvailable(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

export class BleTransport implements Transport {
  readonly kind = "ble" as const;
  private deviceId: string | null = null;
  private deviceName: string | undefined;
  private writeBytes = DEFAULT_WRITE_BYTES;
  private readonly decoder = new LineDecoder();
  private readonly lines = new Listeners<[string]>();
  private readonly disconnects = new Listeners<[]>();

  get connected() {
    return this.deviceId !== null;
  }

  get name() {
    return this.deviceName;
  }

  /** Bytes per GATT write (MTU − 3). */
  get maxWrite() {
    return this.writeBytes;
  }

  /** Uses a known MTU, e.g. `info.mtu` of the pod (firmware ≥ 2.7). */
  setMtu(mtu: number) {
    if (Number.isInteger(mtu) && mtu > 3) this.writeBytes = Math.min(mtu - 3, MAX_WRITE_BYTES);
  }

  /** Shows the device chooser (must be called from a user gesture on the web). */
  async connect() {
    await BleClient.initialize({ androidNeverForLocation: true });
    const device = await BleClient.requestDevice({ services: [SERVICE_UUID] });
    this.decoder.reset();
    this.writeBytes = DEFAULT_WRITE_BYTES;
    await BleClient.connect(device.deviceId, () => this.lost());
    this.deviceId = device.deviceId;
    this.deviceName = device.name;
    try {
      // native only; the web keeps the default until the pod reports its MTU
      this.setMtu(await BleClient.getMtu(device.deviceId));
    } catch {
      // not available on the web
    }
    try {
      await BleClient.startNotifications(device.deviceId, SERVICE_UUID, RESPONSE_UUID, (value) => {
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        for (const line of this.decoder.push(bytes)) this.lines.emit(line);
      });
    } catch (e) {
      await this.disconnect();
      throw e;
    }
  }

  async disconnect() {
    const id = this.deviceId;
    if (!id) return;
    try {
      await BleClient.stopNotifications(id, SERVICE_UUID, RESPONSE_UUID);
    } catch {
      // the connection may already be gone
    }
    try {
      await BleClient.disconnect(id);
    } catch {
      // ignore
    }
    this.lost();
  }

  /** Writes one message in MTU-sized pieces, each with response (flow control). */
  async send(line: string) {
    const id = this.deviceId;
    if (!id) throw new PodError("disconnected", "not connected");
    const bytes = encodeUtf8(`${line}\n`);
    for (let i = 0; i < bytes.length; i += this.writeBytes) {
      const piece = bytes.slice(i, i + this.writeBytes);
      await BleClient.write(id, SERVICE_UUID, COMMAND_UUID, new DataView(piece.buffer));
    }
  }

  onLine(listener: (line: string) => void): Unsubscribe {
    return this.lines.add(listener);
  }

  onDisconnect(listener: () => void): Unsubscribe {
    return this.disconnects.add(listener);
  }

  private lost() {
    if (!this.deviceId) return;
    this.deviceId = null;
    this.decoder.reset();
    this.disconnects.emit();
  }
}
