/**
 * Adjust sheet (docs/app/editor-ux.md §4 G): the coach's weekly change without the editor. The
 * program's settings, the switches for the whole program, Try it and Save. Offered for every
 * program (mine, on the pod, shipped); anything not local is saved as a local copy with the same
 * path (decision 3: also from a read-only pod, which the sheet says before saving).
 */
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Info, Lock, Play, Save, SlidersHorizontal, Wand2 } from "lucide-react";
import { Sheet } from "../components/Sheet";
import { PodsField, TweakSettings } from "../editor/ProgramSettings";
import { setProgramField, type ProgramJson } from "../editor/ops";
import { isReadOnly, usePodSession } from "../pod/session";
import { useWorkspace } from "../store/workspace";
import { saveAdjusted } from "./actions";
import { editorUrl, simulateUrl, useProgramSource, type SourceId } from "./sources";
import { OptionList, Stepper, SwitchRow } from "../wizard/controls";
import { LIMITS } from "../wizard/answers";
import {
  programSwitchApplies,
  programSwitchState,
  programTimeLimit,
  programTimeoutAction,
  setProgramSwitch,
  setProgramTimeLimit,
  type ProgramSwitch,
} from "./programSwitches";
import styles from "./AdjustSheet.module.css";

export type AdjustTarget = { source: SourceId; path: string };

