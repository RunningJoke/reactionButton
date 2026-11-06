/** Sync on the Pod tab (docs/app/spec.md §9): state per file, take over / keep, push and restore defaults. */
import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowDownToLine, CircleAlert, CircleCheck, Loader, RotateCcw, Upload } from "lucide-react";
import { useConnectDialog } from "../app/connectDialogStore";
import { Modal, modalStyles } from "../components/Modal";
import { INDEX_PATH } from "@reactpod/program-model";
import { PodError } from "../pod/protocol";
import { isReadOnly, needsPin, usePodSession } from "../pod/session";
import { planPush, planRestore, unsentChanges, type FileSync, type PodIssue, type PushPlan, type PushResult, type PushStep, type SyncStatus } from "../pod/sync";
import { keepMine, keepPod, runPush, useMenuOverBudget, useSyncStates } from "../pod/syncActions";
import { editorUrl, podProgramFormat, viewUrl } from "../programs/sources";
import { useWorkspace } from "../store/workspace";
import page from "./Page.module.css";
import styles from "./PodSync.module.css";

const ATTENTION: SyncStatus[] = ["new", "localNewer", "podNewer", "conflict"];

export function SyncBadge({ status }: { status: SyncStatus }) {
  const { t } = useTranslation();
  if (status === "inSync" || status === "podOnly") return null;
  return (
    <span className={styles.badge} data-status={status}>
      {status === "conflict" ? <AlertTriangle size={12} aria-hidden /> : status === "podNewer" ? <ArrowDownToLine size={12} aria-hidden /> : <Upload size={12} aria-hidden />}
      {t(`sync.status.${status}`)}
    </span>
  );
}

/** The human name of a change: "Pod menu: new order", "Game: Mia's warm-up" – never a file path. */
export function changeLabel(t: TFunction, path: string, name?: unknown): string {
  if (path === INDEX_PATH) return t("sync.change.menu");
  return t("sync.change.game", { name: typeof name === "string" ? name : path.split("/").pop()!.replace(/.json$/, "") });
}

/**
 * Not on the pods yet: the changes in words and one "Send to pods"; in sync only a quiet line.
 * `states` is null while loading.
 */
export function UnsentCard({ states, readOnly }: { states: FileSync[] | null; readOnly: boolean }) {
  const { t } = useTranslation();
  // the dialog keeps the states of the moment it opened: the card goes away when the last change is sent
  const [snapshot, setSnapshot] = useState<FileSync[] | null>(null);
  const changed = (states ?? []).filter((s) => ATTENTION.includes(s.status));
  const unsent = unsentChanges(states).length;
  return (
    <>
      {states === null ? (
        <p className={page.muted}>
          <Loader size={14} aria-hidden className={styles.spin} /> {t("sync.loading")}
        </p>
      ) : changed.length === 0 ? (
        <p className={styles.clean}>
          <CircleCheck size={16} aria-hidden /> {t("sync.clean")}
        </p>
      ) : (
        <section className={styles.unsent} aria-labelledby="unsent-title">
          <h2 id="unsent-title">{unsent > 0 ? t("sync.unsent", { count: unsent }) : t("sync.review")}</h2>
          <ul className={styles.changes}>
            {changed.map((state) => (
              <ChangeRow key={state.path} state={state} readOnly={readOnly} />
            ))}
          </ul>
          {!readOnly && unsent > 0 && (
            <button className={`${page.bigButton} ${page.primary}`} onClick={() => setSnapshot(states)}>
              <Upload size={20} aria-hidden /> {t("sync.push")}
            </button>
          )}
        </section>
      )}
      {snapshot && <PushDialog mode="push" states={snapshot} onClose={() => setSnapshot(null)} />}
    </>
  );
}

