import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight, CircleAlert, Lock } from "lucide-react";
import { Sheet } from "../components/Sheet";
import { blockType } from "../model/blockTypes";
import type { GraphNode } from "../model/graph";
import type { Issue } from "../model/validate";
import { blockCategory, blockIcon } from "./blockStyle";
import styles from "./Inspector.module.css";

/** Read-only details of a block (program view, and preset blocks in the editor). */
export function BlockDetailsSheet({ node, known, onSelect, children }: { node: GraphNode; known: ReadonlySet<string>; onSelect: (id: string | null) => void; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const Icon = blockIcon(node.block?.type);
  const def = blockType(node.block?.type);
  const block: Record<string, unknown> = node.block ?? {};
  const fields = Object.entries(block).filter(([k]) => k !== "name" && k !== "type" && !def?.ports.includes(k));

  return (
    <Sheet
      title={node.id}
      icon={<Icon size={18} aria-hidden />}
      category={blockCategory(node.block?.type)}
      onClose={() => onSelect(null)}
      sub={
        <>
          {node.external ? t("graph.external") : t(`blocks.${String(block.type)}.name`, { defaultValue: String(block.type) })}
          {!node.own && !node.external && (
            <>
              {" · "}
              <Lock size={12} aria-hidden /> {node.file}
            </>
          )}
        </>
      }
    >
      {children}
      {!node.external && (
        <>
          {def && <p className={styles.help}>{t(`blocks.${def.type}.help`)}</p>}
          {fields.length > 0 && (
            <dl className={styles.details}>
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
          <ul className={styles.portList}>
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
    </Sheet>
  );
}

/** Validation results; tapping a block name selects the block. */
export function IssueList({ issues, onSelect }: { issues: Issue[]; onSelect: (block: string) => void }) {
  const { t } = useTranslation();
  if (issues.length === 0) return <p className={styles.muted}>{t("editor.noIssues")}</p>;
  return (
    <ul className={styles.issues}>
      {issues.map((issue, i) => (
        <li key={i} data-level={issue.severity}>
          {issue.severity === "error" ? <CircleAlert size={16} aria-label={t("editor.error")} /> : <AlertTriangle size={16} aria-label={t("editor.warning")} />}
          <span>
            {issue.block ? (
              <button className={styles.link} onClick={() => onSelect(issue.block!)}>
                {issue.block}
              </button>
            ) : null}
            {issue.block ? ": " : ""}
            {t(`issues.${issue.code}`, issue.params ?? {})}
            {issue.field && <code className={styles.fieldCode}>{issue.field}</code>}
          </span>
        </li>
      ))}
    </ul>
  );
}
