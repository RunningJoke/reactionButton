/**
 * Step sheet (docs/app/editor-ux.md §4 D, layout A): replaces the inspector. Top to bottom: the step in words,
 * problems, the essentials, Sprinkles (optional things as rows, `Sprinkles.tsx`), "More options", actions, and in
 * expert mode today's inspector fields (name, type, raw keys, ports).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, ArrowDown, ArrowUp, CircleAlert, Copy, Plus, Trash2, Wrench } from "lucide-react";
import { Sheet } from "../components/Sheet";
import { IF_OPS, isObject, type Block, type Issue } from "@reactpod/program-model";
import { Segmented, SwitchRow } from "../wizard/controls";
import { BlockExpertFields, PortRow, type InspectorContext } from "./BlockInspector";
import { blockCategory, blockIcon } from "./blockStyle";
import { EFFECTS, effectKind, hasEnd, isPeriodic, isTimed, setEffectKind, setEffectTarget, setEndless, usesColor } from "./effectStep";
import { CHARGE_STYLES, chargeMode, goIsRandom, holdPod, releaseMode, setChargeMode, setChargeStyle, setGoRandom, setHoldPod, setReleaseMode } from "./holdStep";
import { DEFAULT_GAME_MS, TOGGLE_STARTS, durationIsRandom, setDurationRandom, setTeamColor, setToggleStart, teamColors, toggleStart } from "./toggleStep";
import { ColorField, LedsField, ValueField } from "./fields";
import { MoreOptions } from "./MoreOptions";
import { isValidVariableName, setBlockField, setProgramField } from "./ops";
import { podChoice, setPodChoice } from "./podChoice";
import { stepSentence, type SentenceOptions } from "./sentence";
import { settingLabel } from "./settingLabels";
import { CountValue, Field, FixedOrRandomTime, fieldWords, TimeValue, type Apply, type FieldProps } from "./sheetParts";
import { AddSprinklePage, ReportResults, SprinkleSection, type SprinkleContext } from "./Sprinkles";
import { isCatchEarly, type LoopInfo, type Step } from "./structure";
import { switchState, setSwitch } from "./switches";
import inspector from "./Inspector.module.css";
import styles from "./StepSheet.module.css";

export { fieldWords, secondsText } from "./sheetParts";

export type StepSheetProps = {
  block: Block;
  step?: Step;
  /** problems of this block (validator issues) */
  issues: readonly Issue[];
  sentence: SentenceOptions;
  expert: boolean;
  ctx: InspectorContext;
};

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

export function StepSheet(props: StepSheetProps) {
  // a new step starts on the main page with every Sprinkle closed
  return <StepSheetBody key={props.block.name} {...props} />;
}

