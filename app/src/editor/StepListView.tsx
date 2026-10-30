import { memo, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CircleAlert, CornerDownRight, Lock, OctagonX, Repeat, SlidersHorizontal, Unplug } from "lucide-react";
import type { Block, Issue } from "@reactpod/program-model";
import { advancedCount } from "./behaviours";
import { blockCategory, blockIcon } from "./blockStyle";
import { exitLabel } from "./ExitPicker";
import { exitValue } from "./exits";
import { repeatSentence, sentenceOptions, stepSentence, type SentenceOptions } from "./sentence";
import { settingLabel } from "./settingLabels";
import { isCatchEarly, portsOf, type Step, type StepBranch } from "./structure";
import styles from "./StepList.module.css";
import "./editor.css";

type Props = {
  steps: readonly Step[];
  /** every block of the program and its includes */
  blocks: ReadonlyMap<string, Block>;
  /** blocks of the program itself (the others come from library parts and are read only) */
  own: ReadonlySet<string>;
  issues: readonly Issue[];
  /** block types the connected pod can run */
  supportedTypes?: readonly string[];
  /** start values of the variables */
  values: Readonly<Record<string, number>>;
  selected: string | null;
  onSelect: (name: string | null) => void;
};

type Node = { step: Step; children: Node[] };

/** Flat list (depth first) → tree: a bracket holds its round, a step holds its branch steps. */
function tree(steps: readonly Step[]): Node[] {
  let i = 0;
  const level = (depth: number): Node[] => {
    const nodes: Node[] = [];
    while (i < steps.length && steps[i]!.depth >= depth) {
      const step = steps[i++]!;
      nodes.push({ step, children: level(step.depth + 1) });
    }
    return nodes;
  };
  return level(0);
}

/**
 * Simple view of the editor (docs/app/editor-ux.md §4 C): numbered steps in plain language, a
 * "Repeat N rounds" bracket around the round, branches as lines under their step.
 */
export function StepListView({ steps, blocks, own, issues, supportedTypes, values, selected, onSelect }: Props) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const nodes = useMemo(() => tree(steps), [steps]);
  const byBlock = useMemo(() => new Map(steps.filter((s) => !s.loop).map((s) => [s.block, s])), [steps]);
  const loops = useMemo(() => steps.filter((s) => s.loop).map((s) => s.loop!), [steps]);
  const options = useMemo<SentenceOptions>(() => sentenceOptions(blocks.values(), values, (name) => settingLabel(name, t).label), [blocks, values, t]);
  const problems = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) if (issue.block) map.set(issue.block, [...(map.get(issue.block) ?? []), issue]);
    return map;
  }, [issues]);

  // keep the selected step in view (also when picked from a branch line or the check sheet)
  useEffect(() => {
    if (!selected) return;
    const card = root.current?.querySelector<HTMLElement>(`[data-step="${CSS.escape(selected)}"]`);
    const box = root.current?.parentElement;
    if (!card || !box) return;
    // on phones the sheet covers the lower 70 %: the step's top goes into the free part above it
    const free = window.matchMedia?.("(min-width: 900px)").matches ? box.clientHeight : box.clientHeight * 0.3;
    const top = card.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (top < 8 || top > free - 48) box.scrollTo?.({ top: box.scrollTop + top - 8, behavior: "smooth" });
  }, [selected]);

  /** words for where a branch goes */
  const targetLabel = (branch: StepBranch, from: Step): { text: string; to?: string } => {
    const to = branch.target;
    if (!to) return { text: t("editor.step.notConnected") };
    const step = byBlock.get(to);
    // the branch's own steps follow right below: the number is enough
    if (step?.branchOf?.block === from.block) return { text: t("editor.step.toStep", { n: step.number }), to };
    if (step) return { text: `${t("editor.step.toStep", { n: step.number })} · ${sentence(to)}`, to };
    const loop = loops.find((l) => l.hidden.includes(to));
    if (loop) {
      if (loop.kind === "counter" && to !== loop.entry && to !== loop.head) return { text: t("editor.step.startOver") };
      if (from.inLoop === loop.head || isInside(from, loop.head)) return { text: t("editor.step.nextRound") };
      return { text: t("editor.step.startOver") };
    }
    return { text: to };
  };

  const isInside = (from: Step, head: string) => {
    let cur: Step | undefined = from;
    while (cur?.branchOf) cur = byBlock.get(cur.branchOf.block);
    return cur?.inLoop === head;
  };

  const sentence = (name: string) => {
    const block = blocks.get(name);
    return block ? stepSentence(block, t, options) : name;
  };

  /** The exits that leave the normal flow, as "If too slow · Count a miss" lines under their step. */
  const lines = (step: Step): Line[] => {
    const block = blocks.get(step.block);
    if (!block) return [];
    return step.branches.flatMap((branch) => {
      const value = exitValue(blocks, steps, block, branch.port);
      if (value.kind === "next") return [];
      const label = exitLabel(block, branch.port, t);
      const where = targetLabel(branch, step);
      const text = value.kind === "countMiss" ? t("editor.exit.countMiss") : value.kind === "nextRound" ? t("editor.step.nextRound") : value.kind === "leave" ? t("editor.exit.leave") : where.text;
      return [{ port: branch.port, label, text, to: where.to }];
    });
  };

  const render = (list: Node[], inBracket: boolean) => {
    const out: React.ReactNode[] = [];
    let afterBracket = false;
    let unreachable = false;
    for (const node of list) {
      const { step } = node;
      if (!inBracket && step.unreachable && !unreachable) {
        unreachable = true;
        out.push(
          <div key={`u-${step.block}`} className={styles.section}>
            <h3>
              <Unplug size={14} aria-hidden /> {t("editor.step.unreachable")}
            </h3>
            <p>{t("editor.step.unreachableHelp")}</p>
          </div>,
        );
      } else if (!inBracket && afterBracket && !step.loop && !step.unreachable) {
        out.push(
          <div key={`a-${step.block}`} className={styles.section}>
            <h3>{t("editor.step.afterLast")}</h3>
          </div>,
        );
      }
      afterBracket = false;
      if (step.loop) {
        const loop = step.loop;
        const count = loop.kind === "repeat" ? blocks.get(loop.head)?.count : loop.countValue;
        out.push(
          <section key={step.block} className={styles.bracket} aria-label={repeatSentence(count, t, options)} data-step={step.block}>
            <button type="button" className={styles.bracketHead} aria-pressed={selected === step.block} onClick={() => onSelect(step.block)}>
              <Repeat size={18} aria-hidden />
              <strong>{repeatSentence(count, t, options)}</strong>
              {!own.has(step.block) && <Lock size={14} aria-label={t("editor.step.locked")} />}
              <IssueBadge issues={loop.hidden.flatMap((h) => problems.get(h) ?? [])} />
            </button>
            {render(node.children, true)}
          </section>,
        );
        afterBracket = true;
        continue;
      }
      out.push(
        <StepCard
          key={step.block}
          step={step}
          block={blocks.get(step.block)}
          text={sentence(step.block)}
          own={own.has(step.block)}
          issues={problems.get(step.block) ?? []}
          unsupported={!!supportedTypes && !supportedTypes.includes(String(blocks.get(step.block)?.type))}
          selected={selected === step.block}
          onSelect={onSelect}
          lines={lines(step)}
        >
          {node.children.length > 0 && <div className={styles.branchSteps}>{render(node.children, true)}</div>}
        </StepCard>,
      );
    }
    return out;
  };

  return (
    <div className={styles.scroll} data-sheet={selected ? true : undefined} onClick={() => onSelect(null)}>
      <div ref={root} className={styles.list} onClick={(e) => e.stopPropagation()}>
        {render(nodes, false)}
      </div>
    </div>
  );
}

