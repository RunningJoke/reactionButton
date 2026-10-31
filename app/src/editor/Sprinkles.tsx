/**
 * Sprinkles of the step sheet (issue #88, editor-ux.md §4 D): optional things of a step as quiet rows
 * (icon, name, value, chevron) that open in place, one at a time, and the "Add sprinkle" page.
 * The state comes from the program through `behaviours.ts`; this file only draws it.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ChevronDown, ChevronLeft, ChevronRight, Clock, CornerDownRight, Database, Droplets, Hand, Hourglass, PowerOff, Plus, Save, Smartphone, Target, Timer, TriangleAlert, Users, Zap, Ban, Flag, type LucideIcon } from "lucide-react";
import { isObject, MAX_LIST_ITEMS, type Block } from "@reactpod/program-model";
import { SwitchRow } from "../wizard/controls";
import { ExitRow, exitValueText, type ExitEnv } from "./ExitPicker";
import { BEHAVIOURS, modeOf, suggestTimerNames, timerNames, type Behaviour, type BehaviourGroup, type BehaviourId, type BehaviourState } from "./behaviours";
import { COUNTDOWN_STYLES, COUNTDOWN_TARGETS, countdownKind, countdownStyle, hasCountdownTime, setCountdown } from "./countdown";
import { ColorField, NumberInput, SuggestField } from "./fields";
import { limitFieldOf } from "./holdStep";
import { editableValue, nameItems } from "./ListFields";
import { type ProgramJson } from "./ops";
import { CountValue, Field, FixedOrRandomTime, fieldWords, secondsText, TimeValue, type FieldProps } from "./sheetParts";
import { settingLabel } from "./settingLabels";
import { mainPort } from "./structure";
import { TOGGLE_RESULTS } from "./toggleStep";
import inspector from "./Inspector.module.css";
import styles from "./StepSheet.module.css";

const BUILT_IN = ["REQUIRED_PERIPHERALS", "NODE_COUNT"];

const ICONS: Record<string, LucideIcon> = {
  timeLimit: Timer,
  avoid: Ban,
  longPress: Hand,
  falseStart: TriangleAlert,
  holdFirst: Hourglass,
  drains: Droplets,
  includeCentral: Users,
  record: Clock,
  keepResult: Save,
  phoneSettings: Smartphone,
  showBar: Target,
  stopwatch: Zap,
  goTo: CornerDownRight,
  podsOff: PowerOff,
  countdown: Database,
};

const GROUPS: readonly BehaviourGroup[] = ["rules", "measure", "flow"];

/** Two behaviours worth offering first, in this order, when the step does not have them yet. */
const SUGGEST: readonly BehaviourId[] = ["timeLimit", "record", "keepResult", "stopwatch", "podsOff", "longPress", "holdFirst", "avoid", "showBar", "phoneSettings", "falseStart", "drains"];

export type SprinkleContext = FieldProps & {
  variables: readonly string[];
  metrics: readonly string[];
  /** program format of the connected pod; missing: everything is offered */
  format?: number;
  /** the exit rows and the picker */
  exits: ExitEnv;
};

/** "1.5 s" from the model → "1,5 s" in German. */
function localise(text: string, t: TFunction): string {
  return text.replace(/(\d)\.(\d)/g, `$1${t("sentence.decimal")}$2`);
}

/** The countdown of a pause or a game is a row of its own; on a timed step it sits inside "Time limit". */
const ownCountdown = (block: Block) => ["pause", "game"].includes(countdownKind(block) ?? "");

type Item = { id: string; group: BehaviourGroup; behaviour?: Behaviour; state: BehaviourState };

/** Every behaviour (and the pause countdown) that applies to the step, with its state. */
function itemsOf(block: Block, doc: ProgramJson): Item[] {
  const mode = modeOf(block);
  const items: Item[] = BEHAVIOURS.filter((b) => b.appliesTo(block, mode)).map((b) => ({ id: b.id, group: b.group, behaviour: b, state: b.isOn(block, doc) }));
  if (ownCountdown(block)) items.push({ id: "countdown", group: "rules", state: countdownStyle(block) ? "on" : "off" });
  return items;
}

