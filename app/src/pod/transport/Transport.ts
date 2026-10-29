export type TransportKind = "ble" | "serial" | "simulated";

export type Unsubscribe = () => void;

/**
 * Line transport to a pod. One line = one JSON message (config-api.md §3).
 * Implementations: BLE, Web Serial, simulated pod. The native app adds its own BLE adapter.
 */
export interface Transport {
  readonly kind: TransportKind;
  readonly connected: boolean;
  /** Opens the connection; BLE / serial show the platform device chooser. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /**
   * Connects again after a link loss, without the device chooser (#46). Only transports that can
   * do it have this method; the session retries while the page lives.
   */
  reconnect?(): Promise<void>;
  /** Sends one message. `line` has no "\n"; the transport adds it and chunks as needed. */
  send(line: string): Promise<void>;
  /** Complete received lines (responses, events and, on serial, firmware log lines). */
  onLine(listener: (line: string) => void): Unsubscribe;
  onDisconnect(listener: () => void): Unsubscribe;
}

/** Small listener list used by the transports. */
export class Listeners<T extends unknown[]> {
  private readonly listeners = new Set<(...args: T) => void>();

  add(listener: (...args: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(...args: T) {
    for (const listener of [...this.listeners]) listener(...args);
  }
}