/** Sticky bar on the menu page: changes are not on the pods yet, send them (or connect first). `local`: the menu was changed here. */
export function UnsentBar({ local }: { local: boolean }) {
  const { t } = useTranslation();
  const states = useSyncStates();
  const connected = usePodSession((s) => s.state === "connected");
  const readOnly = usePodSession((s) => isReadOnly(s));
  const show = useConnectDialog((s) => s.show);
  const [snapshot, setSnapshot] = useState<FileSync[] | null>(null);
  const pending = connected ? !readOnly && unsentChanges(states).length > 0 : local;
  return (
    <>
      {pending && (
        <div className={styles.bar2} role="status">
          <span>{t("sync.barText")}</span>
          <button className={styles.barButton} onClick={connected ? () => states && setSnapshot(states) : show}>
            {connected ? t("sync.push") : t("sync.connectToSend")}
          </button>
        </div>
      )}
      {snapshot && <PushDialog mode="push" states={snapshot} onClose={() => setSnapshot(null)} />}
    </>
  );
}

/** "Reset menu…" in danger style: opens the confirmation. */
export function ResetMenuButton({ states }: { states: FileSync[] | null }) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<FileSync[] | null>(null);
  return (
    <>
      <button className={styles.danger} disabled={!states} onClick={() => setSnapshot(states)}>
        <RotateCcw size={18} aria-hidden /> {t("sync.restore")}
      </button>
      {snapshot && <PushDialog mode="restore" states={snapshot} onClose={() => setSnapshot(null)} />}
    </>
  );
}