function offFormat(item: Item, block: Block, format?: number): boolean {
  if (format === undefined) return false;
  if (item.id === "countdown") return format < 3;
  return !item.behaviour!.appliesTo(block, modeOf(block), format);
}

/* ---------------------------------------------------------------- the list */

export function SprinkleSection({ ctx, open, setOpen, onAdd }: { ctx: SprinkleContext; open: string | null; setOpen: (id: string | null) => void; onAdd: () => void }) {
  const { t } = useTranslation();
  const { block, doc, format } = ctx;
  const items = itemsOf(block, doc);
  const rows = items.filter((i) => i.state !== "off");
  const suggestions = SUGGEST.map((id) => items.find((i) => i.id === id)).filter((i): i is Item => !!i && i.state === "off" && !offFormat(i, block, format) && canAdd(i, ctx)).slice(0, 2);
  return (
    <section className={styles.sprinkles} aria-label={t("editor.sprinkle.title")}>
      <h4 className={styles.sectionTitle}>{t("editor.sprinkle.title")}</h4>
      {rows.map((item) => (
        <SprinkleRow key={item.id} item={item} ctx={ctx} open={open === item.id} onToggle={() => setOpen(open === item.id ? null : item.id)} close={() => setOpen(null)} />
      ))}
      <button type="button" className={styles.addButton} onClick={onAdd}>
        <Plus size={18} aria-hidden /> {t("editor.sprinkle.add")}
      </button>
      {suggestions.length > 0 && (
        <p className={styles.suggest}>
          <span>{t("editor.sprinkle.try")}</span>
          {suggestions.map((s) => (
            <button key={s.id} type="button" onClick={() => add(s, ctx, setOpen)}>
              + {t(`editor.sprinkle.${s.id}.name`)}
            </button>
          ))}
        </p>
      )}
    </section>
  );
}

function canAdd(item: Item, ctx: SprinkleContext): boolean {
  // a report can only list settings the program declares
  if (item.id === "phoneSettings") return declared(ctx).length > 0;
  return true;
}

const declared = (ctx: SprinkleContext) => ctx.variables.filter((v) => !BUILT_IN.includes(v));

function add(item: Item, ctx: SprinkleContext, setOpen: (id: string | null) => void) {
  const { block, doc, apply } = ctx;
  if (item.id === "countdown") apply(setCountdown(doc, block.name, "drain"));
  // "Then go to…" has no default: the picker chooses where
  else if (item.id === "goTo") return ctx.exits.open(mainPort(block) ?? "next");
  else apply(item.behaviour!.turnOn(doc, block.name));
  setOpen(item.id);
}

function SprinkleRow({ item, ctx, open, onToggle, close }: { item: Item; ctx: SprinkleContext; open: boolean; onToggle: () => void; close: () => void }) {
  const { t } = useTranslation();
  const { block, doc, apply } = ctx;
  const Icon = ICONS[item.id] ?? Zap;
  const name = t(`editor.sprinkle.${item.id}.name`);
  const custom = item.state === "custom";
  const value = custom ? t("editor.sprinkle.custom") : rowValue(item, ctx, t);
  const body = custom ? null : bodyOf(item.id, ctx);
  const remove = () => {
    apply(item.id === "countdown" ? setCountdown(doc, block.name, null) : item.behaviour!.turnOff(doc, block.name));
    close();
  };
  const removeText = t(`editor.sprinkle.${item.id}.remove`, { defaultValue: t("editor.sprinkle.remove") });
  const head = (
    <>
      <Icon size={20} aria-hidden className={styles.sIcon} />
      <span className={styles.sName}>{name}</span>
      {value && <span className={styles.sValue}>{value}</span>}
    </>
  );
  // a Sprinkle without settings has no body: its row carries the remove button
  if (!body) {
    return (
      <div className={styles.sRow} data-custom={custom || undefined}>
        <div className={styles.sHead} data-static>
          {head}
          {custom ? null : (
            <button type="button" className={styles.sRemoveInline} onClick={remove}>
              {removeText}
            </button>
          )}
        </div>
        {custom && <p className={styles.sBodyHint}>{t("editor.sprinkle.customHint")}</p>}
      </div>
    );
  }
  return (
    <div className={styles.sRow} data-open={open || undefined}>
      <button type="button" className={styles.sHead} aria-expanded={open} onClick={onToggle}>
        {head}
        {open ? <ChevronDown size={18} aria-hidden className={styles.chevron} /> : <ChevronRight size={18} aria-hidden className={styles.chevron} />}
      </button>
      {open && (
        <div className={styles.sBody} role="region" aria-label={name}>
          {body}
          <button type="button" className={styles.sRemove} onClick={remove}>
            {removeText}
          </button>
        </div>
      )}
    </div>
  );
}

