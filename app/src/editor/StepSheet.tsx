/**
 * Step sheet (docs/app/editor-ux.md §4 D): replaces the inspector. Top to bottom: problems in
 * words, the essentials as large controls, feature switches (fields only when on), "More
 * options", actions, and in expert mode today's inspector fields (name, type, raw keys, ports).
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, ArrowDown, ArrowUp, CircleAlert, Copy, Plus, SlidersHorizontal, Trash2, Wrench } from "lucide-react";
import { Sheet } from "../components/Sheet";
import { blockType, fieldLevel, IF_OPS, isObject, type Block, type FieldDef, type Issue, type SwitchId } from "@reactpod/program-model";
import { Segmented, Stepper, SwitchRow } from "../wizard/controls";
import { BlockExpertFields, PortRow, type InspectorContext } from "./BlockInspector";
import { EditableField, NameListField, editableValue, nameItems } from "./ListFields";
import { blockCategory, blockIcon } from "./blockStyle";
import { COUNTDOWN_FIELDS, COUNTDOWN_STYLES, COUNTDOWN_TARGETS, countdownKind, countdownStyle, hasCountdownTime, setCountdown } from "./countdown";
import { EFFECTS, effectKind, hasEnd, isPeriodic, isTimed, setEffectKind, setEffectTarget, setEndless, usesColor } from "./effectStep";
import { CHARGE_STYLES, chargeMode, goIsRandom, holdPod, limitFieldOf, releaseMode, setChargeMode, setChargeStyle, setGoRandom, setHoldPod, setReleaseMode } from "./holdStep";
import { DEFAULT_COOLDOWN_MS, DEFAULT_GAME_MS, MAX_COOLDOWN_MS, TOGGLE_RESULTS, TOGGLE_STARTS, durationIsRandom, setDurationRandom, setTeamColor, setToggleStart, teamColors, toggleStart } from "./toggleStep";
import { ColorField, LedsField, NumberInput, SuggestField, ValueField } from "./fields";
import { isValidVariableName, ownBlocks, setBlockField, setProgramField, type ProgramJson } from "./ops";
import { podChoice, setPodChoice } from "./podChoice";
import { stepSentence, type SentenceOptions } from "./sentence";
import { settingLabel } from "./settingLabels";
import { isCatchEarly, type LoopInfo, type Step } from "./structure";
import { setSwitch, switchesFor, switchState, timeoutAction, type SwitchOptions } from "./switches";
import inspector from "./Inspector.module.css";
import styles from "./StepSheet.module.css";

export type StepSheetProps = {
  block: Block;
  step?: Step;
  /** problems of this block (validator issues) */
  issues: readonly Issue[];
  sentence: SentenceOptions;
  expert: boolean;
  ctx: InspectorContext;
};

type Apply = (doc: ProgramJson, mergeKey?: string) => void;

/** Seconds as text: 1500 → "1.5 s" (en) / "1,5 s" (de). */
export function secondsText(ms: number, t: TFunction): string {
  const s = Math.round(ms / 10) / 100;
  return t("sentence.seconds", { value: String(s).replace(".", t("sentence.decimal")) });
}

const LIMIT = { min: 0, max: 600_000, step: 500 };

const SELF_DESCRIBING: ReadonlySet<string> = new Set(["rangeReversed"]);

/** Words for an issue, without raw field and setting names. */
export function issueText(issue: Issue, t: TFunction): string {
  const params: Record<string, string | number> = { ...(issue.params ?? {}) };
  for (const key of ["name", "var"]) if (typeof params[key] === "string") params[key] = settingLabel(params[key] as string, t).label;
  const text = t(`issues.${issue.code}`, params);
  // these texts already say which value is meant
  if (!issue.field || SELF_DESCRIBING.has(issue.code)) return text;
  return `${text} (${fieldWords(issue.field, t)})`;
}

export function fieldWords(field: string, t: TFunction): string {
  return t(`editor.step.label.${field}`, { defaultValue: t(`fields.${field}.label`, { defaultValue: field }) });
}

