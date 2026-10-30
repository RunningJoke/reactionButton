/**
 * Where reports from a pod enter the app (issues #41 / #42, not in the firmware yet).
 *
 * With `info.features` containing "reports" the central sends a `report` event per `communicate`
 * block and answers `{op:"reports"}` with all reports not acknowledged yet. The app stores each
 * report first and sends `{op:"ack", reportId}` only after it is written. (#41 proposes
 * `{op:"ack", id}`, but `id` is the request id every response echoes, config-api.md §3: the
 * PodClient would never match the answer.) Pods without the feature are
 * never asked: the app works as before. "remote" adds `session {athlete}` and `command`.
 */
import type { PodClient } from "../pod/client";
import type { InfoResponse, PodEvent, ResponseBase } from "../pod/protocol";
import type { Unsubscribe } from "../pod/transport/Transport";
import { parsePodReport, type PodReport } from "./report";

export const REPORTS_FEATURE = "reports";
export const REMOTE_FEATURE = "remote";

export type ReportsResponse = ResponseBase & { reports: unknown[] };
export type CommandName = "continue" | "repeat" | "stop";

/** Stores a report; resolves when it is safe (`durable`) to acknowledge it to the pod. */
export type ReportSink = (report: PodReport) => Promise<{ durable: boolean }>;

const has = (info: InfoResponse | null | undefined, feature: string) => info?.features?.includes(feature) ?? false;
export const supportsReports = (info: InfoResponse | null | undefined) => has(info, REPORTS_FEATURE);
export const supportsRemote = (info: InfoResponse | null | undefined) => has(info, REMOTE_FEATURE);

export class ReportFeed {
  private queue: Promise<unknown> = Promise.resolve();
  private off: Unsubscribe | null = null;
  private stopped = false;

  constructor(
    private readonly client: PodClient,
    private readonly sink: ReportSink,
    private readonly onError: (e: unknown) => void = () => undefined,
  ) {}

  /** Listens for `report` events and fetches the reports the pod kept while nobody listened. */
  start(): Promise<void> {
    this.off = this.client.onEvent((event: PodEvent) => {
      if (event.event === "report") void this.enqueue(event);
    });
    return this.fetchPending();
  }

  stop() {
    this.stopped = true;
    this.off?.();
    this.off = null;
  }

  /** `{op:"reports"}`: every report the pod has not got an `ack` for. */
  async fetchPending(): Promise<void> {
    try {
      const response = await this.client.request<ReportsResponse>("reports");
      for (const raw of Array.isArray(response.reports) ? response.reports : []) await this.enqueue(raw);
    } catch (e) {
      this.onError(e);
    }
  }

  /** One report at a time, in arrival order, so the acks go out in order too. */
  private enqueue(raw: unknown): Promise<void> {
    const run = () => this.handle(raw);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async handle(raw: unknown) {
    if (this.stopped) return;
    const report = parsePodReport(raw);
    if (!report) {
      this.onError(new Error(`ignored a report the app cannot read: ${JSON.stringify(raw).slice(0, 200)}`));
      return;
    }
    try {
      const { durable } = await this.sink(report);
      // not written to IndexedDB (private mode): no ack, the pod keeps it for the next try
      if (durable && !this.stopped) await this.client.request("ack", { reportId: report.id });
    } catch (e) {
      this.onError(e);
    }
  }
}

/** Tells the pod who trains now (`session`, #42); "" clears it. */
export function sendAthlete(client: PodClient, athlete: string) {
  return client.request("session", { athlete });
}

/** Answers a waiting `communicate` block (#42). */
export function sendCommand(client: PodClient, name: CommandName) {
  return client.request("command", { name });
}

/** Sets editable variables of a waiting `communicate` block, all or nothing (#46, config-api.md §5). */
export function sendVariables(client: PodClient, values: Record<string, number>) {
  return client.request("setVariables", { values });
}

/** Starts the program from CONFIRM (firmware ≥ 2.17 for the values set before it; config-api.md §5). */
export function sendStart(client: PodClient) {
  return client.request("start");
}

/** Pauses a running game from the phone (firmware ≥ 2.12, feature `pause`). */
export function sendPause(client: PodClient) {
  return client.request("pause");
}

/** Ends a phone pause (feature `pause`). */
export function sendResume(client: PodClient) {
  return client.request("resume");
}
