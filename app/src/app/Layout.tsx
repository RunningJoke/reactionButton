import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Settings } from "lucide-react";
import { backOf, NAV_ITEMS, SUBPAGES } from "./navigation";
import { ConnectionChip } from "./ConnectionChip";
import { ConnectDialog } from "./ConnectDialog";
import { UpdatePrompt } from "./UpdatePrompt";
import { useWorkspace } from "../store/workspace";
import { useResults } from "../results/results";
import { useAutoUpload } from "../platform/useAutoUpload";
import { useDeletionQueue } from "../platform/useDeletionQueue";
import styles from "./Layout.module.css";

export function Layout() {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const sub = SUBPAGES[pathname];
  const titleKey = sub?.titleKey ?? NAV_ITEMS.find((item) => pathname.startsWith(item.path))?.labelKey;
  const load = useWorkspace((s) => s.load);
  useEffect(() => void load(), [load]);
  useResults((s) => s.sessions); // the back target of a session depends on it
  const loadResults = useResults((s) => s.load);
  useEffect(() => void loadResults(), [loadResults]);
  useAutoUpload();
  useDeletionQueue();

  return (
    <div className={styles.shell}>
      <nav className={styles.rail} aria-label={t("nav.main")}>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.path} to={item.path} className={styles.navItem}>
            <item.icon size={22} aria-hidden />
            <span>{t(item.labelKey)}</span>
          </NavLink>
        ))}
      </nav>

      <header className={styles.header}>
        {sub && (
          <Link to={backOf(sub, search)} className={styles.backButton} aria-label={t("nav.back")}>
            <ArrowLeft size={22} aria-hidden />
          </Link>
        )}
        <h1 className={styles.title}>{titleKey ? t(titleKey) : t("app.title")}</h1>
        <ConnectionChip compact={Boolean(sub)} />
        <NavLink to="/settings" className={styles.headerButton} aria-label={t("nav.settings")}>
          <Settings size={22} aria-hidden />
        </NavLink>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>

      <nav className={styles.tabbar} aria-label={t("nav.main")}>
        {NAV_ITEMS.filter((item) => item.primary).map((item) => (
          <NavLink key={item.path} to={item.path} className={styles.navItem}>
            <item.icon size={22} aria-hidden />
            <span>{t(item.labelKey)}</span>
          </NavLink>
        ))}
      </nav>

      <ConnectDialog />
      <UpdatePrompt />
    </div>
  );
}