export function ProblemList({ issues }: { issues: readonly Issue[] }) {
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  return (
    <ul className={styles.problems} aria-label={t("editor.step.problems", { count: issues.length })}>
      {issues.map((issue, i) => (
        <li key={i} data-level={issue.severity}>
          {issue.severity === "error" ? <CircleAlert size={18} aria-hidden /> : <AlertTriangle size={18} aria-hidden />}
          <span>{issueText(issue, t)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A time in seconds: a number edits the step, a setting edits the setting (for the whole program).
 */
function TimeValue({ label, value, doc, onField, apply, min = LIMIT.min, max = LIMIT.max, step = LIMIT.step }: { label: string; value: unknown; doc: ProgramJson; onField: (ms: number) => void; apply: Apply; min?: number; max?: number; step?: number }) {
  const { t } = useTranslation();
  const vars = isObject(doc.variables) ? (doc.variables as Record<string, number>) : {};
  const fmt = (v: number) => secondsText(v, t);
  if (typeof value === "string") {
    const v = vars[value];
    if (typeof v !== "number") return <p className={styles.hint}>{t("editor.step.fromSetting", { name: settingLabel(value, t).label })}</p>;
    return (
      <div className={styles.valueBox}>
        <Stepper label={label} value={v} {...LIMIT} min={min} max={max} step={step} format={fmt} onChange={(n) => apply(setProgramField(doc, "variables", { ...vars, [value]: n }), `var.${value}`)} />
        <p className={styles.hint}>{t("editor.step.settingHint", { name: settingLabel(value, t).label })}</p>
      </div>
    );
  }
  return <Stepper label={label} value={typeof value === "number" ? value : min} {...LIMIT} min={min} max={max} step={step} format={fmt} onChange={onField} />;
}

/** A count (rounds, red pods): number or setting, like TimeValue. */
function CountValue({ label, value, doc, min = 0, max = 999, onField, apply }: { label: string; value: unknown; doc: ProgramJson; min?: number; max?: number; onField: (n: number) => void; apply: Apply }) {
  const { t } = useTranslation();
  const vars = isObject(doc.variables) ? (doc.variables as Record<string, number>) : {};
  if (typeof value === "string") {
    const v = vars[value];
    if (typeof v !== "number") return <p className={styles.hint}>{t("editor.step.fromSetting", { name: settingLabel(value, t).label })}</p>;
    return (
      <div className={styles.valueBox}>
        <Stepper label={label} value={v} min={min} max={max} onChange={(n) => apply(setProgramField(doc, "variables", { ...vars, [value]: n }), `var.${value}`)} />
        <p className={styles.hint}>{t("editor.step.settingHint", { name: settingLabel(value, t).label })}</p>
      </div>
    );
  }
  return <Stepper label={label} value={typeof value === "number" ? value : min} min={min} max={max} onChange={onField} />;
}

/** Does the branch at `port` count a miss (a `+1` within its first few blocks)? */
function branchCountsMiss(doc: ProgramJson, name: string, port: string): boolean {
  const blocks = new Map(ownBlocks(doc).map((b) => [b.name, b]));
  let cur = blocks.get(name)?.[port];
  for (let i = 0; i < 4 && typeof cur === "string"; i++) {
    const b = blocks.get(cur);
    if (!b) return false;
    if (b.type === "setVariable" && (b.op === "+" || b.op === "add") && b.value === 1) return true;
    cur = b.next;
  }
  return false;
}

export function StepSheet({ block, step, issues, sentence, expert, ctx }: StepSheetProps) {
  const { t } = useTranslation();
  const doc = ctx.json;
  const name = block.name;
  const Icon = blockIcon(isCatchEarly(block) ? "delay" : block.type);
  const locked = ctx.lockedBy.get(name);
  const apply: Apply = (next, mergeKey) => ctx.apply(next, mergeKey ? { mergeKey } : undefined);
  const set = (field: string, value: unknown, merge = true) => apply(setBlockField(doc, name, field, value), merge ? `${name}.${field}` : undefined);
  const toggle = (id: SwitchId, on: boolean, options?: SwitchOptions) => apply(setSwitch(doc, name, id, on, options));
  const switches = switchesFor(block);
  const kind = t(`editor.step.kind.${isCatchEarly(block) ? "delay" : block.type}`, { defaultValue: t("editor.step.kind.unknown") });
  const title = step?.number ? t("editor.step.title", { n: step.number, kind }) : kind;
  const labelOf = (v: string) => settingLabel(v, t).label;

  return (
    <Sheet title={title} icon={<Icon size={18} aria-hidden />} category={blockCategory(block.type)} sub={step?.inLoop ? t("editor.step.inRound") : undefined} onClose={() => ctx.select(null)}>
      <div className={styles.body}>
        <p className={styles.story}>{stepSentence(block, t, sentence)}</p>
        <ProblemList issues={issues} />
        <Essentials block={block} doc={doc} set={set} apply={apply} labelOf={labelOf} variables={ctx.variables} ctx={ctx} />
        {switches.map((id) => (
          <FeatureSwitch key={id} id={id} block={block} doc={doc} set={set} apply={apply} toggle={toggle} inLoop={!!step?.inLoop} />
        ))}
        {countdownKind(block) !== null && (ctx.programFormat === undefined || ctx.programFormat >= 3) && <CountdownRow block={block} doc={doc} set={set} apply={apply} />}
        <MoreOptions block={block} doc={doc} set={set} apply={apply} variables={ctx.variables} metrics={ctx.metrics} />

        <div className={inspector.actions}>
          {blockType(block.type)?.ports.includes("next") || block.type === "button" ? (
            <button className={inspector.action} onClick={() => ctx.addAfter(name)}>
              <Plus size={18} aria-hidden /> {t("editor.step.addAfterAction")}
            </button>
          ) : null}
          {ctx.duplicate && (
            <button className={inspector.action} onClick={() => ctx.duplicate!(name)}>
              <Copy size={18} aria-hidden /> {t("editor.duplicate")}
            </button>
          )}
          {ctx.step && (
            <>
              <button className={inspector.action} disabled={!ctx.step.canUp} onClick={() => ctx.step!.move("up")}>
                <ArrowUp size={18} aria-hidden /> {t("editor.step.moveUp")}
              </button>
              <button className={inspector.action} disabled={!ctx.step.canDown} onClick={() => ctx.step!.move("down")}>
                <ArrowDown size={18} aria-hidden /> {t("editor.step.moveDown")}
              </button>
            </>
          )}
          <button className={inspector.action} data-danger disabled={!!locked} onClick={() => ctx.remove?.(name)}>
            <Trash2 size={18} aria-hidden /> {t("editor.step.deleteStep")}
          </button>
        </div>
        {locked && <p className={inspector.muted}>{t("editor.lockedBy", { file: locked })}</p>}

        {expert && (
          <section className={styles.expert} aria-label={t("editor.step.expert")}>
            <h4>
              <Wrench size={14} aria-hidden /> {t("editor.step.expert")}
            </h4>
            <BlockExpertFields block={block} ctx={ctx} />
          </section>
        )}
      </div>
    </Sheet>
  );
}

type FieldProps = {
  block: Block;
  doc: ProgramJson;
  set: (field: string, value: unknown, merge?: boolean) => void;
  apply: Apply;
};

/* ---------------------------------------------------------------- essentials */

function Essentials({ block, doc, set, apply, labelOf, variables, ctx }: FieldProps & { labelOf: (v: string) => string; variables: readonly string[]; ctx: InspectorContext }) {
  const { t } = useTranslation();
  switch (block.type) {
    case "led":
      return (
        <>
          <Field label={t("editor.step.colour")}>
            <ColorField value={block.color} custom label={t("editor.step.colour")} onChange={(c) => set("color", c ?? "green", false)} />
          </Field>
          {namedOff(block.color) ? null : (
            <Field label={t("editor.step.leds")}>
              <LedsField value={block.leds} color={block.color} label={t("editor.step.leds")} onChange={(v) => set("leds", v)} />
            </Field>
          )}
        </>
      );
    case "delay":
      return <PauseTime block={block} doc={doc} set={set} apply={apply} />;
    case "button":
      if (isCatchEarly(block)) return <PauseTime block={block} doc={doc} set={set} apply={apply} />;
      return <p className={styles.hint}>{t("editor.step.pressHint")}</p>;
    case "remotePress":
      return (
        <>
          <PodChips block={block} doc={doc} set={set} apply={apply} />
          <Field label={t("editor.step.colour")}>
            <ColorField
              value={block.color}
              optional
              defaultValue={block.mode === "avoid" ? "red" : "green"}
              label={t("editor.step.colour")}
              onChange={(c) => set("color", c, false)}
            />
          </Field>
        </>
      );
    case "remoteMultiPress": {
      const all = block.pods === undefined || block.pods === "REQUIRED_PERIPHERALS";
      const peripherals = typeof doc.peripherals === "number" ? doc.peripherals : 1;
      return (
        <>
          <Field label={t("editor.step.hitColour")}>
            <ColorField value={block.hitColor} optional defaultValue="green" label={t("editor.step.hitColour")} onChange={(c) => set("hitColor", c, false)} />
          </Field>
          <Field label={t("editor.step.whichPods")}>
            <div className={styles.chips}>
              <button type="button" className={inspector.chip} aria-pressed={all} onClick={() => set("pods", undefined, false)}>
                {t("editor.step.allPods")}
              </button>
              <button type="button" className={inspector.chip} aria-pressed={!all} onClick={() => !all || set("pods", Math.max(1, peripherals), false)}>
                {t("editor.step.somePods")}
              </button>
            </div>
          </Field>
          {!all && <CountValue label={t("editor.step.podCount")} value={block.pods} doc={doc} min={1} max={31} onField={(n) => set("pods", n)} apply={apply} />}
        </>
      );
    }
    case "remoteResetAll":
      return <p className={styles.hint}>{t("editor.step.resetHint")}</p>;
    case "setVariable":
      return <SetVariableFields block={block} doc={doc} set={set} apply={apply} labelOf={labelOf} variables={variables} />;
    case "if":
      return (
        <>
          <Field label={t("editor.step.question")}>
            <ValueField value={block.left} variables={variables} labelOf={labelOf} label={t("editor.step.question")} onChange={(v) => set("left", v ?? 0)} />
          </Field>
          <Field label={t("editor.step.compare")}>
            <select className={inspector.input} value={String(block.op ?? "==")} aria-label={t("editor.step.compare")} onChange={(e) => set("op", e.target.value, false)}>
              {!IF_OPS.includes(String(block.op ?? "==") as never) && <option value={String(block.op)}>{String(block.op)}</option>}
              {IF_OPS.map((op) => (
                <option key={op} value={op}>
                  {t(`sentence.op.${IF_WORD[op]}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("editor.step.value")}>
            <ValueField value={block.right} variables={variables} labelOf={labelOf} label={t("editor.step.value")} onChange={(v) => set("right", v ?? 0)} />
          </Field>
        </>
      );
    case "summary":
      return (
        <>
          <p className={styles.hint}>{t("editor.step.summaryHint")}</p>
          {STATS.map(([field, variable, key]) => (
            <SwitchRow
              key={field}
              label={t(`editor.step.stat.${key}`)}
              hint={typeof block[field] === "string" ? t("editor.step.keptIn", { name: labelOf(block[field] as string) }) : undefined}
              checked={typeof block[field] === "string"}
              onChange={(on) => set(field, on ? variable : undefined, false)}
            />
          ))}
        </>
      );
    case "effect":
      return <EffectFields block={block} doc={doc} set={set} apply={apply} />;
    case "charge":
      return <ChargeFields block={block} doc={doc} set={set} apply={apply} />;
    case "release":
      return <ReleaseFields block={block} doc={doc} set={set} apply={apply} />;
    case "toggle":
      return <ToggleFields block={block} doc={doc} set={set} apply={apply} labelOf={labelOf} />;
    case "communicate":
      return <CommunicateFields block={block} doc={doc} set={set} apply={apply} ctx={ctx} />;
    case "repeat":
      return <CountValue label={t("editor.step.rounds")} value={block.count} doc={doc} min={1} onField={(n) => set("count", n)} apply={apply} />;
    default:
      return null;
  }
}

const STATS = [
  ["storeAverage", "AVG_REACTION", "average"],
  ["storeBest", "BEST_REACTION", "best"],
  ["storeWorst", "WORST_REACTION", "worst"],
  ["storeCount", "COUNT_REACTION", "count"],
] as const;

const IF_WORD: Record<string, string> = { "==": "eq", "!=": "ne", ">": "gt", "<": "lt", ">=": "ge", "<=": "le" };

const namedOff = (c: unknown) => c === "off";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field} role="group" aria-label={label}>
      <span className={styles.label}>{label}</span>
      {children}
    </div>
  );
}

/** Fixed | Random and the seconds of a pause (delay, or the catch-early button). */
function PauseTime({ block, doc, set, apply }: FieldProps) {
  const { t } = useTranslation();
  const early = block.type === "button";
  const [minF, maxF, fixedF] = early ? ["minTimeoutMs", "maxTimeoutMs", null] : ["minMs", "maxMs", "ms"];
  const random = switchState(block, "randomPause");
  const mode = random ? "random" : "fixed";
  return (
    <>
      <Segmented
        label={t("editor.step.howLong")}
        value={mode}
        options={[
          { value: "fixed", label: t("editor.step.fixed") },
          { value: "random", label: t("editor.step.random") },
        ]}
        onChange={(v) => apply(setSwitch(doc, block.name, "randomPause", v === "random"))}
      />
      {random ? (
        <div className={styles.pair}>
          <TimeValue label={t("editor.step.shortest")} value={block[minF]} doc={doc} apply={apply} onField={(ms) => set(minF, ms)} />
          <TimeValue label={t("editor.step.longest")} value={block[maxF]} doc={doc} apply={apply} onField={(ms) => set(maxF, ms)} />
        </div>
      ) : early ? (
        <TimeValue
          label={t("editor.step.seconds")}
          value={block[minF]}
          doc={doc}
          apply={apply}
          onField={(ms) => apply(setBlockField(setBlockField(doc, block.name, minF, ms), block.name, maxF, ms), `${block.name}.pause`)}
        />
      ) : (
        <TimeValue label={t("editor.step.seconds")} value={block[fixedF!]} doc={doc} apply={apply} onField={(ms) => set(fixedF!, ms)} />
      )}
    </>
  );
}

/** "Which pod": Pod 1…n, random pod, random never the same twice. */
function PodChips({ block, doc, apply, set }: FieldProps) {
  const { t } = useTranslation();
  const choice = podChoice(doc, block.name);
  const peripherals = typeof doc.peripherals === "number" ? doc.peripherals : 0;
  const count = Math.max(peripherals, choice.kind === "pod" ? choice.pod + 1 : 0, 1);
  return (
    <Field label={t("editor.step.whichPod")}>
      <div className={styles.chips}>
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            className={inspector.chip}
            aria-pressed={choice.kind === "pod" && choice.pod === i}
            onClick={() => (choice.kind === "other" ? set("pod", i, false) : apply(setPodChoice(doc, block.name, { kind: "pod", pod: i })))}
          >
            {t("editor.step.podN", { n: i + 1 })}
          </button>
        ))}
        {(["random", "randomOther"] as const).map((k) => (
          <button key={k} type="button" className={inspector.chip} aria-pressed={choice.kind === k} disabled={choice.kind === "other"} onClick={() => apply(setPodChoice(doc, block.name, { kind: k }))}>
            {t(`editor.step.${k === "random" ? "randomPod" : "randomOtherPod"}`)}
          </button>
        ))}
        {choice.kind === "other" && typeof block.pod === "string" && (
          <button type="button" className={inspector.chip} aria-pressed disabled>
            {t("editor.step.podIn", { name: settingLabel(block.pod, t).label })}
          </button>
        )}
      </div>
    </Field>
  );
}

const SET_WORDS = ["=", "+", "-", "random", "randomOther"] as const;

function SetVariableFields({ block, doc, set, apply, labelOf, variables }: FieldProps & { labelOf: (v: string) => string; variables: readonly string[] }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const current = typeof block.var === "string" ? block.var : "";
  const writable = variables.filter((v) => v !== "REQUIRED_PERIPHERALS" && v !== "NODE_COUNT");
  const commit = () => {
    const n = text.trim();
    if (!isValidVariableName(n)) return;
    const vars = isObject(doc.variables) ? (doc.variables as Record<string, number>) : {};
    let next = setBlockField(doc, block.name, "var", n);
    if (!(n in vars)) next = setProgramField(next, "variables", { ...vars, [n]: 0 });
    apply(next);
    setAdding(false);
    setText("");
  };
  const op = typeof block.op === "string" ? block.op : "=";
  return (
    <>
      <Field label={t("editor.step.setting")}>
        <select
          className={inspector.input}
          value={adding ? "\u0000new" : current}
          aria-label={t("editor.step.setting")}
          onChange={(e) => {
            if (e.target.value === "\u0000new") setAdding(true);
            else {
              setAdding(false);
              set("var", e.target.value, false);
            }
          }}
        >
          {current && !writable.includes(current) && <option value={current}>{labelOf(current)}</option>}
          {writable.map((v) => (
            <option key={v} value={v}>
              {labelOf(v)}
            </option>
          ))}
          <option value={"\u0000new"}>{t("editor.step.newSetting")}</option>
        </select>
        {adding && (
          <div className={styles.row}>
            <input
              className={inspector.input}
              value={text}
              autoFocus
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t("editor.step.newSettingName")}
              aria-label={t("editor.step.newSettingName")}
              aria-invalid={text !== "" && !isValidVariableName(text.trim())}
              onChange={(e) => setText(e.target.value.replace(/\s/g, "_"))}
              onKeyDown={(e) => e.key === "Enter" && commit()}
            />
            <button type="button" className={inspector.action} disabled={!isValidVariableName(text.trim())} onClick={commit}>
              {t("editor.step.ok")}
            </button>
          </div>
        )}
      </Field>
      <Field label={t("editor.step.whatToDo")}>
        <select className={inspector.input} value={op} aria-label={t("editor.step.whatToDo")} onChange={(e) => set("op", e.target.value, false)}>
          {!SET_WORDS.includes(op as never) && <option value={op}>{op}</option>}
          {SET_WORDS.map((o) => (
            <option key={o} value={o}>
              {t(`editor.step.op.${o}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("editor.step.value")}>
        <ValueField value={block.value} variables={variables} labelOf={labelOf} label={t("editor.step.value")} onChange={(v) => set("value", v ?? 0)} />
      </Field>
    </>
  );
}

/* ---------------------------------------------------------------- switches */

function FeatureSwitch({ id, block, doc, set, apply, toggle, inLoop }: FieldProps & { id: SwitchId; toggle: (id: SwitchId, on: boolean, options?: SwitchOptions) => void; inLoop: boolean }) {
  const { t } = useTranslation();
  const on = switchState(block, id);
  const name = block.name;
  const s = (key: string, o?: Record<string, unknown>) => t(`editor.switch.${key}`, o);
  switch (id) {
    case "randomPause":
      return null; // the Fixed | Random choice of the pause
    case "timeLimit": {
      const avoid = block.mode === "avoid";
      const action = timeoutAction(doc, name);
      const choices: { value: string; label: string }[] = [
        { value: "goOn", label: s("goOn") },
        { value: "countMiss", label: s("countMiss") },
        ...(inLoop && block.type !== "remoteMultiPress" ? [{ value: "endRound", label: s("endRound") }] : []),
        ...(action === "other" ? [{ value: "other", label: s("other") }] : []),
      ];
      const limitField = block.type === "release" ? limitFieldOf(block) : "timeoutMs";
      const time = block[limitField] ?? block.minTimeoutMs;
      const holdLimit = block.type === "release" && limitField === "maxHoldMs";
      return (
        <SwitchRow
          label={avoid ? s("staysRed") : holdLimit ? s("holdLimit") : s("timeLimit")}
          hint={on ? s(holdLimit ? "holdLimitOn" : "timeLimitOn", { time: typeof time === "number" ? secondsText(time, t) : settingLabel(String(time), t).label }) : s("timeLimitOff")}
          checked={on}
          onChange={(v) => toggle("timeLimit", v)}
        >
          {block[limitField] !== undefined || block.minTimeoutMs === undefined ? (
            <TimeValue label={s("seconds")} value={block[limitField]} doc={doc} apply={apply} onField={(ms) => set(limitField, ms)} />
          ) : (
            <div className={styles.pair}>
              <TimeValue label={t("editor.step.shortest")} value={block.minTimeoutMs} doc={doc} apply={apply} onField={(ms) => set("minTimeoutMs", ms)} />
              <TimeValue label={t("editor.step.longest")} value={block.maxTimeoutMs} doc={doc} apply={apply} onField={(ms) => set("maxTimeoutMs", ms)} />
            </div>
          )}
          {!avoid && (
            <Segmented
              label={s("tooSlow")}
              value={action}
              options={choices}
              onChange={(v) => v !== "other" && toggle("timeLimit", true, { onTimeout: v as SwitchOptions["onTimeout"] })}
            />
          )}
        </SwitchRow>
      );
    }
    case "record":
      return <SwitchRow label={s("record")} hint={on ? s("recordOn") : s("recordOff")} checked={on} onChange={(v) => toggle("record", v)} />;
    case "longPress":
      return (
        <SwitchRow
          label={s("longPress")}
          hint={on ? s("longPressOn", { time: secondsText(typeof block.shortMs === "number" ? block.shortMs : 1000, t) }) : s("longPressOff")}
          checked={on}
          onChange={(v) => toggle("longPress", v)}
        >
          <TimeValue label={s("holdTime")} value={block.shortMs ?? 1000} doc={doc} apply={apply} onField={(ms) => set("shortMs", ms)} />
        </SwitchRow>
      );
    case "avoid": {
      if (block.type === "remotePress") {
        return <SwitchRow label={s("avoidPod")} hint={on ? s("avoidPodOn") : s("avoidPodOff")} checked={on} onChange={(v) => toggle("avoid", v)} />;
      }
      const miss = on && branchCountsMiss(doc, name, "avoidHit");
      const vars = isObject(doc.variables) ? (doc.variables as Record<string, number>) : {};
      const n = typeof block.avoid === "number" ? block.avoid : vars[String(block.avoid)];
      const count = typeof n === "number" ? String(n) : settingLabel(String(block.avoid), t).label;
      return (
        <SwitchRow label={s("avoidMulti")} hint={on ? s("avoidMultiOn", { count }) : s("avoidMultiOff")} checked={on} onChange={(v) => toggle("avoid", v)}>
          <CountValue label={s("redPods")} value={block.avoid} doc={doc} min={1} max={31} onField={(n) => set("avoid", n)} apply={apply} />
          <Field label={s("redColour")}>
            <ColorField value={block.avoidColor} optional defaultValue="red" label={s("redColour")} onChange={(c) => set("avoidColor", c, false)} />
          </Field>
          <SwitchRow label={s("redMiss")} hint={s("missHint")} checked={miss} onChange={(v) => toggle("avoid", true, { onTimeout: v ? "countMiss" : "goOn" })} />
        </SwitchRow>
      );
    }
    case "falseStart": {
      const miss = on && branchCountsMiss(doc, name, "pressed");
      return (
        <SwitchRow label={s("falseStart")} hint={on ? s("falseStartOn") : s("falseStartOff")} checked={on} onChange={(v) => toggle("falseStart", v)}>
          <SwitchRow
            label={s("earlyMiss")}
            hint={s("missHint")}
            checked={miss}
            onChange={(v) => apply(setSwitch(setSwitch(doc, name, "falseStart", false), name, "falseStart", true, { onTimeout: v ? "countMiss" : "goOn" }))}
          />
        </SwitchRow>
      );
    }
  }
}

/* ---------------------------------------------------------------- hold to charge, let go */

/** "Which button": the central's or a pod's. */
function HoldPodChips({ block, doc, apply }: FieldProps) {
  const { t } = useTranslation();
  const pod = holdPod(block);
  const peripherals = typeof doc.peripherals === "number" ? doc.peripherals : 0;
  const count = Math.max(peripherals, typeof pod === "number" ? pod + 1 : 0);
  return (
    <Field label={t("editor.step.hold.whichButton")}>
      <div className={styles.chips}>
        <button type="button" className={inspector.chip} aria-pressed={pod === "central"} onClick={() => apply(setHoldPod(doc, block.name, "central"))}>
          {t("editor.step.effect.central")}
        </button>
        {Array.from({ length: count }, (_, i) => (
          <button key={i} type="button" className={inspector.chip} aria-pressed={pod === i} onClick={() => apply(setHoldPod(doc, block.name, i))}>
            {t("editor.step.podN", { n: i + 1 })}
          </button>
        ))}
        {pod === "other" && typeof block.pod === "string" && (
          <button type="button" className={inspector.chip} aria-pressed disabled>
            {t("editor.step.podIn", { name: settingLabel(block.pod, t).label })}
          </button>
        )}
      </div>
    </Field>
  );
}

/** Essentials of "Hold to charge": which button, hold time for a full charge, style, colour. */
function ChargeFields({ block, doc, set, apply }: FieldProps) {
  const { t } = useTranslation();
  const h = (key: string, o?: Record<string, unknown>) => t(`editor.step.hold.${key}`, o);
  const style = typeof block.style === "string" && (CHARGE_STYLES as readonly string[]).includes(block.style) ? block.style : "fill";
  const accumulate = chargeMode(block) === "accumulate";
  return (
    <>
      <HoldPodChips block={block} doc={doc} set={set} apply={apply} />
      <TimeValue label={h("fullAfter")} value={block.maxMs ?? 0} doc={doc} apply={apply} min={500} onField={(ms) => set("maxMs", ms)} />
      <p className={styles.hint}>{accumulate ? h("accumulateHint") : h("chargeHint")}</p>
      <Field label={h("style")}>
        <div className={styles.chips}>
          {CHARGE_STYLES.map((k) => (
            <button key={k} type="button" className={inspector.chip} aria-pressed={style === k} onClick={() => apply(setChargeStyle(doc, block.name, k))}>
              {h(`styles.${k}`)}
            </button>
          ))}
        </div>
      </Field>
      {style !== "trafficLight" && (
        <Field label={t("editor.step.colour")}>
          <ColorField value={block.color} optional defaultValue="green" label={t("editor.step.colour")} onChange={(c) => set("color", c, false)} />
        </Field>
      )}
      {style === "colorShift" && (
        <Field label={t("editor.step.effect.colour2")}>
          <ColorField value={block.color2} optional defaultValue="red" label={t("editor.step.effect.colour2")} onChange={(c) => set("color2", c, false)} />
        </Field>
      )}
    </>
  );
}

/** Essentials of "Let go": trigger | signal, which button, colours, the time until the signal. */
function ReleaseFields({ block, doc, set, apply }: FieldProps) {
  const { t } = useTranslation();
  const h = (key: string, o?: Record<string, unknown>) => t(`editor.step.hold.${key}`, o);
  const mode = releaseMode(block);
  const random = goIsRandom(block);
  return (
    <>
      <Segmented
        label={h("mode")}
        value={mode}
        options={[
          { value: "trigger", label: h("modes.trigger") },
          { value: "signal", label: h("modes.signal") },
        ]}
        onChange={(v) => apply(setReleaseMode(doc, block.name, v as "trigger" | "signal"))}
      />
      <p className={styles.hint}>{mode === "signal" ? h("signalHint") : h("triggerHint")}</p>
      <HoldPodChips block={block} doc={doc} set={set} apply={apply} />
      <Field label={h("holdColour")}>
        <ColorField value={block.holdColor} optional defaultValue="yellow" label={h("holdColour")} onChange={(c) => set("holdColor", c, false)} />
      </Field>
      {mode === "signal" && (
        <>
          <Field label={h("goColour")}>
            <ColorField value={block.goColor} optional defaultValue="green" label={h("goColour")} onChange={(c) => set("goColor", c, false)} />
          </Field>
          <Segmented
            label={h("signalAfter")}
            value={random ? "random" : "fixed"}
            options={[
              { value: "fixed", label: t("editor.step.fixed") },
              { value: "random", label: t("editor.step.random") },
            ]}
            onChange={(v) => apply(setGoRandom(doc, block.name, v === "random"))}
          />
          {random ? (
            <div className={styles.pair}>
              <TimeValue label={t("editor.step.shortest")} value={block.minGoMs} doc={doc} apply={apply} onField={(ms) => set("minGoMs", ms)} />
              <TimeValue label={t("editor.step.longest")} value={block.maxGoMs} doc={doc} apply={apply} onField={(ms) => set("maxGoMs", ms)} />
            </div>
          ) : (
            <TimeValue label={t("editor.step.seconds")} value={block.goMs} doc={doc} apply={apply} onField={(ms) => set("goMs", ms)} />
          )}
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- domination */

/** Essentials of "Domination": the two team colours, game length, who starts with which team, cooldown, results. */
/**
 * communicate (programs.md §7.16): the time limit and the ports the client's answers and the button
 * lead to. The lists and the editable variables are under "More options".
 */
function CommunicateFields({ block, set, ctx }: FieldProps & { ctx: InspectorContext }) {
  const { t } = useTranslation();
  const timeout = typeof block.timeoutMs === "number" ? block.timeoutMs : undefined;
  return (
    <>
      <p className={styles.hint}>{t("editor.step.communicate.hint")}</p>
      <Field label={t("fields.timeoutMs.label")}>
        <NumberInput
          value={timeout}
          min={0}
          placeholder={t("editor.step.communicate.noLimit")}
          label={t("fields.timeoutMs.label")}
          onChange={(n) => set("timeoutMs", n ? n : undefined, false)}
        />
      </Field>
      {(["pressed", "timeout", "repeat", "stop"] as const).map((port) => (
        <PortRow key={port} port={port} block={block} ctx={ctx} hasNext />
      ))}
    </>
  );
}

function ToggleFields({ block, doc, set, apply, labelOf }: FieldProps & { labelOf: (v: string) => string }) {
  const { t } = useTranslation();
  const d = (key: string, o?: Record<string, unknown>) => t(`editor.step.toggle.${key}`, o);
  const [colorA, colorB] = teamColors(block);
  const random = durationIsRandom(block);
  const start = toggleStart(block);
  return (
    <>
      <p className={styles.hint}>{d("hint")}</p>
      <Field label={d("teamA")}>
        <ColorField value={colorA} hide={["off", colorB]} label={d("teamA")} onChange={(c) => apply(setTeamColor(doc, block.name, 0, typeof c === "string" ? c : undefined))} />
      </Field>
      <Field label={d("teamB")}>
        <ColorField value={colorB} hide={["off", colorA]} label={d("teamB")} onChange={(c) => apply(setTeamColor(doc, block.name, 1, typeof c === "string" ? c : undefined))} />
      </Field>
      <Segmented
        label={d("length")}
        value={random ? "random" : "fixed"}
        options={[
          { value: "fixed", label: t("editor.step.fixed") },
          { value: "random", label: t("editor.step.random") },
        ]}
        onChange={(v) => apply(setDurationRandom(doc, block.name, v === "random"))}
      />
      {random ? (
        <div className={styles.pair}>
          <TimeValue label={t("editor.step.shortest")} value={block.minDurationMs} doc={doc} apply={apply} min={1000} onField={(ms) => set("minDurationMs", ms)} />
          <TimeValue label={t("editor.step.longest")} value={block.maxDurationMs} doc={doc} apply={apply} min={1000} onField={(ms) => set("maxDurationMs", ms)} />
        </div>
      ) : (
        <TimeValue label={d("duration")} value={block.durationMs ?? DEFAULT_GAME_MS} doc={doc} apply={apply} min={1000} onField={(ms) => set("durationMs", ms)} />
      )}
      <Field label={d("start")}>
        <div className={styles.chips}>
          {TOGGLE_STARTS.map((k) => (
            <button key={k} type="button" className={inspector.chip} aria-pressed={start === k} onClick={() => apply(setToggleStart(doc, block.name, k))}>
              {d(`starts.${k}`)}
            </button>
          ))}
        </div>
      </Field>
      <p className={styles.hint}>{d(`startHint.${start}`)}</p>
      <TimeValue label={d("cooldown")} value={block.cooldownMs ?? DEFAULT_COOLDOWN_MS} doc={doc} apply={apply} min={0} max={MAX_COOLDOWN_MS} step={100} onField={(ms) => set("cooldownMs", ms)} />
      <p className={styles.hint}>{d("endHint")}</p>
      <Field label={d("results")}>
        <p className={styles.hint}>{d("resultsHint")}</p>
        {TOGGLE_RESULTS.map(([field, variable, key]) => (
          <SwitchRow
            key={field}
            label={d(`result.${key}`)}
            hint={typeof block[field] === "string" ? t("editor.step.keptIn", { name: labelOf(block[field] as string) }) : undefined}
            checked={typeof block[field] === "string"}
            onChange={(on) => set(field, on ? variable : undefined, false)}
          />
        ))}
      </Field>
    </>
  );
}

/* ---------------------------------------------------------------- light effect */

/** Essentials of the "Light effect" step: effect, colour, where, how long, wait. */
function EffectFields({ block, doc, set, apply }: FieldProps) {
  const { t } = useTranslation();
  const e = (key: string, o?: Record<string, unknown>) => t(`editor.step.effect.${key}`, o);
  const kind = effectKind(block);
  const peripherals = typeof doc.peripherals === "number" ? doc.peripherals : 0;
  const target = block.target;
  const current = target === undefined || target === "central" ? "central" : target === "all" || target === "peripherals" ? target : typeof target === "number" ? target : "other";
  const chip = (key: string, label: string, pressed: boolean, onClick: () => void, disabled?: boolean) => (
    <button key={key} type="button" className={inspector.chip} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
  return (
    <>
      <Field label={e("label")}>
        <div className={styles.chips}>
          {EFFECTS.map((k) => chip(k, e(`kind.${k}`), kind === k, () => apply(setEffectKind(doc, block.name, k))))}
        </div>
      </Field>
      {usesColor(kind) && (
        <Field label={t("editor.step.colour")}>
          <ColorField value={block.color} optional defaultValue="white" custom label={t("editor.step.colour")} onChange={(c) => set("color", c, false)} />
        </Field>
      )}
      {kind === "colorShift" && (
        <Field label={e("colour2")}>
          <ColorField value={block.color2} optional defaultValue="off" custom label={e("colour2")} onChange={(c) => set("color2", c, false)} />
        </Field>
      )}
      <Field label={e("where")}>
        <div className={styles.chips}>
          {chip("central", e("central"), current === "central", () => apply(setEffectTarget(doc, block.name, "central")))}
          {peripherals > 0 && chip("all", e("all"), current === "all", () => apply(setEffectTarget(doc, block.name, "all")))}
          {peripherals > 0 && chip("peripherals", e("peripherals"), current === "peripherals", () => apply(setEffectTarget(doc, block.name, "peripherals")))}
          {Array.from({ length: peripherals }, (_, i) => chip(`pod${i}`, e("podN", { n: i + 1 }), current === i, () => apply(setEffectTarget(doc, block.name, i))))}
          {current === "other" && typeof target === "string" && chip("other", t("editor.step.podIn", { name: settingLabel(target, t).label }), true, () => {}, true)}
        </div>
      </Field>
      {isTimed(kind) && <TimeValue label={e("howLong")} value={block.durationMs ?? 0} doc={doc} apply={apply} onField={(ms) => set("durationMs", ms)} />}
      {isPeriodic(kind) && (
        <>
          <Segmented
            label={e("howLong")}
            value={hasEnd(block) ? "limited" : "forever"}
            options={[
              { value: "forever", label: e("forever") },
              { value: "limited", label: e("limited") },
            ]}
            onChange={(v) => apply(setEndless(doc, block.name, v === "forever"))}
          />
          {hasEnd(block) && <TimeValue label={t("editor.step.seconds")} value={block.durationMs ?? 0} doc={doc} apply={apply} onField={(ms) => set("durationMs", ms)} />}
        </>
      )}
      {kind !== "solid" && kind !== "off" && (
        <SwitchRow
          label={e("wait")}
          hint={!hasEnd(block) ? e("waitNeedsTime") : block.wait === true ? e("waitOn") : e("waitOff")}
          checked={block.wait === true}
          disabled={!hasEnd(block)}
          onChange={(on) => set("wait", on ? true : undefined, false)}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- countdown */

/** "Show the time running out": the ring counts down over the step's time (program format 3). */
function CountdownRow({ block, doc, set, apply }: FieldProps) {
  const { t } = useTranslation();
  const c = (key: string, o?: Record<string, unknown>) => t(`editor.switch.countdown.${key}`, o);
  const style = countdownStyle(block);
  const available = hasCountdownTime(block);
  const peripherals = typeof doc.peripherals === "number" ? doc.peripherals : 0;
  const target = block.countdownTarget === undefined ? "central" : block.countdownTarget;
  const chip = (key: string, label: string, pressed: boolean, onClick: () => void) => (
    <button key={key} type="button" className={inspector.chip} aria-pressed={pressed} onClick={onClick}>
      {label}
    </button>
  );
  return (
    <SwitchRow
      label={c("label")}
      hint={!available ? c("needsLimit") : style ? c("on", { style: c(`styles.${style}`) }) : c("off")}
      checked={style !== null}
      disabled={!available}
      onChange={(on) => apply(setCountdown(doc, block.name, on ? "drain" : null))}
    >
      <Field label={c("style")}>
        <div className={styles.chips}>{COUNTDOWN_STYLES.map((k) => chip(k, c(`styles.${k}`), style === k, () => apply(setCountdown(doc, block.name, k))))}</div>
      </Field>
      {style === "colorShift" && (
        <Field label={c("color")}>
          <ColorField value={block.countdownColor} optional defaultValue="red" label={c("color")} onChange={(col) => set("countdownColor", col, false)} />
        </Field>
      )}
      {(block.type === "delay" || block.type === "button") && style !== "trafficLight" && (
        <Field label={c("from")}>
          <ColorField value={block.countdownFrom} optional defaultValue="green" label={c("from")} onChange={(col) => set("countdownFrom", col, false)} />
        </Field>
      )}
      {block.type === "delay" && peripherals > 0 && (
        <Field label={c("target")}>
          <div className={styles.chips}>
            {COUNTDOWN_TARGETS.map((k) => chip(k, c(`targets.${k}`), target === k, () => set("countdownTarget", k === "central" ? undefined : k, false)))}
            {Array.from({ length: peripherals }, (_, i) => chip(`pod${i}`, t("editor.step.effect.podN", { n: i + 1 }), target === i, () => set("countdownTarget", i, false)))}
          </div>
        </Field>
      )}
    </SwitchRow>
  );
}

/* ---------------------------------------------------------------- more options */

/** Behaviours that have their own row; the others stay in "More options" until the Sprinkle rows replace it. */
const SWITCH_ROWS: readonly string[] = ["timeLimit", "record", "longPress", "avoid", "randomPause", "falseStart"];
const INTERIM_ESSENTIAL: readonly string[] = ["mode", "periodMs"];

function MoreOptions({ block, doc, set, apply, variables, metrics }: FieldProps & { variables: readonly string[]; metrics: readonly string[] }) {
  const { t } = useTranslation();
  // colour shift asks for its second colour above; only blink, spin, fill and drain have a background
  const mode = block.type === "release" ? releaseMode(block) : block.type === "charge" ? chargeMode(block) : undefined;
  const own: readonly string[] = [...COUNTDOWN_FIELDS, ...(block.type === "toggle" ? TOGGLE_RESULTS.map((r) => r[0]) : []), ...(block.type === "charge" ? ["color2"] : []), ...(block.type === "effect" && !["blink", "spin", "fill", "drain"].includes(String(block.effect)) ? ["color2"] : [])];
  const fields = (blockType(block.type)?.fields ?? []).filter((f) => (fieldLevel(f) === "more" || (fieldLevel(f) === "switch" && !SWITCH_ROWS.includes(f.group!)) || (INTERIM_ESSENTIAL.includes(f.name) && (f.name !== "mode" || block.type === "charge"))) && !own.includes(f.name) && (f.onlyMode === undefined || f.onlyMode === mode));
  if (fields.length === 0) return null;
  const used = fields.some((f) => block[f.name] !== undefined);
  return (
    <details className={styles.more} open={used || undefined}>
      <summary>
        <SlidersHorizontal size={18} aria-hidden /> {t("editor.step.moreOptions")}
      </summary>
      <div className={styles.moreBody}>
        {fields.map((f) => (
          <MoreField key={f.name} field={f} block={block} doc={doc} set={set} apply={apply} variables={variables} metrics={metrics} />
        ))}
      </div>
    </details>
  );
}

function MoreField({ field, block, doc, set, apply, variables, metrics }: FieldProps & { field: FieldDef; variables: readonly string[]; metrics: readonly string[] }) {
  const { t } = useTranslation();
  const label = fieldWords(field.name, t);
  const help = t(`editor.step.help.${field.name}`, { defaultValue: "" });
  const value = block[field.name];
  let input: ReactNode;
  switch (field.kind) {
    case "value":
      input = /Ms$/.test(field.name) ? (
        <TimeValue label={label} value={value ?? field.default ?? 0} doc={doc} apply={apply} onField={(ms) => set(field.name, ms)} />
      ) : (
        <ValueField value={value} variables={variables} labelOf={(v) => settingLabel(v, t).label} label={label} placeholder={t("fields.notSet")} onChange={(v) => set(field.name, v)} />
      );
      break;
    case "color":
    case "remoteColor":
      input = <ColorField value={value} optional defaultValue={field.default} custom={field.kind === "color"} label={label} onChange={(c) => set(field.name, c, false)} />;
      break;
    case "leds":
      input = <LedsField value={value} color={block.color} label={label} onChange={(v) => set(field.name, v)} />;
      break;
    case "bool": {
      // allowHeld: on for a trigger, off for a signal
      const dflt = field.name === "allowHeld" ? releaseMode(block) === "trigger" : field.default === true;
      const checked = typeof value === "boolean" ? value : dflt;
      return <SwitchRow label={label} hint={help || undefined} checked={checked} onChange={(v) => set(field.name, v === dflt ? undefined : v, false)} />;
    }
    case "enum": {
      const current = typeof value === "string" ? value : String(field.default ?? "");
      input = (
        <div className={styles.chips}>
          {(field.options ?? []).map((o) => (
            <button
              key={o}
              type="button"
              className={inspector.chip}
              aria-pressed={current === o}
              onClick={() => (field.name === "mode" && block.type === "charge" ? apply(setChargeMode(doc, block.name, o as never)) : set(field.name, o === field.default ? undefined : o, false))}
            >
              {t(`editor.step.enum.${field.name}.${o}`, { defaultValue: o })}
            </button>
          ))}
        </div>
      );
      break;
    }
    case "variable":
      input = <SuggestField value={value} suggestions={variables} placeholder={t("editor.step.notKept")} label={label} onChange={(v) => set(field.name, v)} />;
      break;
    case "metric":
      input = <SuggestField value={value} suggestions={metrics} placeholder={t("fields.notSet")} label={label} onChange={(v) => set(field.name, v)} />;
      break;
    case "metricList":
      input = <NameListField items={nameItems(value)} choices={[]} label={label} placeholder={t("list.metricPlaceholder")} onChange={(v) => set(field.name, v)} />;
      break;
    case "variableList":
      input = <NameListField items={nameItems(value)} choices={variables} label={label} placeholder="" onChange={(v) => set(field.name, v)} />;
      break;
    case "editableMap":
      input = <EditableField value={editableValue(value)} choices={variables} label={label} onChange={(v) => set(field.name, v)} />;
      break;
    default:
      return null;
  }
  return (
    <div className={styles.field}>
      {!(field.kind === "value" && /Ms$/.test(field.name)) && <span className={styles.label}>{label}</span>}
      {input}
      {help && <p className={styles.hint}>{help}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- repeat bracket */

export type RoundSheetProps = {
  loop: LoopInfo;
  /** every block of the program and its includes */
  blocks: ReadonlyMap<string, Block>;
  own: ReadonlySet<string>;
  issues: readonly Issue[];
  expert: boolean;
  ctx: InspectorContext;
  onAddToRound: () => void;
};

/** Sheet of the "Repeat N rounds" bracket: the number of rounds (repeat block or counter). */
export function RoundSheet({ loop, blocks, own, issues, expert, ctx, onAddToRound }: RoundSheetProps) {
  const { t } = useTranslation();
  const doc = ctx.json;
  const head = blocks.get(loop.head);
  const count = loop.kind === "repeat" ? head?.count : loop.countValue;
  const apply: Apply = (next, mergeKey) => ctx.apply(next, mergeKey ? { mergeKey } : undefined);
  const countField = loop.kind === "repeat" ? "count" : head?.left === loop.counterVar ? "right" : "left";
  const editable = own.has(loop.head);
  return (
    <Sheet title={t("editor.step.roundTitle")} icon={<RepeatIcon />} category="logic" sub={t("editor.step.roundSub")} onClose={() => ctx.select(null)}>
      <div className={styles.body}>
        <ProblemList issues={issues} />
        {typeof count === "number" && !editable ? (
          <p className={styles.hint}>{t("editor.step.roundLocked", { count })}</p>
        ) : (
          <CountValue label={t("editor.step.rounds")} value={count} doc={doc} min={1} onField={(n) => apply(setBlockField(doc, loop.head, countField, n), `${loop.head}.${countField}`)} apply={apply} />
        )}
        <p className={styles.hint}>{t("editor.step.roundHint")}</p>
        <div className={inspector.actions}>
          <button className={inspector.action} onClick={onAddToRound}>
            <Plus size={18} aria-hidden /> {t("editor.step.addToEachRound")}
          </button>
        </div>
        {expert && head && editable && (
          <section className={styles.expert} aria-label={t("editor.step.expert")}>
            <h4>
              <Wrench size={14} aria-hidden /> {t("editor.step.expert")}
            </h4>
            <BlockExpertFields block={head} ctx={ctx} />
          </section>
        )}
      </div>
    </Sheet>
  );
}

function RepeatIcon() {
  const Icon = blockIcon("repeat");
  return <Icon size={18} aria-hidden />;
}

