import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { CloudUpload, LogIn, LogOut, Mail } from "lucide-react";
import { PlatformError, type Org } from "../platform/api";
import { canUpload, isSignedIn, platformClient, usePlatformSettings } from "../platform/settings";
import { uploadNow, useUploadQueue } from "../platform/upload";
import { sessionUploadStatus, useResults, type SessionUploadStatus } from "../results/results";
import page from "./Page.module.css";
import styles from "./Results.module.css";

/** Settings → Platform (preview): server, sign-in by mail code or pasted token, club, upload queue (#48). */
export function PlatformSettings() {
  const { t } = useTranslation();
  const settings = usePlatformSettings();
  const { hash } = useLocation();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (hash === "#platform") ref.current?.scrollIntoView?.({ block: "start" });
  }, [hash]);

  return (
    <section className={page.section} id="platform" ref={ref}>
      <h2>{t("platform.title")}</h2>
      <p className={styles.muted}>{t("platform.intro")}</p>
      <label className={styles.field}>
        {t("platform.server")}
        <input
          className={styles.input}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://api.example.org"
          value={settings.baseUrl}
          onChange={(e) => settings.update({ baseUrl: e.target.value.trim() })}
        />
      </label>
      {settings.baseUrl && (isSignedIn(settings) ? <SignedIn /> : <SignIn />)}
    </section>
  );
}

function describe(t: (key: string, o?: Record<string, unknown>) => string, e: unknown): string {
  if (e instanceof PlatformError) return e.status === 0 ? t("platform.offline") : t("platform.error", { code: e.code, detail: e.message });
  return e instanceof Error ? e.message : String(e);
}

function SignIn() {
  const { t, i18n } = useTranslation();
  const settings = usePlatformSettings();
  const [email, setEmail] = useState(settings.email ?? "");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(describe(t, e));
    } finally {
      setBusy(false);
    }
  };
  const sendCode = () =>
    run(async () => {
      await platformClient(settings).requestLogin(email.trim(), i18n.language.startsWith("de") ? "de" : "en");
      setSent(true);
    });
  const verify = () =>
    run(async () => {
      const res = await platformClient(settings).verifyLogin({ email: email.trim(), code });
      settings.update({ token: res.accessToken, tokenExpiresAt: res.expiresAt, email: res.user.email });
    });
  const useToken = () =>
    run(async () => {
      const value = token.trim();
      const me = await platformClient({ baseUrl: settings.baseUrl, token: value }).me();
      settings.update({ token: value, email: me.email, tokenExpiresAt: undefined });
    });

  return (
    <>
      <label className={styles.field}>
        {t("platform.email")}
        <input className={styles.input} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <div className={styles.row}>
        <button className={styles.button} disabled={busy || !email.includes("@")} onClick={() => void sendCode()}>
          <Mail size={18} aria-hidden /> {sent ? t("platform.sendAgain") : t("platform.sendCode")}
        </button>
      </div>
      {sent && (
        <>
          <p className={styles.muted}>{t("platform.codeSent")}</p>
          <label className={styles.field}>
            {t("platform.code")}
            <input
              className={styles.input}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <div className={styles.row}>
            <button className={`${styles.button} ${styles.primary}`} disabled={busy || code.length !== 6} onClick={() => void verify()}>
              <LogIn size={18} aria-hidden /> {t("platform.signIn")}
            </button>
          </div>
        </>
      )}
      <details className={page.details}>
        <summary>{t("platform.pasteToken")}</summary>
        <label className={styles.field}>
          {t("platform.token")}
          <input className={styles.input} autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        <div className={styles.row}>
          <button className={styles.button} disabled={busy || token.trim() === ""} onClick={() => void useToken()}>
            {t("platform.useToken")}
          </button>
        </div>
      </details>
      {error && (
        <p className={styles.status} data-tone="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

const QUEUE_STATES: SessionUploadStatus[] = ["pending", "failed", "notLinked", "noAthlete", "uploaded"];

function SignedIn() {
  const { t, i18n } = useTranslation();
  const settings = usePlatformSettings();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { athletes, sessions, reports } = useResults();
  const { running, last } = useUploadQueue();

  useEffect(() => {
    let live = true;
    platformClient(settings)
      .listOrgs()
      .then((r) => live && setOrgs(r.orgs))
      .catch((e: unknown) => {
        if (!live) return;
        setOrgs([]);
        if (e instanceof PlatformError && e.status === 401) settings.update({ token: "" });
        else setError(describe(t, e));
      });
    return () => {
      live = false;
    };
    // read again after another sign-in only
  }, [settings.baseUrl, settings.token]);

  const counts = new Map<SessionUploadStatus, number>();
  for (const s of sessions) {
    const status = sessionUploadStatus(s, athletes, reports);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const upload = async () => {
    setError(null);
    const summary = await uploadNow({ client: platformClient(settings), orgId: settings.orgId! });
    if (summary?.unauthorized) settings.update({ token: "" });
  };

  return (
    <>
      <div className={styles.title}>
        <p className={`${styles.muted} ${styles.grow}`}>{t("platform.signedInAs", { email: settings.email ?? "?" })}</p>
        <button className={styles.button} onClick={settings.signOut}>
          <LogOut size={18} aria-hidden /> {t("platform.signOut")}
        </button>
      </div>
      <label className={styles.field}>
        {t("platform.club")}
        <select
          className={styles.select}
          value={settings.orgId ?? ""}
          onChange={(e) => {
            const org = orgs?.find((o) => o.id === e.target.value);
            settings.update({ orgId: org?.id, orgName: org?.name });
          }}
        >
          <option value="">{orgs === null ? t("platform.loading") : t("platform.chooseClub")}</option>
          {settings.orgId && !orgs?.some((o) => o.id === settings.orgId) && <option value={settings.orgId}>{settings.orgName ?? settings.orgId}</option>}
          {orgs?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.kind === "personal" ? t("platform.personal") : o.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.check}>
        <input type="checkbox" checked={settings.autoUpload} onChange={(e) => settings.update({ autoUpload: e.target.checked })} />
        <span>{t("platform.autoUpload")}</span>
      </label>
      <ul className={`${styles.meta} ${styles.plain}`} aria-label={t("platform.queue")}>
        {QUEUE_STATES.filter((s) => counts.get(s)).map((s) => (
          <li key={s}>
            {t(`results.upload.${s}`)}: {counts.get(s)}
          </li>
        ))}
      </ul>
      <div className={styles.row}>
        <button className={`${styles.button} ${styles.primary}`} disabled={running || !canUpload(settings)} onClick={() => void upload()}>
          <CloudUpload size={18} aria-hidden /> {running ? t("platform.uploading") : t("platform.uploadNow")}
        </button>
      </div>
      {last && (
        <p className={styles.status} data-tone={last.failed ? "error" : "ok"} role="status">
          {last.failed
            ? t("platform.lastFailed", { count: last.failed, code: last.error ?? "" })
            : last.sessions === 0
              ? t("platform.nothing")
              : t("platform.lastOk", { count: last.sessions, time: new Intl.DateTimeFormat(i18n.language, { timeStyle: "short" }).format(last.at) })}
        </p>
      )}
      {error && (
        <p className={styles.status} data-tone="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
