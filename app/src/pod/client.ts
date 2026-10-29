import {
  PodError,
  type DeleteResponse,
  type ErrorResponse,
  type GetResponse,
  type InfoResponse,
  type ListResponse,
  type PodEvent,
  type PutResponse,
  type ResponseBase,
  type SetNameResponse,
  type BlinkResponse,
  type StatusResponse,
  type ValidateResponse,
} from "./protocol";
import { Listeners, type Transport, type Unsubscribe } from "./transport/Transport";

export type PodClientOptions = {
  /** time to wait for each response */
  timeoutMs?: number;
  /** how often a request is resent after an `overflow` error */
  overflowRetries?: number;
};

type Pending = {
  id: number;
  op: string;
  line: string;
  retriesLeft: number;
  resolve: (response: ResponseBase) => void;
  reject: (error: PodError) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Request / response on top of a Transport: one request at a time (config-api.md §3),
 * ids, timeouts, resend after `overflow`. Lines that are not JSON are firmware log (serial).
 */
export class PodClient {
  private readonly timeoutMs: number;
  private readonly overflowRetries: number;
  private nextId = 1;
  private pending: Pending | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly events = new Listeners<[PodEvent]>();
  private readonly logs = new Listeners<[string]>();
  private readonly unsubscribe: Unsubscribe[];

  constructor(
    readonly transport: Transport,
    options: PodClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.overflowRetries = options.overflowRetries ?? 3;
    this.unsubscribe = [
      transport.onLine((line) => this.handleLine(line)),
      transport.onDisconnect(() => this.fail(new PodError("disconnected", "connection lost"))),
    ];
  }

  /** Stops listening to the transport (does not disconnect it). */
  dispose() {
    for (const off of this.unsubscribe) off();
    this.fail(new PodError("disconnected", "client closed"));
  }

  onEvent(listener: (event: PodEvent) => void): Unsubscribe {
    return this.events.add(listener);
  }

  onLog(listener: (line: string) => void): Unsubscribe {
    return this.logs.add(listener);
  }

  /** Sends a request and resolves with the successful response; rejects with PodError. */
  request<T extends ResponseBase>(op: string, fields: Record<string, unknown> = {}): Promise<T> {
    const run = () => this.send<T>(op, fields);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  info() {
    return this.request<InfoResponse>("info");
  }
  list() {
    return this.request<ListResponse>("list");
  }
  /** Blinks a pod of the set for two seconds (firmware ≥ 2.13, feature `identify`); -1 = the central. */
  blink(pod: number) {
    return this.request<BlinkResponse>("blink", { pod });
  }

  status() {
    return this.request<StatusResponse>("status");
  }
  get(path: string, offset: number, length: number) {
    return this.request<GetResponse>("get", { path, offset, length });
  }
  put(fields: { path: string; data: string; offset: number; final: boolean; crc?: string }) {
    return this.request<PutResponse>("put", fields);
  }
  delete(path: string) {
    return this.request<DeleteResponse>("delete", { path });
  }
  /** Loads the program on the pod without starting it. With `data` (feature `validateInline`): dry run of that text. */
  validate(path: string, data?: string) {
    return this.request<ValidateResponse>("validate", data === undefined ? { path } : { path, data });
  }
  /** Unlocks put / delete / setName for this connection when `info.pinRequired`. */
  auth(pin: string) {
    return this.request<ResponseBase>("auth", { pin });
  }
  /** Stores the set name ("" clears it), advertised as "ReactPod <name>" after this connection. */
  setName(name: string) {
    return this.request<SetNameResponse>("setName", { name });
  }

  private send<T extends ResponseBase>(op: string, fields: Record<string, unknown>): Promise<T> {
    if (!this.transport.connected) return Promise.reject(new PodError("disconnected", "not connected", op));
    const id = this.nextId++;
    const line = JSON.stringify({ op, id, ...fields });
    return new Promise<T>((resolve, reject) => {
      this.pending = {
        id,
        op,
        line,
        retriesLeft: this.overflowRetries,
        resolve: resolve as (r: ResponseBase) => void,
        reject,
        timer: this.startTimer(),
      };
      this.transmit(line);
    });
  }

  private transmit(line: string) {
    this.transport.send(line).catch((e: unknown) => {
      this.fail(e instanceof PodError ? e : new PodError("disconnected", String(e)));
    });
  }

  private startTimer() {
    return setTimeout(() => this.fail(new PodError("timeout", "no response from the pod")), this.timeoutMs);
  }

  private handleLine(line: string) {
    if (!line.startsWith("{")) {
      this.logs.emit(line);
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.logs.emit(line);
      return;
    }
    if (typeof message !== "object" || message === null) return;
    if ("event" in message) {
      this.events.emit(message as PodEvent);
      return;
    }
    const response = message as ResponseBase;
    const pending = this.pending;
    // a response without id answers the current request (e.g. "overflow" before parsing)
    if (!pending || (response.id !== undefined && response.id !== pending.id)) return;

    clearTimeout(pending.timer);
    if (response.ok) {
      this.pending = null;
      pending.resolve(response);
      return;
    }
    const error = response as ErrorResponse;
    if (error.error === "overflow" && pending.retriesLeft > 0) {
      pending.retriesLeft--;
      pending.timer = this.startTimer();
      this.transmit(pending.line);
      return;
    }
    this.pending = null;
    pending.reject(new PodError(error.error ?? "protocol", error.message ?? "request failed", pending.op));
  }

  private fail(error: PodError) {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    pending.reject(new PodError(error.code, error.message, pending.op));
  }
}