/** The value shown right of the name. */
function rowValue(item: Item, ctx: SprinkleContext, t: TFunction): string | undefined {
  const { block, doc } = ctx;
  if (item.id === "countdown") {
    const style = countdownStyle(block);
    return style ? t(`editor.switch.countdown.styles.${style}`) : undefined;
  }
  if (item.id === "goTo") return exitValueText(ctx.exits, block, mainPort(block) ?? "next", t);
  const text = item.behaviour!.summary(block, doc);
  if (!text) return item.id === "includeCentral" ? t("editor.sprinkle.yes") : undefined;
  if (item.id === "timeLimit" && typeof block.timeoutMs === "number" && block.type !== "remoteMultiPress" && block.type !== "button") return secondsText(block.timeoutMs, t);
  if (item.id === "avoid" && block.type === "remoteMultiPress") return t("editor.sprinkle.avoid.count", { count: Number(text) || 0 });
  return localise(text, t);
}

/* ---------------------------------------------------------------- bodies */

function bodyOf(id: string, ctx: SprinkleContext): ReactNode {
  const { block } = ctx;
  switch (id) {
    case "timeLimit":
      return <TimeLimitBody {...ctx} />;
    case "avoid":
      return block.type === "remoteMultiPress" ? <AvoidBody {...ctx} /> : null;
    case "longPress":
      return <TimeLong {...ctx} />;
    case "falseStart":
      return <EarlyBody {...ctx} />;
    case "keepResult":
      return <KeepBody {...ctx} />;
    case "stopwatch":
      return <StopwatchBody {...ctx} />;
    case "holdFirst":
      return <HoldFirstBody {...ctx} />;
    case "drains":
      return <DrainsBody {...ctx} />;
    case "showBar":
      return <ShowBarBody {...ctx} />;
    case "phoneSettings":
      return <PhoneBody {...ctx} />;
    case "countdown":
      return <CountdownBody {...ctx} />;
    case "goTo":
      return <ExitRow env={ctx.exits} block={block} port={mainPort(block) ?? "next"} />;
    default:
      return null;
  }
}

function DrainsBody({ block, doc, set, apply }: SprinkleContext) {
  const { t } = useTranslation();
  return (
    <>
      <TimeValue label={fieldWords("decayMs", t)} value={block.decayMs} doc={doc} apply={apply} onField={(ms) => set("decayMs", ms)} />
      <p className={styles.hint}>{t("editor.step.help.decayMs")}</p>
    </>
  );
}

function TimeLong(ctx: SprinkleContext) {
  const { t } = useTranslation();
  return (
    <>
      <TimeValue label={t("editor.switch.holdTime")} value={ctx.block.shortMs ?? 1000} doc={ctx.doc} apply={ctx.apply} onField={(ms) => ctx.set("shortMs", ms)} />
      {(["short", "long"] as const).map((port) => (
        <ExitRow key={port} env={ctx.exits} block={ctx.block} port={port} />
      ))}
    </>
  );
}