function ChangeRow({ state, readOnly }: { state: FileSync; readOnly: boolean }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const name = changeLabel(t, state.path, state.doc?.json.name);
  const run = (action: (s: FileSync) => Promise<void>) => () => {
    setError(null);
    action(state).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  return (
    <li className={styles.change}>
      <div className={styles.changeText}>
        <span className={styles.changeName}>{state.doc ? <Link to={editorUrl(state.doc.id)}>{name}</Link> : state.path === INDEX_PATH ? <Link to="/set/menu">{name}</Link> : name}</span>
        {state.status === "conflict" && <span className={styles.note}>{t("sync.conflictHint")}</span>}
        {error && <span className={modalStyles.error}>{error}</span>}
      </div>
      {/* new / not on the pods yet: the card heading already says so */}
      {state.status !== "new" && state.status !== "localNewer" && <SyncBadge status={state.status} />}
      {!readOnly && state.status === "podNewer" && (
        <button className={page.textButton} onClick={run(keepPod)}>
          {t("sync.takeOver")}
        </button>
      )}
      {!readOnly && state.status === "conflict" && (
        <span className={styles.choice}>
          <button className={page.textButton} onClick={run(keepPod)}>
            {t("sync.keepPod")}
          </button>
          <button className={page.textButton} onClick={run(keepMine)}>
            {t("sync.keepMine")}
          </button>
        </span>
      )}
    </li>
  );
}

type Phase = { kind: "plan" } | { kind: "running"; step: PushStep | null } | { kind: "done"; result: PushResult } | { kind: "failed"; code: string; message: string; uploaded: number };

/** Push (docs/app/spec.md §9.3) or restore defaults (§9.4): plan → progress → result. */
export function PushDialog({ mode, states, onClose }: { mode: "push" | "restore"; states: FileSync[]; onClose: () => void }) {
  const { t } = useTranslation();
  const session = usePodSession();
  const setMenu = useWorkspace((s) => s.setMenu);
  const [phase, setPhase] = useState<Phase>({ kind: "plan" });
  const [deselected, setDeselected] = useState<ReadonlySet<string>>(new Set());
  const [pin, setPin] = useState("");
  const askPin = needsPin(session);
  const overBudget = useMenuOverBudget();

  const candidates = useMemo(() => states.filter((s) => s.status === "new" || s.status === "localNewer"), [states]);
  const plan: PushPlan | null = useMemo(() => {
    if (!session.list) return null;
    const options = { podFiles: session.files, list: session.list, supportedTypes: session.info?.blockTypes, programFormat: podProgramFormat(session.info) };
    if (mode === "restore") return planRestore(options);
    return planPush(states, { ...options, selected: new Set(candidates.map((s) => s.path).filter((p) => !deselected.has(p))) });
  }, [mode, states, candidates, deselected, session.files, session.list, session.info]);

  const start = async () => {
    if (!plan) return;
    setPhase({ kind: "running", step: null });
    let uploaded = 0;
    try {
      if (askPin) await session.authenticate(pin);
      const result = await runPush(plan, (step) => {
        uploaded = step.done;
        setPhase({ kind: "running", step });
      });
      if (mode === "restore" && !result.stopped) await setMenu(undefined);
      setPhase({ kind: "done", result });
    } catch (e) {
      const code = e instanceof PodError ? e.code : "unknown";
      setPhase({ kind: "failed", code, message: e instanceof Error ? e.message : String(e), uploaded });
    }
  };

  const title = mode === "push" ? t("sync.pushTitle") : t("sync.restoreTitle");
  const running = phase.kind === "running";
  const blocked = !plan || plan.errors.size > 0 || plan.uploads.length === 0 || (askPin && !pin);
  const close = () => !running && onClose();

  return (
    <Modal
      open
      title={title}
      onClose={close}
      actions={
        phase.kind === "plan" ? (
          <>
            <button className={modalStyles.button} onClick={close}>
              {t("common.cancel")}
            </button>
            <button className={`${modalStyles.button} ${mode === "push" ? modalStyles.primary : modalStyles.danger}`} disabled={blocked} onClick={() => void start()}>
              {mode === "push" ? t("sync.start") : t("sync.restoreStart")}
            </button>
          </>
        ) : (
          <button className={`${modalStyles.button} ${modalStyles.primary}`} disabled={running} onClick={close}>
            {t("sync.close")}
          </button>
        )
      }
    >
      {phase.kind === "plan" && plan && (
        <>
          {mode === "restore" && (
            <p>
              <strong>{t("sync.restoreLead")}</strong> {t("sync.restoreText")}
            </p>
          )}
          {mode === "push" && candidates.length > 1 && (
            <fieldset className={styles.selection}>
              <legend>{t("sync.choose")}</legend>
              {candidates.map((s) => (
                <label key={s.path}>
                  <input
                    type="checkbox"
                    checked={!deselected.has(s.path)}
                    onChange={(e) => {
                      const next = new Set(deselected);
                      if (e.target.checked) next.delete(s.path);
                      else next.add(s.path);
                      setDeselected(next);
                    }}
                  />
                  {changeLabel(t, s.path, s.doc?.json.name)}
                </label>
              ))}
            </fieldset>
          )}
          {plan.uploads.length === 0 ? (
            <p>
              <strong>{t("sync.nothing")}</strong>
            </p>
          ) : (
            mode === "push" && <PlanInWords uploads={plan.uploads} />
          )}
          {mode === "push" && overBudget && <p className={styles.warnText}>{t("pod.storeOverBudget")}</p>}
          {plan.skipped.length > 0 && <p className={styles.note}>{t("sync.skipped", { count: plan.skipped.length })}</p>}
          {plan.errors.size > 0 && <LocalErrors errors={plan.errors} />}
          {askPin && plan.uploads.length > 0 && (
            <>
              <label htmlFor="push-pin">{t("pod.pin")}</label>
              <input
                id="push-pin"
                className={modalStyles.input}
                value={pin}
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
              <p className={styles.note}>{t("pod.pinHint")}</p>
            </>
          )}
        </>
      )}
      {phase.kind === "running" && (
        <div aria-live="polite">
          <progress className={styles.bar} max={phase.step?.total ?? 1} value={phase.step?.done ?? 0} aria-label={t("sync.progress")} />
          <p className={styles.progress}>
            {phase.step ? t(phase.step.phase === "upload" ? "sync.uploading" : "sync.checking", { done: phase.step.done + 1, total: phase.step.total }) : t("sync.starting")}
          </p>
          <p className={styles.warnText}>
            <strong>{t("sync.keepOn")}</strong>
          </p>
        </div>
      )}
      {phase.kind === "done" && <PushDone result={phase.result} mode={mode} />}
      {phase.kind === "failed" && (
        <div role="alert">
          <p className={modalStyles.error}>
            <strong>{t("sync.failed")}</strong> {t(`pod.errors.${KNOWN_ERRORS.includes(phase.code) ? phase.code : "unknown"}`)}
          </p>
          <p className={styles.note}>{phase.message}</p>
          {phase.uploaded > 0 && <p className={styles.note}>{t("sync.partial", { count: phase.uploaded })}</p>}
        </div>
      )}
    </Modal>
  );
}

const KNOWN_ERRORS = ["timeout", "disconnected", "busy", "overflow", "auth_required", "auth_failed"];

function LocalErrors({ errors }: { errors: Map<string, { code: string; block?: string; params?: Record<string, string | number> }[]> }) {
  const { t } = useTranslation();
  const programs = useWorkspace((s) => s.programs);
  return (
    <div className={styles.errors} role="alert">
      <p>
        <CircleAlert size={16} aria-hidden /> <strong>{t("sync.errorsTitle")}</strong>
      </p>
      <ul>
        {[...errors].map(([path, issues]) => {
          const doc = programs.find((p) => p.path === path);
          return issues.map((issue, i) => (
            <li key={`${path}${i}`}>
              {doc ? <Link to={editorUrl(doc.id, issue.block)}>{path}</Link> : path}
              {issue.block ? ` · ${issue.block}` : ""}: {t(`issues.${issue.code}`, issue.params ?? {})}
            </li>
          ));
        })}
      </ul>
    </div>
  );
}

/** What the plan changes, in words: your games and the menu by name, the rest as a count. */
function PlanInWords({ uploads }: { uploads: PushPlan["uploads"] }) {
  const { t } = useTranslation();
  const programs = useWorkspace((s) => s.programs);
  const named = uploads.filter((u) => u.reason === "program" || u.reason === "menu");
  const extra = uploads.length - named.length;
  return (
    <>
      <p>
        <strong>{t("sync.planTitle")}</strong>
      </p>
      <ul className={styles.plan}>
        {named.map((u) => (
          <li key={u.path}>{changeLabel(t, u.path, programs.find((p) => p.path === u.path)?.json.name)}</li>
        ))}
        {extra > 0 && <li>{t("sync.planExtra", { count: extra })}</li>}
      </ul>
    </>
  );
}

export function PushDone({ result, mode }: { result: PushResult; mode: "push" | "restore" }) {
  const { t } = useTranslation();
  return (
    <>
      {result.stopped ? (
        <p className={modalStyles.error}>{t("sync.stopped")}</p>
      ) : (
        <>
          <p className={styles.success}>
            <CircleCheck size={20} aria-hidden /> <strong>{t(mode === "push" ? "sync.doneTitle" : "sync.resetDone")}</strong>
          </p>
          {mode === "restore" && <p>{t("sync.resetDoneText")}</p>}
          <p className={styles.next}>
            <strong>{t("sync.nextTitle")}</strong>
          </p>
          <ol className={styles.checklist}>
            <li>{t("sync.nextOn")}</li>
            <li>{t("sync.nextStart")}</li>
          </ol>
        </>
      )}
      {result.podIssues.length > 0 && <PodIssues issues={result.podIssues} />}
    </>
  );
}

/** The pod's loader messages, linked to the block in the editor (or the pod's program view). */
function PodIssues({ issues }: { issues: PodIssue[] }) {
  const { t } = useTranslation();
  const programs = useWorkspace((s) => s.programs);
  return (
    <div className={styles.errors} role="alert">
      <p>
        <CircleAlert size={16} aria-hidden /> <strong>{t("sync.podIssuesTitle")}</strong>
      </p>
      <ul>
        {issues.map((issue, i) => {
          const doc = programs.find((p) => p.path === (issue.file ?? issue.path)) ?? programs.find((p) => p.path === issue.path);
          const href = doc ? editorUrl(doc.id, issue.block) : viewUrl("pod", issue.path);
          return (
            <li key={i}>
              <Link to={href}>{issue.path}</Link>: {issue.message}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
