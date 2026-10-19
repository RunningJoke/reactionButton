/**
 * USB serial via the Web Serial API (desktop Chrome / Edge). config-api.md "Serial specifics":
 * 115200 baud (ignored by USB CDC), lines end in "\n", firmware log lines never start with "{".
 *
 * The port is opened without touching DTR / RTS: on the ESP32-C3 toggling them resets the chip,
 * possibly into download mode (risk R1, acceptance test AT-S1).
 */
import { PodError } from "../protocol";
import { encodeUtf8, LineDecoder } from "../utf8";
import { Listeners, type Transport, type Unsubscribe } from "./Transport";

/** Espressif USB VID (ESP32-C3 USB Serial/JTAG = 303A:1001). */
export const ESPRESSIF_USB_VENDOR_ID = 0x303a;

/** Firmware RX buffer is 4096 bytes (src/Config/Console.cpp); write in smaller pieces. */
const WRITE_PIECE = 1024;

export function isWebSerialAvailable(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export class WebSerialTransport implements Transport {
  readonly kind = "serial" as const;
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readonly decoder = new LineDecoder();
  private readonly lines = new Listeners<[string]>();
  private readonly disconnects = new Listeners<[]>();
  private readLoop: Promise<void> | null = null;
  private closing = false;

  constructor(private readonly options: { anyDevice?: boolean } = {}) {}

  get connected() {
    return this.port !== null;
  }

  /** Shows the browser's port chooser (must be called from a user gesture). */
  async connect() {
    if (!isWebSerialAvailable()) throw new PodError("disconnected", "Web Serial is not available in this browser");
    const filters = this.options.anyDevice ? [] : [{ usbVendorId: ESPRESSIF_USB_VENDOR_ID }];
    const port = await navigator.serial.requestPort({ filters });
    await port.open({ baudRate: 115200, bufferSize: 16384 });
    this.port = port;
    this.closing = false;
    this.decoder.reset();
    this.writer = port.writable!.getWriter();
    navigator.serial.addEventListener("disconnect", this.onUsbDisconnect);
    this.readLoop = this.read(port);
  }

  async disconnect() {
    await this.close();
  }

  async send(line: string) {
    if (!this.writer) throw new PodError("disconnected", "not connected");
    const bytes = encodeUtf8(`${line}\n`);
    for (let i = 0; i < bytes.length; i += WRITE_PIECE) {
      await this.writer.write(bytes.subarray(i, i + WRITE_PIECE));
    }
  }

  onLine(listener: (line: string) => void): Unsubscribe {
    return this.lines.add(listener);
  }

  onDisconnect(listener: () => void): Unsubscribe {
    return this.disconnects.add(listener);
  }

  private async read(port: SerialPort) {
    while (port.readable && !this.closing) {
      const reader = port.readable.getReader();
      this.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) for (const line of this.decoder.push(value)) this.lines.emit(line);
        }
      } catch {
        // device lost or a framing error; the outer loop retries while the port is readable
      } finally {
        reader.releaseLock();
        this.reader = null;
      }
    }
    if (!this.closing) void this.close();
  }

  private onUsbDisconnect = (event: Event) => {
    if ((event.target as SerialPort | null) === this.port || (event as Event & { port?: SerialPort }).port === this.port) {
      void this.close();
    }
  };

  private async close() {
    const port = this.port;
    if (!port || this.closing) return;
    this.closing = true;
    navigator.serial.removeEventListener("disconnect", this.onUsbDisconnect);
    try {
      await this.reader?.cancel();
    } catch {
      // already closed
    }
    await this.readLoop?.catch(() => undefined);
    try {
      this.writer?.releaseLock();
      await port.close();
    } catch {
      // the device may already be gone
    }
    this.writer = null;
    this.port = null;
    this.readLoop = null;
    this.disconnects.emit();
  }
}
