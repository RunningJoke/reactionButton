/**
 * Reports of a `communicate` block (issue #41) and what the app keeps of them (issue #47).
 * The firmware does not send reports yet: the types follow the proposed event, and
 * `parsePodReport` accepts only what the platform upload accepts too (spec/platform-api.yaml).
 */

/** Statistics of one metric, as the firmware keeps them. */
export type MetricStats = { count: number; average: number; best: number; worst: number };

/** One measurement: pod time (ms since the central started), metric name, pod number, value in ms. */
export type ReportValue = { t: number; metric: string; pod: number; ms: number };

/** The `report` event / an entry of the `reports` response (#41), as the pod sends it. */
export type PodReport = {
  event: "report";
  /** the pod's report id; restarts after a reboot, so it is no key */
  id: number;
  /** pod path of the program, e.g. "/prog/dreieck.json" */
  program: string;
  setId: string;
  /** the athlete id the app set with `session` (#42), "" or missing when none */
  athlete?: string;
  cycle?: number;
  startMs?: number;
  endMs?: number;
  values: ReportValue[];
  stats: Record<string, MetricStats>;
  vars: Record<string, number>;
};

/** A person who trains. Local first; `platformId` once linked to a platform athlete profile (#48). */
export type Athlete = {
  /** local UUID; also the opaque athlete id sent to the pod (`session`, ≤ 40 bytes) */
  id: string;
  name: string;
  createdAt: number;
  /** platform athlete id (UUID) after linking */
  platformId?: string;
  /** platform club (organisation) the profile belongs to */
  platformOrgId?: string;
};

/** Where a session stands with the platform. */
export type UploadState = {
  /** platform id of the session after the first successful upload */
  remoteId?: string;
  /** time of the last successful upload */
  uploadedAt?: number;
  /** last failed attempt: error code (problem+json `code`, "network", …) */
  error?: string;
  errorAt?: number;
};

/** One athlete on one pod set running one program (platform spec §3.7). */
export type TrainingSession = {
  /** UUID made by the app: the platform's dedupe key (P22) */
  id: string;
  /** null until an athlete is assigned (pods without `session` support do not tag reports) */
  athleteId: string | null;
  setId: string;
  programPath: string;
  /** SHA-256 of the program file on the pod, if the app knew it */
  contentSha256?: string;
  startedAt: number;
  notes: string;
  upload: UploadState;
};

/** A report as stored on the phone. */
export type StoredReport = {
  /** UUID made by the app: the platform's dedupe key (P22) */
  id: string;
  sessionId: string;
  podReportId: number;
  cycle?: number;
  startMs?: number;
  endMs?: number;
  /** when the app received it */
  recordedAt: number;
  /** followed by a `repeat`, or discarded by hand: kept, but not counted */
  discarded: boolean;
  values: ReportValue[];
  stats: Record<string, MetricStats>;
  vars: Record<string, number>;
  /** the `discarded` flag the platform has, once uploaded; undefined = not uploaded yet */
  uploadedDiscarded?: boolean;
};

const isInt = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isMetric = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 32;

/** Longest value the platform accepts (24 h). */
export const MAX_VALUE_MS = 86_400_000;

function parseValue(v: unknown): ReportValue | null {
  if (!isRecord(v) || !isInt(v.t, 0) || !isMetric(v.metric) || !isInt(v.pod, 0, 255) || !isInt(v.ms, 0, MAX_VALUE_MS)) return null;
  return { t: v.t, metric: v.metric, pod: v.pod, ms: v.ms };
}

function parseStats(v: unknown): Record<string, MetricStats> {
  const out: Record<string, MetricStats> = {};
  if (!isRecord(v)) return out;
  for (const [metric, s] of Object.entries(v)) {
    if (!isMetric(metric) || !isRecord(s)) continue;
    const { count, average, best, worst } = s;
    if (isInt(count, 0) && [average, best, worst].every((x) => typeof x === "number" && Number.isFinite(x))) {
      out[metric] = { count, average: average as number, best: best as number, worst: worst as number };
    }
  }
  return out;
}

function parseVars(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const [name, x] of Object.entries(v)) {
    if (name.length >= 1 && name.length <= 32 && typeof x === "number" && Number.isFinite(x)) out[name] = x;
  }
  return out;
}

/**
 * Reads a `report` event (or an entry of `reports`). Returns null when it is not a report the app
 * can keep. Single values out of range are left out (the platform would reject the whole upload).
 */
export function parsePodReport(message: unknown): PodReport | null {
  if (!isRecord(message)) return null;
  if (message.event !== undefined && message.event !== "report") return null;
  const { id, program, setId } = message;
  if (!isInt(id, 0) || typeof program !== "string" || !program.startsWith("/") || program.length > 31) return null;
  if (typeof setId !== "string" || !/^[0-9a-fA-F]{1,16}$/.test(setId)) return null;
  const report: PodReport = {
    event: "report",
    id,
    program,
    setId: setId.toLowerCase(),
    values: Array.isArray(message.values) ? message.values.map(parseValue).filter((x): x is ReportValue => x !== null) : [],
    stats: parseStats(message.stats),
    vars: parseVars(message.vars),
  };
  if (typeof message.athlete === "string" && message.athlete !== "") report.athlete = message.athlete;
  if (isInt(message.cycle, 0)) report.cycle = message.cycle;
  if (isInt(message.startMs, 0)) report.startMs = message.startMs;
  if (isInt(message.endMs, 0)) report.endMs = message.endMs;
  return report;
}

/** Same report received twice (event and `reports` after a reconnect, or a lost `ack`). */
export function sameReport(a: StoredReport, b: PodReport): boolean {
  return a.podReportId === b.id && a.startMs === b.startMs && a.endMs === b.endMs && a.cycle === b.cycle && a.values.length === b.values.length;
}