function StepSheetBody({ block, step, issues, sentence, expert, ctx }: StepSheetProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState<"main" | "add">("main");
  const [open, setOpen] = useState<string | null>(null);
  const doc = ctx.json;
  const name = block.name;
  const Icon = blockIcon(isCatchEarly(block) ? "delay" : block.type);
  const locked = ctx.lockedBy.get(name);
  const apply: Apply = (next, mergeKey) => ctx.apply(next, mergeKey ? { mergeKey } : undefined);
  const set = (field: string, value: unknown, merge = true) => apply(setBlockField(doc, name, field, value), merge ? `${name}.${field}` : undefined);
  const kind = t(`editor.step.kind.${isCatchEarly(block) ? "delay" : block.type}`, { defaultValue: t("editor.step.kind.unknown") });
  const title = step?.number ? t("editor.step.title", { n: step.number, kind }) : kind;
  const labelOf = (v: string) => settingLabel(v, t).label;
  const sprinkles: SprinkleContext = { block, doc, set, apply, variables: ctx.variables, metrics: ctx.metrics, inLoop: !!step?.inLoop, format: ctx.programFormat };

  return (
    <Sheet title={title} icon={<Icon size={18} aria-hidden />} category={blockCategory(block.type)} sub={step?.inLoop ? t("editor.step.inRound") : undefined} onClose={() => ctx.select(null)}>
      <div className={styles.body}>
        {page === "add" ? (
          <AddSprinklePage
            ctx={sprinkles}
            onBack={() => setPage("main")}
            onAdded={(id) => {
              setOpen(id);
              setPage("main");
            }}
          />
        ) : (
          <>
            <p className={styles.story}>{stepSentence(block, t, sentence)}</p>
            <ProblemList issues={issues} />
            <Essentials block={block} doc={doc} set={set} apply={apply} labelOf={labelOf} variables={ctx.variables} metrics={ctx.metrics} ctx={ctx} />
            <SprinkleSection ctx={sprinkles} open={open} setOpen={setOpen} onAdd={() => setPage("add")} />
            <MoreOptions block={block} doc={doc} set={set} apply={apply} variables={ctx.variables} metrics={ctx.metrics} />

            <div className={inspector.actions}>
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
              {ctx.duplicate && (
                <button className={inspector.action} onClick={() => ctx.duplicate!(name)}>
                  <Copy size={18} aria-hidden /> {t("editor.duplicate")}
                </button>
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
          </>
        )}
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- essentials */

function Essentials({ block, doc, set, apply, labelOf, variables, metrics, ctx }: FieldProps & { labelOf: (v: string) => string; variables: readonly string[]; metrics: readonly string[]; ctx: InspectorContext }) {
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
      return <ToggleFields block={block} doc={doc} set={set} apply={apply} />;
    case "communicate":
      return <CommunicateFields block={block} doc={doc} set={set} apply={apply} ctx={ctx} metrics={metrics} />;
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

/** Fixed | Random and the seconds of a pause (delay, or the catch-early button). */
function PauseTime({ block, doc, set, apply }: FieldProps) {
  const { t } = useTranslation();
  const early = block.type === "button";
  const [minF, maxF, fixedF] = early ? ["minTimeoutMs", "maxTimeoutMs", "minTimeoutMs"] : ["minMs", "maxMs", "ms"];
  return (
    <FixedOrRandomTime
      label={t("editor.step.howLong")}
      random={switchState(block, "randomPause")}
      onRandom={(random) => apply(setSwitch(doc, block.name, "randomPause", random))}
      // the catch-early pause is fixed when both limits are equal
      fixed={{ value: block[fixedF], onChange: (ms) => (early ? apply(setBlockField(setBlockField(doc, block.name, minF, ms), block.name, maxF, ms), `${block.name}.pause`) : set(fixedF, ms)) }}
      min={{ value: block[minF], onChange: (ms) => set(minF, ms) }}
      max={{ value: block[maxF], onChange: (ms) => set(maxF, ms) }}
      doc={doc}
      apply={apply}
    />
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
      <Segmented
        label={t("editor.step.label.mode")}
        value={accumulate ? "accumulate" : "release"}
        options={[
          { value: "release", label: h("chargeModes.release") },
          { value: "accumulate", label: h("chargeModes.accumulate") },
        ]}
        onChange={(v) => apply(setChargeMode(doc, block.name, v as "release" | "accumulate"))}
      />
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
          <FixedOrRandomTime
            label={h("signalAfter")}
            random={random}
            onRandom={(r) => apply(setGoRandom(doc, block.name, r))}
            fixed={{ value: block.goMs, onChange: (ms) => set("goMs", ms) }}
            min={{ value: block.minGoMs, onChange: (ms) => set("minGoMs", ms) }}
            max={{ value: block.maxGoMs, onChange: (ms) => set("maxGoMs", ms) }}
            doc={doc}
            apply={apply}
          />
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
function CommunicateFields({ block, doc, set, apply, ctx, metrics }: FieldProps & { ctx: InspectorContext; metrics: readonly string[] }) {
  const { t } = useTranslation();
  return (
    <>
      <p className={styles.hint}>{t("editor.step.communicate.hint")}</p>
      <ReportResults block={block} doc={doc} set={set} apply={apply} metrics={metrics} />
      {(["pressed", "timeout", "repeat", "stop"] as const).map((port) => (
        <PortRow key={port} port={port} block={block} ctx={ctx} hasNext />
      ))}
    </>
  );
}

function ToggleFields({ block, doc, set, apply }: FieldProps) {
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
      <FixedOrRandomTime
        label={d("length")}
        fixedLabel={d("duration")}
        random={random}
        onRandom={(r) => apply(setDurationRandom(doc, block.name, r))}
        fixed={{ value: block.durationMs ?? DEFAULT_GAME_MS, onChange: (ms) => set("durationMs", ms) }}
        min={{ value: block.minDurationMs, onChange: (ms) => set("minDurationMs", ms) }}
        max={{ value: block.maxDurationMs, onChange: (ms) => set("maxDurationMs", ms) }}
        doc={doc}
        apply={apply}
        minMs={1000}
      />
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
      <p className={styles.hint}>{d("endHint")}</p>
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
          <TimeValue label={e("speed")} value={block.periodMs ?? 500} doc={doc} apply={apply} min={100} max={10_000} step={100} onField={(ms) => set("periodMs", ms)} />
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

