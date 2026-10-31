import type { MetricStats, ReportValue, StoredReport, TrainingSession } from "./report";

export type MetricSummary = MetricStats & { metric: string };

/** Count, best (lowest), average (rounded) and worst per metric, sorted by metric name. */
export function summarizeValues(values: Iterable<ReportValue>): MetricSummary[] {
  const by = new Map<string, { count: number; sum: number; best: number; worst: number }>();
  for (const v of values) {
    const m = by.get(v.metric);
    if (!m) by.set(v.metric, { count: 1, sum: v.ms, best: v.ms, worst: v.ms });
    else {
      m.count++;
      m.sum += v.ms;
      m.best = Math.min(m.best, v.ms);
      m.worst = Math.max(m.worst, v.ms);
    }
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([metric, m]) => ({ metric, count: m.count, best: m.best, average: Math.round(m.sum / m.count), worst: m.worst }));
}

/** Statistics of the counted reports (discarded ones excluded, like the platform). */
export function summarizeReports(reports: readonly StoredReport[]): MetricSummary[] {
  return summarizeValues(reports.filter((r) => !r.discarded).flatMap((r) => r.values));
}

/** Duration of a report's section (endMs − startMs), if the pod sent both. */
export function reportDuration(r: Pick<StoredReport, "startMs" | "endMs">): number | undefined {
  return r.startMs !== undefined && r.endMs !== undefined && r.endMs >= r.startMs ? r.endMs - r.startMs : undefined;
}

/**
 * The one unit rule for durations shown to users: seconds, 2 decimals below 10 s ("0.35 s"), 1 decimal
 * from 10 s ("12.4 s"), locale decimal separator. Raw ms stay in expert mode and the CSV export.
 */
export function formatMs(ms: number, locale: string): string {
  const digits = ms < 9995 ? 2 : 1;
  const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${nf.format(ms / 1000)} s`;
}

/** The metric a progress view follows: the reaction time if there is one, else the first by name. */
export function mainMetric(metrics: readonly string[]): string | undefined {
  return metrics.includes("reaction") ? "reaction" : [...metrics].sort()[0];
}

export type Progress = {
  /** sessions with at least one round result */
  trainings: number;
  /** start of the latest such session */
  lastAt?: number;
  metric?: string;
  /** average of the main metric per training, oldest first (trainings without that metric left out) */
  points: { sessionId: string; at: number; average: number }[];
  /** latest minus previous average in ms; negative = faster. Undefined without a previous training. */
  change?: number;
  /** lowest single value of the metric, with the start of its training */
  best?: { ms: number; at: number };
};

/** Progress of one athlete over their sessions (all given sessions; counted reports only). Times: lower is better. */
export function athleteProgress(sessions: readonly TrainingSession[], reports: readonly StoredReport[]): Progress {
  const own = sessions
    .map((s) => ({ s, list: reports.filter((r) => r.sessionId === s.id) }))
    .filter((x) => x.list.length > 0)
    .sort((a, b) => a.s.startedAt - b.s.startedAt);
  const metric = mainMetric(summarizeReports(own.flatMap((x) => x.list)).map((m) => m.metric));
  const points: Progress["points"] = [];
  let best: Progress["best"];
  for (const { s, list } of own) {
    const stat = summarizeReports(list).find((m) => m.metric === metric);
    if (!stat) continue;
    points.push({ sessionId: s.id, at: s.startedAt, average: stat.average });
    if (!best || stat.best < best.ms) best = { ms: stat.best, at: s.startedAt };
  }
  const prev = points.at(-2);
  return {
    trainings: own.length,
    lastAt: own.at(-1)?.s.startedAt,
    metric,
    points,
    change: prev ? points.at(-1)!.average - prev.average : undefined,
    best,
  };
}

/** "today", "yesterday", "3 days ago" (locale aware) for the last two weeks, else the date. */
export function relativeDay(at: number, locale: string, now = Date.now()): string {
  const day = (x: number) => new Date(x).setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.round((day(now) - day(at)) / 86_400_000));
  if (days < 14) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(at);
}
