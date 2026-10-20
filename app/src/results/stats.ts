import type { MetricStats, ReportValue, StoredReport } from "./report";

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

/** 312 ms, 4.1 s, 1:05.2 min */
export function formatMs(ms: number, locale: string): string {
  if (ms < 1000) return `${ms} ms`;
  const nf = (digits: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (ms < 60_000) return `${nf(ms < 10_000 ? 2 : 1).format(ms / 1000)} s`;
  const min = Math.floor(ms / 60_000);
  const sec = (ms % 60_000) / 1000;
  return `${min}:${sec < 10 ? "0" : ""}${nf(1).format(sec)} min`;
}