function TimeLimitBody(ctx: SprinkleContext) {
  const { t } = useTranslation();
  const { block, doc, set, apply, format, exits } = ctx;
  const s = (key: string) => t(`editor.switch.${key}`);
  const exit = <ExitRow env={exits} block={block} port="timeout" />;
  if (block.type === "communicate") {
    return (
      <>
        <TimeValue label={s("seconds")} value={block.timeoutMs} doc={doc} apply={apply} min={500} onField={(ms) => set("timeoutMs", ms)} />
        {exit}
      </>
    );
  }
  const limitField = block.type === "release" ? limitFieldOf(block) : "timeoutMs";
  const randomLimit = block[limitField] === undefined && block.minTimeoutMs !== undefined;
  const label = block.mode === "avoid" ? s("staysRed") : block.type === "release" && limitField === "maxHoldMs" ? s("holdLimit") : s("seconds");
  return (
    <>
      <FixedOrRandomTime
        label={label}
        fixedLabel={label}
        random={randomLimit}
        fixed={{ value: block[limitField], onChange: (ms) => set(limitField, ms) }}
        min={{ value: block.minTimeoutMs, onChange: (ms) => set("minTimeoutMs", ms) }}
        max={{ value: block.maxTimeoutMs, onChange: (ms) => set("maxTimeoutMs", ms) }}
        doc={doc}
        apply={apply}
      />
      {exit}
      {countdownKind(block) === "limit" && (format === undefined || format >= 3) && <CountdownRow {...ctx} />}
    </>
  );
}

function AvoidBody({ block, doc, set, apply, exits }: SprinkleContext) {
  const { t } = useTranslation();
  const s = (key: string) => t(`editor.switch.${key}`);
  return (
    <>
      <CountValue label={s("redPods")} value={block.avoid} doc={doc} min={1} max={31} onField={(n) => set("avoid", n)} apply={apply} />
      <Field label={s("redColour")}>
        <ColorField value={block.avoidColor} optional defaultValue="red" label={s("redColour")} onChange={(c) => set("avoidColor", c, false)} />
      </Field>
      <ExitRow env={exits} block={block} port="avoidHit" />
    </>
  );
}

function EarlyBody({ block, exits }: SprinkleContext) {
  return <ExitRow env={exits} block={block} port="pressed" />;
}

function KeepBody({ block, set, variables }: SprinkleContext) {
  const { t } = useTranslation();
  const labelOf = (v: string) => settingLabel(v, t).label;
  if (block.type === "toggle") {
    const d = (key: string) => t(`editor.step.toggle.${key}`);
    return (
      <>
        {TOGGLE_RESULTS.map(([field, variable, key]) => (
          <SwitchRow key={field} label={d(`result.${key}`)} hint={typeof block[field] === "string" ? t("editor.step.keptIn", { name: labelOf(block[field] as string) }) : undefined} checked={typeof block[field] === "string"} onChange={(on) => set(field, on ? variable : undefined, false)} />
        ))}
      </>
    );
  }
  const fields = block.type === "charge" ? ["storeAs", "storePercent"] : ["storeAs"];
  return (
    <>
      {fields.map((f) => (
        <Field key={f} label={fieldWords(f, t)}>
          <SuggestField value={block[f]} suggestions={variables} placeholder={t("editor.step.notKept")} label={fieldWords(f, t)} onChange={(v) => set(f, v)} />
        </Field>
      ))}
      <p className={styles.hint}>{t("editor.step.help.storeAs")}</p>
    </>
  );
}

function StopwatchBody({ block, doc, set }: SprinkleContext) {
  const { t } = useTranslation();
  const names = [...new Set([...timerNames(doc), ...suggestTimerNames(doc)])];
  return (
    <>
      {(["timerStart", "timerStop"] as const).map((f) => (
        <Field key={f} label={fieldWords(f, t)}>
          <SuggestField value={block[f]} suggestions={names} placeholder={t("editor.sprinkle.stopwatch.none")} label={fieldWords(f, t)} onChange={(v) => set(f, v)} />
        </Field>
      ))}
      <p className={styles.hint}>{t("editor.sprinkle.stopwatch.hint")}</p>
    </>
  );
}

