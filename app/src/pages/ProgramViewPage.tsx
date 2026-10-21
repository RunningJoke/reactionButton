import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, CircleAlert, Info, Lock, Pencil, Play, SlidersHorizontal, Users } from "lucide-react";
import { LedRing } from "../components/LedRing";
import { BlockDetailsSheet, IssueList } from "../editor/BlockDetails";
import { ProgramColumnView } from "../editor/ProgramColumnView";
import { buildGraph } from "../model/graph";
import { isLibraryPath } from "@reactpod/program-model";
import { isObject } from "@reactpod/program-model";
import { resolveProgram, validateProgram } from "@reactpod/program-model";
import { AdjustSheet } from "../programs/AdjustSheet";
import { useEditCopy } from "../programs/actions";
import { fileName } from "../programs/catalog";
import { simulateUrl, useProgramSource, validateOptionsOf, viewUrl, type SourceId } from "../programs/sources";
import { useWorkspace } from "../store/workspace";
import styles from "./ProgramViewPage.module.css";

export function ProgramViewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sourceId: SourceId = params.get("source") === "pod" ? "pod" : "shipped";
  const path = params.get("path") ?? "";
  const source = useProgramSource(sourceId);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<"info" | "issues" | null>(null);
  const editCopy = useEditCopy();
  const localCopy = useWorkspace((s) => s.programs.some((p) => p.path === path));
  const [adjusting, setAdjusting] = useState(false);

  const view = useMemo(() => {
    const read = source.read;
    const text = read(path);
    if (text === undefined) return null;
    let doc: unknown = null;
    try {
      doc = JSON.parse(text);
    } catch {
      // shown as an issue
    }
    const isProgram = isObject(doc) && typeof doc.name === "string" && !isLibraryPath(path);
    const resolved = isProgram
      ? validateProgram(path, read, validateOptionsOf(source))
      : resolveProgram(path, read);
    return { resolved, isProgram, graph: buildGraph(resolved) };
  }, [path, source]);

  if (!view) {
    return (
      <div className={styles.empty}>
        <p>{source.available ? t("view.notFound", { path }) : t("view.notConnected")}</p>
        <Link to="/programs">{t("view.back")}</Link>
      </div>
    );
  }

  const { resolved, graph, isProgram } = view;
  const doc = resolved.doc ?? {};
  const name = isProgram ? String(doc.name) : fileName(path);
  const errors = resolved.issues.filter((i) => i.severity === "error");
  const selectedNode = graph.nodes.find((n) => n.id === selected) ?? null;

  return (
    <div className={styles.view}>
      <div className={styles.bar}>
        <button className={styles.icon} onClick={() => navigate(-1)} aria-label={t("view.back")}>
          <ArrowLeft size={20} aria-hidden />
        </button>
        <div className={styles.title}>
          <h2>{name}</h2>
          <span className={styles.sub}>
            {isProgram ? (
              <>
                <Users size={13} aria-hidden /> {t("programs.pods", { count: Number(doc.peripherals ?? 0) + 1 })} ·{" "}
              </>
            ) : (
              <>
                <Lock size={13} aria-hidden /> {t("view.fragment")} ·{" "}
              </>
            )}
            {t("programs.blocks", { count: resolved.blocks.length })} · {t(`view.source.${sourceId}`)}
          </span>
        </div>
        {resolved.issues.length > 0 && (
          <button
            className={styles.icon}
            data-level={errors.length ? "error" : "warn"}
            onClick={() => setPanel(panel === "issues" ? null : "issues")}
            aria-label={t("view.issues", { count: resolved.issues.length })}
            aria-pressed={panel === "issues"}
          >
            {errors.length ? <CircleAlert size={20} aria-hidden /> : <AlertTriangle size={20} aria-hidden />}
            <span className={styles.count}>{resolved.issues.length}</span>
          </button>
        )}
        <button className={styles.icon} onClick={() => setPanel(panel === "info" ? null : "info")} aria-label={t("view.details")} aria-pressed={panel === "info"}>
          <Info size={20} aria-hidden />
        </button>
        {isProgram && (
          <Link className={styles.icon} to={simulateUrl({ source: sourceId, path })} aria-label={t("simulate.open")} title={t("simulate.open")}>
            <Play size={20} aria-hidden />
          </Link>
        )}
        {isProgram && (
          <button className={styles.icon} onClick={() => setAdjusting(true)} aria-label={t("adjust.actionFor", { name })} title={t("adjust.action")}>
            <SlidersHorizontal size={20} aria-hidden />
          </button>
        )}
        {isProgram && (
          <button
            className={styles.edit}
            aria-label={localCopy ? t("view.openCopy") : t("view.edit")}
            title={localCopy ? t("view.openCopy") : t("view.edit")}
            onClick={() => void editCopy(path, source.read(path)!, sourceId === "pod" ? "pod" : "default")}
          >
            <Pencil size={18} aria-hidden /> <span className={styles.editLabel}>{localCopy ? t("view.openCopy") : t("view.edit")}</span>
          </button>
        )}
      </div>

      {panel === "info" && <InfoPanel doc={doc} isProgram={isProgram} sourceId={sourceId} variables={resolved.variables} />}
      {panel === "issues" && (
        <section className={styles.panel}>
          <IssueList issues={resolved.issues} onSelect={(b) => setSelected(b)} />
        </section>
      )}

      <div className={styles.graph}>
        <ProgramColumnView graph={graph} selected={selected} onSelect={setSelected} />
        {selectedNode && <BlockDetailsSheet node={selectedNode} known={new Set(graph.nodes.map((n) => n.id))} onSelect={setSelected} />}
      </div>
      {adjusting && <AdjustSheet target={{ source: sourceId, path }} onClose={() => setAdjusting(false)} />}
    </div>
  );
}

function InfoPanel({ doc, isProgram, sourceId, variables }: { doc: Record<string, unknown>; isProgram: boolean; sourceId: SourceId; variables: Record<string, number> }) {
  const { t } = useTranslation();
  const includes = Array.isArray(doc.include) ? doc.include.filter((p): p is string => typeof p === "string") : [];
  return (
    <section className={styles.panel}>
      {isProgram && Array.isArray(doc.menu) && (
        <LedRing groups={doc.menu as never} size={88} label={t("programs.menuPattern")} />
      )}
      <div className={styles.panelText}>
        {typeof doc.description === "string" && <p>{doc.description}</p>}
        {Object.keys(variables).length > 0 && (
          <div className={styles.row}>
            <span className={styles.label}>{t("view.variables")}</span>
            <span className={styles.chips}>
              {Object.entries(variables).map(([k, v]) => (
                <code key={k}>
                  {k} = {v}
                </code>
              ))}
            </span>
          </div>
        )}
        {includes.length > 0 && (
          <div className={styles.row}>
            <span className={styles.label}>{t("view.includes")}</span>
            <span className={styles.chips}>
              {includes.map((p) => (
                <Link key={p} to={viewUrl(sourceId, p)}>
                  <code>{p}</code>
                </Link>
              ))}
            </span>
          </div>
        )}
        {typeof doc.start === "string" && (
          <div className={styles.row}>
            <span className={styles.label}>{t("view.start")}</span>
            <code>{doc.start}</code>
          </div>
        )}
      </div>
    </section>
  );
}