export function AdjustSheet({ target, onClose }: { target: AdjustTarget; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const source = useProgramSource(target.source);
  const existing = useWorkspace((s) => s.programs.find((p) => p.path === target.path));
  const readOnly = usePodSession((s) => target.source === "pod" && s.state === "connected" && isReadOnly(s));
  const [initial] = useState<ProgramJson | null>(() => {
    if (existing) return existing.json;
    const text = source.read(target.path);
    if (text === undefined) return null;
    try {
      return JSON.parse(text) as ProgramJson;
    } catch {
      return null;
    }
  });
  const [draft, setDraft] = useState<ProgramJson | null>(initial);
  const [busy, setBusy] = useState(false);
  const dirty = draft !== initial;
  const origin = target.source === "local" ? "local" : target.source === "pod" ? "pod" : "default";
  const local = target.source === "local" || existing !== undefined;

  const notes = useMemo(() => {
    const out: { key: string; icon: ReactNode; text: string; warn?: boolean }[] = [];
    if (readOnly) out.push({ key: "ro", icon: <Lock size={16} aria-hidden />, text: t("adjust.readOnly"), warn: true });
    if (target.source !== "local" && existing) out.push({ key: "copy", icon: <Info size={16} aria-hidden />, text: t("adjust.existingCopy") });
    return out;
  }, [readOnly, existing, target.source, t]);

  if (!draft) {
    return (
      <Overlay onClose={onClose}>
        <Sheet title={t("adjust.action")} icon={<SlidersHorizontal size={18} aria-hidden />} onClose={onClose}>
          <p>{t("adjust.notFound")}</p>
        </Sheet>
      </Overlay>
    );
  }

  const name = typeof draft.name === "string" ? draft.name : target.path;
  const sub = local ? t("adjust.subLocal") : target.source === "pod" ? t("adjust.subPod") : t("adjust.subShipped");
  const apply = (json: ProgramJson) => setDraft(json);
  const peripherals = typeof draft.peripherals === "number" ? draft.peripherals : 0;

  const save = async () => {
    setBusy(true);
    try {
      return await saveAdjusted(target.path, draft, origin);
    } finally {
      setBusy(false);
    }
  };

  const tryIt = async () => {
    if (!dirty) {
      navigate(existing ? simulateUrl({ id: existing.id }) : simulateUrl(target));
      return;
    }
    const doc = await save();
    navigate(simulateUrl({ id: doc.id }));
  };

  return (
    <Overlay onClose={dirty ? undefined : onClose}>
      <Sheet title={t("adjust.title", { name })} icon={<SlidersHorizontal size={18} aria-hidden />} sub={sub} onClose={onClose}>
        <div className={styles.body}>
          {notes.map((n) => (
            <p key={n.key} className={styles.note} data-warn={n.warn || undefined} role={n.warn ? "note" : undefined}>
              {n.icon}
              <span>{n.text}</span>
            </p>
          ))}

          <section className={styles.section} aria-label={t("adjust.settings")}>
            <TweakSettings json={draft} path={target.path} read={source.read} apply={apply} />
            <PodsField peripherals={peripherals} onChange={(n) => apply(setProgramField(draft, "peripherals", n))} />
          </section>

          <section className={styles.section} aria-label={t("adjust.wholeProgram")}>
            <h4 className={styles.heading}>{t("adjust.wholeProgram")}</h4>
            <ProgramSwitches json={draft} apply={apply} />
          </section>

          <div className={styles.actions}>
            <button type="button" className={styles.button} disabled={busy} onClick={() => void tryIt()}>
              <Play size={18} aria-hidden /> {dirty ? t("adjust.saveAndTry") : t("adjust.try")}
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              disabled={busy || !dirty}
              onClick={() =>
                void save().then(() => {
                  onClose();
                })
              }
            >
              <Save size={18} aria-hidden /> {t("adjust.save")}
            </button>
          </div>
          <button
            type="button"
            className={styles.link}
            disabled={busy}
            onClick={() =>
              void (async () => {
                const doc = dirty || !existing ? await save() : existing;
                navigate(editorUrl(doc.id));
              })()
            }
          >
            <Wand2 size={18} aria-hidden /> {t("adjust.steps")}
          </button>
        </div>
      </Sheet>
    </Overlay>
  );
}

/** Time limit, record times, results at the end – for every press of the program (programSwitches.ts). */
function ProgramSwitches({ json, apply }: { json: ProgramJson; apply: (json: ProgramJson) => void }) {
  const { t } = useTranslation();
  const locale = t("wizard.numberLocale");
  const sec = (ms: number) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(ms / 1000)} s`;
  const applies = (["timeLimit", "record", "results"] as const).filter((id) => programSwitchApplies(json, id));
  if (applies.length === 0) return <p className={styles.muted}>{t("adjust.noSwitches")}</p>;

  const state = (id: ProgramSwitch) => programSwitchState(json, id);
  const hint = (id: ProgramSwitch, on: string, off: string) => (state(id) === "mixed" ? t("adjust.mixed") : state(id) ? on : off);
  const limit = programTimeLimit(json);
  const action = programTimeoutAction(json);
  const limitMs = typeof limit === "number" ? limit : undefined;

  return (
    <>
      {applies.includes("timeLimit") && (
        <SwitchRow
          label={t("adjust.timeLimit")}
          hint={hint("timeLimit", limitMs !== undefined ? t("adjust.timeLimitOn", { s: sec(limitMs) }) : t("adjust.timeLimitSetting"), t("adjust.timeLimitOff"))}
          checked={state("timeLimit") === true}
          onChange={(on) => apply(setProgramSwitch(json, "timeLimit", on))}
        >
          {limitMs !== undefined && (
            <Stepper
              label={t("adjust.secondsToPress")}
              value={limitMs}
              min={LIMITS.timeLimitMs.min}
              max={LIMITS.timeLimitMs.max}
              step={LIMITS.timeLimitMs.step}
              format={sec}
              onChange={(ms) => apply(setProgramTimeLimit(json, ms))}
            />
          )}
          <OptionList<TimeoutChoice>
            label={t("wizard.timing.tooSlow")}
            value={action === "goOn" || action === "countMiss" || action === "endRound" ? action : ("" as TimeoutChoice)}
            options={(["goOn", "countMiss", "endRound"] as const).map((v) => ({ value: v, label: t(`wizard.timing.onTimeout.${v}`) }))}
            onChange={(v) => apply(setProgramSwitch(json, "timeLimit", true, { onTimeout: v }))}
          />
        </SwitchRow>
      )}
      {applies.includes("record") && (
        <SwitchRow
          label={t("adjust.record")}
          hint={hint("record", t("adjust.recordHint"), t("adjust.recordHint"))}
          checked={state("record") === true}
          onChange={(on) => apply(setProgramSwitch(json, "record", on))}
        />
      )}
      {applies.includes("results") && (
        <SwitchRow
          label={t("adjust.results")}
          hint={t("adjust.resultsHint")}
          checked={state("results") === true}
          onChange={(on) => apply(setProgramSwitch(json, "results", on))}
        />
      )}
    </>
  );
}

type TimeoutChoice = "goOn" | "countMiss" | "endRound";

/** Dims the page; the sheet sits at the bottom of the screen (or on the right on wide screens). */
function Overlay({ onClose, children }: { onClose?: () => void; children: ReactNode }) {
  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      {children}
    </div>
  );
}
