import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, ArrowRight, CircleAlert, Info, Lock, Users, X } from "lucide-react";
import { LedRing } from "../components/LedRing";
import { blockIcon, blockCategory } from "../editor/blockStyle";
import { ProgramColumnView } from "../editor/ProgramColumnView";
import { blockType } from "../model/blockTypes";
import { buildGraph, type GraphNode } from "../model/graph";
import { isLibraryPath } from "../model/limits";
import { isObject } from "../model/program";
import { resolveProgram, validateProgram, type Issue } from "../model/validate";
import { fileName } from "../programs/catalog";
import { useProgramSource, viewUrl, type SourceId } from "../programs/sources";
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

  const view = useMemo(() => {
    const read = (p: string) => source.files[p];
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
      ? validateProgram(path, read, { supportedTypes: source.supportedTypes })
      : resolveProgram(path, read);
    return { resolved, isProgram, graph: buildGraph(resolved) };
  }, [path, source.files, source.supportedTypes]);

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
      </div>

      {panel === "info" && <InfoPanel doc={doc} isProgram={isProgram} sourceId={sourceId} variables={resolved.variables} />}
      {panel === "issues" && <IssuesPanel issues={resolved.issues} onSelect={(b) => setSelected(b)} />}

      <div className={styles.graph}>
        <ProgramColumnView graph={graph} selected={selected} onSelect={setSelected} />
        {selectedNode && <BlockSheet node={selectedNode} graph={graph.nodes} onSelect={setSelected} />}
      </div>
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

function IssuesPanel({ issues, onSelect }: { issues: Issue[]; onSelect: (block: string) => void }) {
  const { t } = useTranslation();
  return (
    <section className={styles.panel}>
      <ul className={styles.issues}>
        {issues.map((issue, i) => (
          <li key={i} data-level={issue.severity}>
            {issue.severity === "error" ? <CircleAlert size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />}
            <span>
              {issue.block ? (
                <button className={styles.link} onClick={() => onSelect(issue.block!)}>
                  {issue.block}
                </button>
              ) : null}
              {issue.block ? ": " : ""}
              {t(`issues.${issue.code}`, issue.params ?? {})}
              {issue.field && <code className={styles.field}>{issue.field}</code>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BlockSheet({ node, graph, onSelect }: { node: GraphNode; graph: GraphNode[]; onSelect: (id: string | null) => void }) {
  const { t } = useTranslation();
  const Icon = blockIcon(node.block?.type);
  const def = blockType(node.block?.type);
  const block: Record<string, unknown> = node.block ?? {};
  const known = new Set(graph.map((n) => n.id));
  const fields = Object.entries(block).filter(([k]) => k !== "name" && k !== "type" && !def?.ports.includes(k));

  return (
    <aside className={styles.sheet} data-category={blockCategory(node.block?.type)} aria-label={node.id}>
      <div className={styles.sheetHeader}>
        <Icon size={18} aria-hidden />
        <div className={styles.title}>
          <h3>{node.id}</h3>
          <span className={styles.sub}>
            {node.external ? t("graph.external") : t(`blocks.${String(block.type)}.name`, { defaultValue: String(block.type) })}
            {!node.own && !node.external && (
              <>
                {" · "}
                <Lock size={12} aria-hidden /> {node.file}
              </>
            )}
          </span>
        </div>
        <button className={styles.icon} onClick={() => onSelect(null)} aria-label={t("view.close")}>
          <X size={20} aria-hidden />
        </button>
      </div>
      {!node.external && (
        <>
          {def && <p className={styles.help}>{t(`blocks.${def.type}.help`)}</p>}
          {fields.length > 0 && (
            <dl className={styles.fields}>
              {fields.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>
                    <code>{JSON.stringify(v)}</code>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <ul className={styles.ports}>
            {(def?.ports ?? []).map((port) => {
              const target = block[port];
              const fallback = node.fallbackPorts.includes(port);
              if (typeof target !== "string" && !fallback) return null;
              return (
                <li key={port}>
                  <span className={styles.port}>{t(`ports.${port}`)}</span>
                  <ArrowRight size={14} aria-hidden />
                  {typeof target === "string" ? (
                    known.has(target) ? (
                      <button className={styles.link} onClick={() => onSelect(target)}>
                        {target}
                      </button>
                    ) : (
                      <code>{target}</code>
                    )
                  ) : (
                    <span className={styles.muted}>{t("view.fallbackToNext")}</span>
                  )}
                </li>
              );
            })}
            {node.ends && <li className={styles.muted}>{t("graph.ends")}</li>}
          </ul>
        </>
      )}
    </aside>
  );
}
