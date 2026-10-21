/** Sync on the Pod tab (docs/app/spec.md §9): state per file, take over / keep, push and restore defaults. */
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowDownToLine, CircleAlert, CircleCheck, Loader, RotateCcw, Upload } from "lucide-react";
import { Modal, modalStyles } from "../components/Modal";
import { INDEX_PATH } from "@reactpod/program-model";
import { PodError } from "../pod/protocol";
import { needsPin, usePodSession } from "../pod/session";
import { planPush, planRestore, type FileSync, type PodIssue, type PushPlan, type PushResult, type PushStep, type SyncStatus } from "../pod/sync";
import { keepMine, keepPod, runPush } from "../pod/syncActions";
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

/** Summary, changed files with their actions, push and restore. `states` is null while loading. */
export function SyncSection({ states, readOnly }: { states: FileSync[] | null; readOnly: boolean }) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<"push" | "restore" | null>(null);
  const changed = (states ?? []).filter((s) => ATTENTION.includes(s.status));
  const toPush = changed.filter((s) => s.status === "new" || s.status === "localNewer").length;

  return (
    <section className={page.section}>
      <h2>{t("sync.title")}</h2>
      {states === null ? (
        <p className={page.muted}>
          <Loader size={14} aria-hidden className={styles.spin} /> {t("sync.loading")}
        </p>
      ) : changed.length === 0 ? (
        <p className={styles.clean}>
          <CircleCheck size={16} aria-hidden /> {t("sync.clean")}
        </p>
      ) : (
        <ul className={styles.changes}>
          {changed.map((state) => (
            <ChangeRow key={state.path} state={state} readOnly={readOnly} />
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className={page.actions}>
          <button className={`${page.bigButton} ${page.primary}`} disabled={!states || toPush === 0} onClick={() => setDialog("push")}>
            <Upload size={20} aria-hidden /> {t("sync.push")}
          </button>
          <button className={page.bigButton} disabled={!states} onClick={() => setDialog("restore")}>
            <RotateCcw size={20} aria-hidden /> {t("sync.restore")}
          </button>
        </div>
      )}
      {states && dialog && <PushDialog mode={dialog} states={states} onClose={() => setDialog(null)} />}
    </section>
  );
}

function ChangeRow({ state, readOnly }: { state: FileSync; readOnly: boolean }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const name = state.path === INDEX_PATH ? t("sync.menu") : typeof state.doc?.json.name === "string" ? state.doc.json.name : state.path;
  const run = (action: (s: FileSync) => Promise<void>) => () => {
    setError(null);
    action(state).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  return (
    <li className={styles.change}>
      <div className={styles.changeText}>
        <span className={styles.changeName}>{state.doc ? <Link to={editorUrl(state.doc.id)}>{name}</Link> : name}</span>
        <span className={styles.changePath}>{state.path}</span>
        {state.status === "conflict" && <span className={styles.note}>{t("sync.conflictHint")}</span>}
        {error && <span className={modalStyles.error}>{error}</span>}
      </div>
      <SyncBadge status={state.status} />
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
function PushDialog({ mode, states, onClose }: { mode: "push" | "restore"; states: FileSync[]; onClose: () => void }) {
  const { t } = useTranslation();
  const session = usePodSession();
  const setMenu = useWorkspace((s) => s.setMenu);
  const [phase, setPhase] = useState<Phase>({ kind: "plan" });
  const [deselected, setDeselected] = useState<ReadonlySet<string>>(new Set());
  const [pin, setPin] = useState("");
  const askPin = needsPin(session);

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
            <button className={`${modalStyles.button} ${modalStyles.primary}`} disabled={blocked} onClick={() => void start()}>
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
          {mode === "restore" && <p>{t("sync.restoreText")}</p>}
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
                  {s.path === INDEX_PATH ? t("sync.menu") : s.path}
                </label>
              ))}
            </fieldset>
          )}
          <p>
            <strong>{plan.uploads.length === 0 ? t("sync.nothing") : t("sync.planCount", { count: plan.uploads.length })}</strong>
          </p>
          <ul className={styles.plan}>
            {plan.uploads.map((u) => (
              <li key={u.path}>
                <span className={styles.changePath}>{u.path}</span> <span className={styles.reason}>{t(`sync.reason.${u.reason}`)}</span>
              </li>
            ))}
          </ul>
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
        <p className={styles.progress} aria-live="polite">
          <Loader size={18} aria-hidden className={styles.spin} />
          {phase.step
            ? t(phase.step.phase === "upload" ? "sync.uploading" : "sync.checking", { path: phase.step.path, done: phase.step.done + 1, total: phase.step.total })
            : t("sync.starting")}
        </p>
      )}
      {phase.kind === "done" && <PushDone result={phase.result} />}
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

function PushDone({ result }: { result: PushResult }) {
  const { t } = useTranslation();
  return (
    <>
      {result.stopped ? (
        <p className={modalStyles.error}>{t("sync.stopped")}</p>
      ) : (
        <p className={styles.clean}>
          <CircleCheck size={16} aria-hidden /> {t("sync.done", { count: result.uploaded.length })}
        </p>
      )}
      {result.podIssues.length > 0 && <PodIssues issues={result.podIssues} />}
      {!result.stopped && <p className={styles.note}>{t("sync.spreadHint")}</p>}
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
