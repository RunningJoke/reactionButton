import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { PlatformError } from "../platform/api";
import { platformClient, usePlatformSettings } from "../platform/settings";
import page from "./Page.module.css";

/** Target of the sign-in link in the platform mail (`#/login?token=…`, platform spec §3.1). */
export function LoginPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const baseUrl = usePlatformSettings((s) => s.baseUrl);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !baseUrl) return;
    let live = true;
    platformClient({ baseUrl, token: "" })
      .verifyLogin({ token })
      .then((res) => {
        usePlatformSettings.getState().update({ token: res.accessToken, tokenExpiresAt: res.expiresAt, email: res.user.email });
        if (live) navigate("/settings#platform", { replace: true });
      })
      .catch((e: unknown) => live && setError(e instanceof PlatformError ? t("platform.error", { code: e.code, detail: e.message }) : String(e)));
    return () => {
      live = false;
    };
  }, [token, baseUrl, navigate, t]);

  return (
    <div className={page.page}>
      <section className={page.section}>
        <h2>{t("platform.title")}</h2>
        <p className={page.muted}>{!token ? t("platform.linkInvalid") : !baseUrl ? t("platform.noServer") : (error ?? t("platform.signingIn"))}</p>
        <Link to="/settings#platform">{t("results.platformSettings")}</Link>
      </section>
    </div>
  );
}
