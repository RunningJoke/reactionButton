/** Small pieces shared by the results pages (athletes, sessions, reports). */
import { useTranslation } from "react-i18next";
import { CircleDashed, CloudAlert, CloudCheck, CloudUpload, Link2Off, Minus, TrendingDown, TrendingUp, UserRound } from "lucide-react";
import { DEFAULT_FILES } from "../defaults";
import { usePodSession } from "../pod/session";
import type { SessionUploadStatus } from "../results/results";
import { formatMs, type MetricSummary, type Progress } from "../results/stats";
import { Named } from "../components/Named";
import { labelOf } from "../editor/settingLabels";
import { useWorkspace } from "../store/workspace";
import styles from "./Results.module.css";

export function formatDateTime(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(at);
}

function nameIn(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  try {
    const json = JSON.parse(text) as { name?: unknown };
    return typeof json.name === "string" ? json.name : undefined;
  } catch {
    return undefined;
  }
}

/** Program name for a pod path: from the connected pod, the local programs or the shipped ones; else the file name. */
export function useProgramName(): (path: string) => string {
  const files = usePodSession((s) => s.files);
  const programs = useWorkspace((s) => s.programs);
  return (path) => {
    const local = programs.find((p) => p.path === path)?.json.name;
    return nameIn(files[path]) ?? (typeof local === "string" ? local : undefined) ?? nameIn(DEFAULT_FILES[path]) ?? path.split("/").pop()!;
  };
}

const STATUS_ICON = {
  noAthlete: UserRound,
  notLinked: Link2Off,
  pending: CloudUpload,
  failed: CloudAlert,
  uploaded: CloudCheck,
  empty: CircleDashed,
} as const;

/** Upload state of a session: icon + text (never colour alone). */
export function UploadBadge({ status }: { status: SessionUploadStatus }) {
  const { t } = useTranslation();
  const Icon = STATUS_ICON[status];
  return (
    <span className={styles.badge} data-status={status}>
      <Icon size={14} aria-hidden />
      {t(`results.upload.${status}`)}
    </span>
  );
}

/** Count, best, average and worst per metric. */
export function StatsTable({ stats, caption }: { stats: readonly MetricSummary[]; caption?: string }) {
  const { t, i18n } = useTranslation();
  if (stats.length === 0) return <p className={styles.muted}>{t("results.noValues")}</p>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            <th scope="col">{t("results.metric")}</th>
            <th scope="col">{t("results.best")}</th>
            <th scope="col">{t("results.average")}</th>
            <th scope="col">{t("results.worst")}</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((m) => (
            <tr key={m.metric}>
              <th scope="row">
                <Named name={m.metric} />
                <span className={styles.cellSub}>{t("results.valueCount", { count: m.count })}</span>
              </th>
              <td>{formatMs(m.best, i18n.language)}</td>
              <td>{formatMs(m.average, i18n.language)}</td>
              <td>{formatMs(m.worst, i18n.language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "0.04 s faster" / "0.04 s slower" than the training before; neutral without one. Times: lower is better. */
export function ChangeChip({ change }: { change: number | undefined }) {
  const { t, i18n } = useTranslation();
  const tone = change === undefined || change === 0 ? "neutral" : change < 0 ? "better" : "worse";
  const text =
    change === undefined ? t("results.firstTraining") : change === 0 ? t("results.sameAsBefore") : t(change < 0 ? "results.faster" : "results.slower", { diff: formatMs(Math.abs(change), i18n.language) });
  const Icon = tone === "better" ? TrendingDown : tone === "worse" ? TrendingUp : Minus;
  return (
    <span className={styles.chip} data-tone={tone}>
      <Icon size={16} aria-hidden /> {text}
    </span>
  );
}

/** Bars for the last up to 8 trainings (average of the main metric); the latest in the accent. */
export function TrendBars({ progress }: { progress: Progress }) {
  const { t, i18n } = useTranslation();
  const points = progress.points.slice(-8);
  if (points.length < 2 || !progress.metric) return null;
  const max = Math.max(...points.map((p) => p.average));
  const first = points[0]!.average;
  const last = points.at(-1)!.average;
  const trend = last < first ? "faster" : last > first ? "slower" : "steady";
  const label = t("results.trendLabel", {
    count: points.length,
    metric: labelOf(progress.metric, t),
    first: formatMs(first, i18n.language),
    last: formatMs(last, i18n.language),
    trend: t(`results.trend.${trend}`),
  });
  return (
    <div className={styles.bars} role="img" aria-label={label}>
      {points.map((p, i) => (
        <div key={p.sessionId} className={styles.bar} data-latest={i === points.length - 1 || undefined} style={{ height: `${Math.max(12, (p.average / max) * 100)}%` }} />
      ))}
    </div>
  );
}