type Line = { port: string; label: string; text: string; to?: string };

type CardProps = {
  step: Step;
  block?: Block;
  text: string;
  own: boolean;
  issues: readonly Issue[];
  unsupported: boolean;
  selected: boolean;
  onSelect: (name: string | null) => void;
  lines: Line[];
  children?: React.ReactNode;
};

const StepCard = memo(function StepCard({ step, block, text, own, issues, unsupported, selected, onSelect, lines, children }: CardProps) {
  const { t } = useTranslation();
  const Icon = blockIcon(block && isCatchEarly(block) ? "delay" : block?.type);
  const records = typeof block?.record === "string";
  const advanced = block ? advancedCount(block, step) : 0;
  const ends = block && portsOf(block).every((p) => typeof block[p] !== "string");
  return (
    <div className={styles.card} data-category={blockCategory(block?.type)} data-selected={selected || undefined} data-step={step.block}>
      <button type="button" className={styles.main} aria-pressed={selected} onClick={() => onSelect(step.block)}>
        <span className={styles.num}>{step.number}</span>
        <span className={styles.tile} aria-hidden>
          <Icon size={16} />
        </span>
        <span className={styles.text}>
          {text}
          {records && ` · ${t("editor.step.records")}`}
          {!own && <Lock size={13} className={styles.lock} aria-label={t("editor.step.locked")} />}
        </span>
        {(issues.length > 0 || unsupported || advanced > 0) && (
          <span className={styles.meta}>
            <IssueBadge issues={issues} />
            {unsupported && (
              <span className={styles.chip} data-kind="error">
                <CircleAlert size={12} aria-hidden /> {t("editor.step.unsupported")}
              </span>
            )}
            {advanced > 0 && (
              <span className={styles.chip} role="img" aria-label={t("editor.step.advanced", { count: advanced })}>
                <SlidersHorizontal size={12} aria-hidden /> {advanced}
              </span>
            )}
          </span>
        )}
      </button>
      {(lines.length > 0 || ends) && (
        <ul className={styles.branches}>
          {lines.map(({ port, label, text: where, to }) => {
            const content = (
              <>
                <CornerDownRight size={14} aria-hidden />
                <span>
                  <b>{label}</b> · {where}
                </span>
              </>
            );
            return (
              <li key={port}>
                {to ? (
                  <button type="button" className={styles.branch} onClick={() => onSelect(to)} aria-label={t("editor.step.goTo", { role: label, target: where })}>
                    {content}
                  </button>
                ) : (
                  <span className={styles.branch}>{content}</span>
                )}
              </li>
            );
          })}
          {ends && (
            <li>
              <span className={styles.branch}>
                <OctagonX size={14} aria-hidden />
                <span>{t("editor.step.ends")}</span>
              </span>
            </li>
          )}
        </ul>
      )}
      {children}
    </div>
  );
});

function IssueBadge({ issues }: { issues: readonly Issue[] }) {
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  const error = issues.some((i) => i.severity === "error");
  return (
    <span className={styles.chip} data-kind={error ? "error" : "warn"}>
      {error ? <CircleAlert size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />} {t("editor.step.problems", { count: issues.length })}
    </span>
  );
}