function HoldFirstBody({ block, doc, set, apply, exits }: SprinkleContext) {
  const { t } = useTranslation();
  const field = block.type === "charge" ? "onsetMs" : "holdTimeoutMs";
  return (
    <>
      <TimeValue label={fieldWords(field, t)} value={block[field]} doc={doc} apply={apply} onField={(ms) => set(field, ms)} />
      <p className={styles.hint}>{t(`editor.step.help.${field}`)}</p>
      {block.type === "release" && <ExitRow env={exits} block={block} port="noHold" />}
    </>
  );
}

function ShowBarBody({ block, doc, set, apply }: SprinkleContext) {
  const { t } = useTranslation();
  return (
    <>
      <TimeValue label={t("editor.sprinkle.showBar.target")} value={block.targetMs} doc={doc} apply={apply} min={1} max={60_000} step={50} onField={(ms) => set("targetMs", ms)} />
      <TimeValue label={t("editor.sprinkle.showBar.howLong")} value={block.showMs ?? 3000} doc={doc} apply={apply} min={0} max={60_000} onField={(ms) => set("showMs", ms)} />
    </>
  );
}

/* ---------------------------------------------------------------- report to phone */

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={styles.check} data-disabled={disabled || undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** "Report to phone", results: all results (default) or a choice of the metrics the program records (spec §9.6.2). */
export function ReportResults({ block, metrics, set }: FieldProps & { metrics: readonly string[] }) {
  const { t } = useTranslation();
  const chosen = nameItems(block.metrics);
  const all = chosen.length === 0;
  const choices = [...new Set([...metrics, ...chosen])];
  const write = (next: string[]) => set("metrics", next.length ? next : undefined, false);
  return (
    <Field label={t("editor.sprinkle.report.results")}>
      <Check label={t("editor.sprinkle.report.allResults")} checked={all} onChange={(on) => write(on ? [] : choices.slice(0, MAX_LIST_ITEMS))} />
      {!all &&
        choices.map((m) => (
          <Check key={m} label={m} checked={chosen.includes(m)} disabled={!chosen.includes(m) && chosen.length >= MAX_LIST_ITEMS} onChange={(on) => write(on ? [...chosen, m] : chosen.filter((x) => x !== m))} />
        ))}
      {choices.length === 0 && <p className={styles.hint}>{t("editor.sprinkle.report.noResults")}</p>}
    </Field>
  );
}

/** "Settings to include" and "Coach may change while it waits" as checkboxes (spec §9.6.2). */
function PhoneBody(ctx: SprinkleContext) {
  const { block, set } = ctx;
  const { t } = useTranslation();
  const settings = declared(ctx);
  const vars = nameItems(block.vars);
  const editable = editableValue(block.editable);
  const writeVars = (next: string[]) => set("vars", next.length ? next : undefined, false);
  const writeEditable = (next: Record<string, { min: number; max: number }>) => set("editable", Object.keys(next).length ? next : undefined, false);
  const start = isObject(ctx.doc.variables) ? (ctx.doc.variables as Record<string, unknown>) : {};
  return (
    <>
      <Field label={t("editor.sprinkle.report.include")}>
        {settings.map((v) => (
          <Check key={v} label={settingLabel(v, t).label} checked={vars.includes(v)} disabled={!vars.includes(v) && vars.length >= MAX_LIST_ITEMS} onChange={(on) => writeVars(on ? [...vars, v] : vars.filter((x) => x !== v))} />
        ))}
      </Field>
      <Field label={t("editor.sprinkle.report.coach")}>
        {settings.map((v) => {
          const range = editable[v];
          const now = typeof start[v] === "number" ? (start[v] as number) : 10;
          return (
            <div key={v}>
              <Check label={settingLabel(v, t).label} checked={!!range} disabled={!range && Object.keys(editable).length >= MAX_LIST_ITEMS} onChange={(on) => writeEditable(on ? { ...editable, [v]: { min: 0, max: Math.max(10, now * 2) } } : Object.fromEntries(Object.entries(editable).filter(([k]) => k !== v)))} />
              {range && (
                <div className={styles.bounds}>
                  <label>
                    <span>{t("list.min")}</span>
                    <NumberInput value={range.min} label={t("list.minOf", { name: v })} onChange={(n) => n !== undefined && writeEditable({ ...editable, [v]: { ...range, min: n } })} />
                  </label>
                  <label>
                    <span>{t("list.max")}</span>
                    <NumberInput value={range.max} label={t("list.maxOf", { name: v })} onChange={(n) => n !== undefined && writeEditable({ ...editable, [v]: { ...range, max: n } })} />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </Field>
    </>
  );
}

/* ---------------------------------------------------------------- countdown */

function CountdownBody({ block, doc, set, apply }: FieldProps) {
  const { t } = useTranslation();
  const c = (key: string, o?: Record<string, unknown>) => t(`editor.switch.countdown.${key}`, o);
  const style = countdownStyle(block);
  const peripherals = typeof doc.peripherals === "number" ? doc.peripherals : 0;
  const target = block.countdownTarget === undefined ? "central" : block.countdownTarget;
  const chip = (key: string, label: string, pressed: boolean, onClick: () => void) => (
    <button key={key} type="button" className={inspector.chip} aria-pressed={pressed} onClick={onClick}>
      {label}
    </button>
  );
  return (
    <>
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
    </>
  );
}

/** "Show the time running out" inside Time limit: a switch, because the limit may exist without it. */
function CountdownRow(ctx: FieldProps) {
  const { t } = useTranslation();
  const { block, doc, apply } = ctx;
  const c = (key: string, o?: Record<string, unknown>) => t(`editor.switch.countdown.${key}`, o);
  const style = countdownStyle(block);
  const available = hasCountdownTime(block);
  return (
    <SwitchRow
      label={c("label")}
      hint={!available ? c("needsLimit") : style ? c("on", { style: c(`styles.${style}`) }) : c("off")}
      checked={style !== null}
      disabled={!available}
      onChange={(on) => apply(setCountdown(doc, block.name, on ? "drain" : null))}
    >
      <CountdownBody {...ctx} />
    </SwitchRow>
  );
}

/* ---------------------------------------------------------------- the add page */

export function AddSprinklePage({ ctx, onBack, onAdded }: { ctx: SprinkleContext; onBack: () => void; onAdded: (id: string) => void }) {
  const { t } = useTranslation();
  const { block, doc, format } = ctx;
  const items = itemsOf(block, doc).filter((i) => i.state === "off");
  return (
    <div className={styles.addPage}>
      <button type="button" className={styles.back} onClick={onBack}>
        <ChevronLeft size={18} aria-hidden /> {t("editor.sprinkle.back")}
      </button>
      <h4 className={styles.sectionTitle}>{t("editor.sprinkle.addTitle")}</h4>
      {items.length === 0 && <p className={styles.hint}>{t("editor.sprinkle.none")}</p>}
      {GROUPS.map((group) => {
        const list = items.filter((i) => i.group === group);
        if (list.length === 0) return null;
        return (
          <section key={group} className={styles.addGroup} aria-label={t(`editor.sprinkle.group.${group}`)}>
            <h5>{t(`editor.sprinkle.group.${group}`)}</h5>
            {list.map((item) => {
              const reason = offFormat(item, block, format) ? t("editor.sprinkle.needsFormat", { n: item.id === "countdown" ? 3 : Math.max(item.behaviour!.minFormat, 2) }) : !canAdd(item, ctx) ? t("editor.sprinkle.needsSetting") : undefined;
              const Icon = ICONS[item.id] ?? Flag;
              return (
                <button key={item.id} type="button" className={styles.addItem} disabled={!!reason} onClick={() => add(item, ctx, () => onAdded(item.id))}>
                  <Icon size={20} aria-hidden className={styles.sIcon} />
                  <span>
                    <strong>{t(`editor.sprinkle.${item.id}.name`)}</strong>
                    <span className={styles.muted}>{reason ?? t(`editor.sprinkle.${item.id}.desc`)}</span>
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
