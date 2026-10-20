/**
 * Upload queue of results (issue #48, platform spec §3.7): every report that the platform does not
 * have yet (or with another `discarded` flag) goes to POST /v1/orgs/{orgId}/training/upload.
 * Idempotent by the app's UUIDs (P22), so a batch is simply sent again after a failure.
 */
import { create } from "zustand";
import type { Athlete, StoredReport, TrainingSession } from "../results/report";
import { needsUpload, useResults } from "../results/results";
import { PlatformError, UPLOAD_LIMITS, type PlatformClient, type ReportIn, type SessionIn } from "./api";

export type UploadBatch = {
  sessions: SessionIn[];
  /** per session id: the reports in this batch with the flag sent */
  sent: Map<string, { id: string; discarded: boolean }[]>;
};

export type SkipReason = "noAthlete" | "notLinked" | "otherOrg" | "tooLarge";

export function toReportIn(r: StoredReport): ReportIn {
  const out: ReportIn = {
    id: r.id,
    podReportId: r.podReportId,
    recordedAt: new Date(r.recordedAt).toISOString(),
    discarded: r.discarded,
    values: r.values,
    stats: r.stats,
    vars: r.vars,
  };
  if (r.cycle !== undefined) out.cycle = r.cycle;
  if (r.startMs !== undefined) out.startMs = r.startMs;
  if (r.endMs !== undefined) out.endMs = r.endMs;
  return out;
}

function toSessionIn(s: TrainingSession, athleteId: string, reports: ReportIn[]): SessionIn {
  const out: SessionIn = { id: s.id, athleteId, setId: s.setId, programPath: s.programPath, startedAt: new Date(s.startedAt).toISOString(), reports };
  if (s.contentSha256) out.contentSha256 = s.contentSha256;
  if (s.notes) out.notes = s.notes;
  return out;
}

/**
 * Groups what needs uploading into requests within the API limits (50 sessions, 200 reports per
 * session, 20 000 values). A long session is split over several requests; each request names a
 * session at most once.
 */
export function planUpload(
  sessions: readonly TrainingSession[],
  reports: readonly StoredReport[],
  athletes: readonly Athlete[],
  orgId: string,
): { batches: UploadBatch[]; skipped: { sessionId: string; reason: SkipReason }[] } {
  const byId = new Map(athletes.map((a) => [a.id, a]));
  const pending = new Map<string, StoredReport[]>();
  for (const r of reports) if (needsUpload(r)) pending.set(r.sessionId, [...(pending.get(r.sessionId) ?? []), r]);

  const batches: UploadBatch[] = [];
  const skipped: { sessionId: string; reason: SkipReason }[] = [];
  let current: UploadBatch = { sessions: [], sent: new Map() };
  let values = 0;
  const flush = () => {
    if (current.sessions.length) batches.push(current);
    current = { sessions: [], sent: new Map() };
    values = 0;
  };

  for (const s of sessions) {
    const list = pending.get(s.id);
    if (!list?.length) continue;
    const athlete = s.athleteId ? byId.get(s.athleteId) : undefined;
    if (!athlete) {
      skipped.push({ sessionId: s.id, reason: "noAthlete" });
      continue;
    }
    if (!athlete.platformId) {
      skipped.push({ sessionId: s.id, reason: "notLinked" });
      continue;
    }
    if (athlete.platformOrgId && athlete.platformOrgId !== orgId) {
      skipped.push({ sessionId: s.id, reason: "otherOrg" });
      continue;
    }
    if (list.some((r) => r.values.length > UPLOAD_LIMITS.valuesPerReport)) {
      skipped.push({ sessionId: s.id, reason: "tooLarge" });
      continue;
    }
    // pieces of one session: each goes into its own request
    let piece: StoredReport[] = [];
    let pieceValues = 0;
    const pieces: StoredReport[][] = [];
    for (const r of list) {
      if (piece.length === UPLOAD_LIMITS.reportsPerSession || pieceValues + r.values.length > UPLOAD_LIMITS.values) {
        pieces.push(piece);
        piece = [];
        pieceValues = 0;
      }
      piece.push(r);
      pieceValues += r.values.length;
    }
    pieces.push(piece);
    for (const p of pieces) {
      const n = p.reduce((sum, r) => sum + r.values.length, 0);
      if (current.sessions.length === UPLOAD_LIMITS.sessions || values + n > UPLOAD_LIMITS.values || current.sent.has(s.id)) flush();
      current.sessions.push(toSessionIn(s, athlete.platformId, p.map(toReportIn)));
      current.sent.set(s.id, p.map((r) => ({ id: r.id, discarded: r.discarded })));
      values += n;
    }
  }
  flush();
  return { batches, skipped };
}

export type UploadSummary = {
  sessions: number;
  reports: number;
  failed: number;
  skipped: number;
  /** stopped early: sign in again */
  unauthorized: boolean;
  error?: string;
};

export type UploadDeps = {
  client: PlatformClient;
  orgId: string;
  /** waits between retries (tests pass a fake) */
  sleep?: (ms: number) => Promise<void>;
  /** tries per request for errors worth a retry (no answer, 429, 5xx) */
  attempts?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Uploads everything pending once. Results are written to the results store. */
export async function runUpload({ client, orgId, sleep = defaultSleep, attempts = 3 }: UploadDeps): Promise<UploadSummary> {
  const results = useResults.getState();
  const { batches, skipped } = planUpload(results.sessions, results.reports, results.athletes, orgId);
  const summary: UploadSummary = { sessions: 0, reports: 0, failed: 0, skipped: skipped.length, unauthorized: false };

  for (const batch of batches) {
    const key = crypto.randomUUID(); // same key for the retries of this request
    let done = false;
    for (let attempt = 1; !done; attempt++) {
      try {
        const res = await client.uploadTraining(orgId, batch.sessions, key);
        const remote = new Map(res.sessions.map((s) => [s.clientId, s.id]));
        for (const [sessionId, sent] of batch.sent) {
          await useResults.getState().recordUpload(sessionId, remote.get(sessionId) ?? sessionId, sent);
          summary.reports += sent.length;
        }
        summary.sessions += batch.sent.size;
        done = true;
      } catch (e) {
        const error = e instanceof PlatformError ? e : new PlatformError(0, "network", String(e));
        if (error.retryable && attempt < attempts) {
          await sleep(1000 * 2 ** (attempt - 1));
          continue;
        }
        for (const sessionId of batch.sent.keys()) await useResults.getState().recordUploadError(sessionId, error.code);
        summary.failed += batch.sent.size;
        summary.error = error.code;
        if (error.status === 401) {
          summary.unauthorized = true;
          return summary;
        }
        done = true;
      }
    }
  }
  return summary;
}

/** State of the queue for the UI. */
export const useUploadQueue = create<{ running: boolean; last: (UploadSummary & { at: number }) | null }>(() => ({ running: false, last: null }));

/** Runs the queue unless it runs already. */
export async function uploadNow(deps: UploadDeps): Promise<UploadSummary | null> {
  if (useUploadQueue.getState().running) return null;
  useUploadQueue.setState({ running: true });
  try {
    const summary = await runUpload(deps);
    useUploadQueue.setState({ last: { ...summary, at: Date.now() } });
    return summary;
  } finally {
    useUploadQueue.setState({ running: false });
  }
}
