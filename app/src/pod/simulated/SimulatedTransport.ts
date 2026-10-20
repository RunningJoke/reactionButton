import { Listeners, type Transport, type Unsubscribe } from "../transport/Transport";
import { encodeUtf8, LineDecoder } from "../utf8";
import { SimulatedPod } from "./SimulatedPod";

export type SimulatedTransportOptions = {
  /** delay per response in ms (0 = next microtask) */
  latencyMs?: number;
  /**
   * Deliver responses in byte pieces of this size, like BLE indications (MTU − 3).
   * Exercises the line decoder, including characters split between pieces.
   */
  chunkBytes?: number;
  /** firmware log lines sent before each response, like the USB serial port */
  logLines?: string[];
};

/** Transport to a SimulatedPod. Behaves like a real link: async, chunked, may carry log lines. */
export class SimulatedTransport implements Transport {
  readonly kind = "simulated" as const;
  private isConnected = false;
  private readonly lines = new Listeners<[string]>();
  private readonly disconnects = new Listeners<[]>();
  private readonly decoder = new LineDecoder();

  constructor(
    readonly pod: SimulatedPod = new SimulatedPod(),
    private readonly options: SimulatedTransportOptions = {},
  ) {
    // events of the pod (demo reports) arrive like responses, unasked
    pod.onEvent = (line) => {
      if (!this.isConnected) return;
      const deliver = () => {
        if (this.isConnected) this.receive(`${line}\n`);
      };
      const latency = this.options.latencyMs ?? 0;
      if (latency > 0) setTimeout(deliver, latency);
      else queueMicrotask(deliver);
    };
  }

  get connected() {
    return this.isConnected;
  }

  async connect() {
    this.pod.newSession();
    this.isConnected = true;
  }

  async disconnect() {
    if (!this.isConnected) return;
    this.isConnected = false;
    this.decoder.reset();
    this.disconnects.emit();
  }

  async send(line: string) {
    if (!this.isConnected) throw new Error("not connected");
    const response = this.pod.handle(line);
    const deliver = () => {
      if (!this.isConnected) return;
      for (const log of this.options.logLines ?? []) this.receive(`${log}\n`);
      this.receive(`${response}\n`);
    };
    const latency = this.options.latencyMs ?? 0;
    if (latency > 0) setTimeout(deliver, latency);
    else queueMicrotask(deliver);
  }

  onLine(listener: (line: string) => void): Unsubscribe {
    return this.lines.add(listener);
  }

  onDisconnect(listener: () => void): Unsubscribe {
    return this.disconnects.add(listener);
  }

  private receive(text: string) {
    const bytes = encodeUtf8(text);
    const size = this.options.chunkBytes ?? bytes.length;
    for (let i = 0; i < bytes.length; i += size) {
      for (const line of this.decoder.push(bytes.subarray(i, i + size))) this.lines.emit(line);
    }
  }
}
