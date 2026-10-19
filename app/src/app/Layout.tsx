import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import { NAV_ITEMS } from "./navigation";
import { ConnectionChip } from "./ConnectionChip";
import { ConnectDialog } from "./ConnectDialog";
import { UpdatePrompt } from "./UpdatePrompt";
import { useWorkspace } from "../store/workspace";
import styles from "./Layout.module.css";

export function Layout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const current = NAV_ITEMS.find((item) => pathname.startsWith(item.path));
  const load = useWorkspace((s) => s.load);
  useEffect(() => void load(), [load]);

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
        <h1 className={styles.title}>{current ? t(current.labelKey) : t("app.title")}</h1>
        <ConnectionChip />
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
