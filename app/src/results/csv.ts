/**
 * CSV export of results: one row per measurement (issue #47). German spreadsheets expect ";" as
 * the separator, so the separator follows the UI language. UTF-8 with BOM, so Excel reads umlauts.
 */
import type { Athlete, StoredReport, TrainingSession } from "./report";

export const CSV_COLUMNS = [
  "athlete",
  "session_id",
  "session_start",
  "set_id",
  "program",
  "report_id",
  "pod_report_id",
  "cycle",
  "discarded",
  "recorded_at",
  "t_ms",
  "metric",
  "pod",
  "ms",
] as const;

export function csvSeparator(language: string): "," | ";" {
  return language.startsWith("de") ? ";" : ",";
}

function cell(value: string | number | boolean | undefined, sep: string): string {
  const text = value === undefined ? "" : String(value);
  return text.includes(sep) || /["\r\n]/.test(text) || /^[=+\-@]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows for the given sessions (in their order), reports in recording order. */
export function resultsCsv(
  sessions: readonly TrainingSession[],
  reports: readonly StoredReport[],
  athletes: readonly Athlete[],
  options: { separator?: "," | ";" } = {},
): string {
  const sep = options.separator ?? ",";
  const names = new Map(athletes.map((a) => [a.id, a.name]));
  const lines = [CSV_COLUMNS.join(sep)];
  for (const s of sessions) {
    const athlete = s.athleteId ? (names.get(s.athleteId) ?? "") : "";
    const start = new Date(s.startedAt).toISOString();
    for (const r of reports) {
      if (r.sessionId !== s.id) continue;
      const recorded = new Date(r.recordedAt).toISOString();
      for (const v of r.values) {
        const row = [athlete, s.id, start, s.setId, s.programPath, r.id, r.podReportId, r.cycle, r.discarded, recorded, v.t, v.metric, v.pod, v.ms];
        lines.push(row.map((x) => cell(x, sep)).join(sep));
      }
    }
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Saves a text file through the browser. */
export function downloadText(text: string, filename: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿", text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "mia-2026-10-19.csv" */
export function csvFilename(name: string, at: number): string {
  const slug = name.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase() || "results";
  return `${slug}-${new Date(at).toISOString().slice(0, 10)}.csv`;
}
