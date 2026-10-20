import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowDown, ArrowUp, ListOrdered, Plus, X } from "lucide-react";
import { LedRing } from "../components/LedRing";
import { Sheet } from "../components/Sheet";
import { DEFAULT_FILES } from "../defaults";
import { MenuPatternField } from "../editor/fields";
import { INDEX_PATH, isLibraryPath } from "@reactpod/program-model";
import { isProgramFile, type MenuGroup } from "@reactpod/program-model";
import { usePodSession } from "../pod/session";
import { ensureLocal } from "../programs/actions";
import { useLocalMenu, useProgramSource } from "../programs/sources";
import { useWorkspace } from "../store/workspace";
import styles from "./MenuPage.module.css";

type Origin = "local" | "pod" | "shipped" | "missing";

type Entry = { path: string; name: string; menu: MenuGroup[]; origin: Origin; text?: string };

/** Order of the programs in the pod's menu (/programs.json) and their LED patterns (docs/app/spec.md §5). */
export function MenuPage() {
  const { t } = useTranslation();
  const { menu, saved } = useLocalMenu();
  const setMenu = useWorkspace((s) => s.setMenu);
  const programs = useWorkspace((s) => s.programs);
  const local = useProgramSource("local");
  const connected = usePodSession((s) => s.state === "connected");
  const podFiles = usePodSession((s) => s.files);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const describe = useMemo(() => {
    const localPaths = new Set(programs.map((p) => p.path));
    return (path: string): Entry => {
      const text = local.read(path);
      const origin: Origin = localPaths.has(path) ? "local" : text === undefined ? "missing" : connected && podFiles[path] !== undefined ? "pod" : "shipped";
      let doc: unknown = null;
      try {
        doc = text === undefined ? null : JSON.parse(text);
      } catch {
        // shown as name = path
      }
      return {
        path,
        name: isProgramFile(doc) ? doc.name : path,
        menu: isProgramFile(doc) && Array.isArray(doc.menu) ? doc.menu : [],
        origin,
        text,
      };
    };
  }, [programs, local, connected, podFiles]);

  const entries = menu.map(describe);
  const patternOwner = new Map<string, string>();
  const sameAs = new Map<string, string>();
  for (const e of entries) {
    if (e.menu.length === 0) continue;
    const key = patternKey(e.menu);
    const other = patternOwner.get(key);
    if (other) sameAs.set(e.path, other);
    else patternOwner.set(key, e.name);
  }

  const candidates = useMemo(() => {
    const paths = new Set([...Object.keys(local.files), ...(connected ? Object.keys(podFiles) : []), ...Object.keys(DEFAULT_FILES)]);
    const inMenu = new Set(menu);
    return [...paths]
      .filter((p) => p !== INDEX_PATH && !isLibraryPath(p) && !inMenu.has(p))
      .map(describe)
      .filter((e) => e.name !== e.path)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [local.files, connected, podFiles, menu, describe]);

  const move = (from: number, to: number) => {
    const next = [...menu];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    void setMenu(next);
  };

  const editingEntry = editing ? describe(editing) : null;

  return (
    <div className={styles.menuPage}>
      <div className={styles.scroll}>
        <p className={styles.intro}>{t("menu.intro")}</p>
        {!saved && <p className={styles.note}>{connected ? t("menu.fromPod") : t("menu.fromShipped")}</p>}
        {entries.length === 0 ? (
          <p className={styles.note}>{t("pod.emptyMenu")}</p>
        ) : (
          <ol className={styles.list}>
            {entries.map((entry, i) => (
              <li key={entry.path} className={styles.row}>
                <span className={styles.index}>{i + 1}</span>
                <button
                  className={styles.ring}
                  disabled={entry.origin === "missing"}
                  onClick={() => setEditing(entry.path)}
                  aria-label={t("menu.editPattern", { name: entry.name })}
                  title={t("menu.editPattern", { name: entry.name })}
                >
                  <LedRing groups={entry.menu} size={44} label={t("programs.menuPattern")} />
                </button>
                <span className={styles.text}>
                  <span className={styles.name}>
                    {entry.name}
                    {entry.origin !== "missing" && <span className={styles.tag}>{t(`menu.origin.${entry.origin}`)}</span>}
                  </span>
                  <code className={styles.path}>{entry.path}</code>
                  {entry.origin === "missing" && (
                    <span className={styles.warn}>
                      <AlertTriangle size={13} aria-hidden /> {t("pod.missingFile")}
                    </span>
                  )}
                  {sameAs.has(entry.path) && (
                    <span className={styles.warn}>
                      <AlertTriangle size={13} aria-hidden /> {t("menu.samePattern", { name: sameAs.get(entry.path) })}
                    </span>
                  )}
                  {entry.menu.length === 0 && entry.origin !== "missing" && <span className={styles.warn}>{t("menu.noPattern")}</span>}
                </span>
                <span className={styles.buttons}>
                  <button disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={t("menu.up", { name: entry.name })}>
                    <ArrowUp size={18} aria-hidden />
                  </button>
                  <button disabled={i === entries.length - 1} onClick={() => move(i, i + 1)} aria-label={t("menu.down", { name: entry.name })}>
                    <ArrowDown size={18} aria-hidden />
                  </button>
                  <button onClick={() => void setMenu(menu.filter((p) => p !== entry.path))} aria-label={t("menu.remove", { name: entry.name })}>
                    <X size={18} aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <button className={styles.fab} onClick={() => setAdding(true)} aria-label={t("menu.add")} title={t("menu.add")}>
        <Plus size={26} aria-hidden />
      </button>

      {adding && (
        <Sheet title={t("menu.add")} icon={<ListOrdered size={18} aria-hidden />} onClose={() => setAdding(false)}>
          {candidates.length === 0 ? (
            <p className={styles.note}>{t("menu.nothingToAdd")}</p>
          ) : (
            <ul className={styles.candidates}>
              {candidates.map((c) => (
                <li key={c.path}>
                  <button
                    onClick={() => {
                      void setMenu([...menu, c.path]);
                      setAdding(false);
                    }}
                  >
                    <LedRing groups={c.menu} size={36} label={t("programs.menuPattern")} />
                    <span className={styles.text}>
                      <span className={styles.name}>
                        {c.name}
                        <span className={styles.tag}>{t(`menu.origin.${c.origin}`)}</span>
                      </span>
                      <code className={styles.path}>{c.path}</code>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}

      {editingEntry && (
        <Sheet title={editingEntry.name} sub={t("programs.menuPattern")} onClose={() => setEditing(null)}>
          {editingEntry.origin !== "local" && <p className={styles.note}>{t("menu.copyNote")}</p>}
          <MenuPatternField
            value={editingEntry.menu}
            onChange={async (groups) => {
              const doc = await ensureLocal(editingEntry.path, editingEntry.text, editingEntry.origin === "pod" ? "pod" : "default");
              if (!doc) return;
              await useWorkspace.getState().save({ ...doc, json: { ...doc.json, menu: groups } });
            }}
          />
        </Sheet>
      )}
    </div>
  );
}

/** Same LEDs in the same colours, regardless of the group order. */
function patternKey(groups: MenuGroup[]): string {
  const leds: string[] = [];
  for (const g of groups) for (const led of Array.isArray(g.leds) ? g.leds : []) leds[led] = JSON.stringify(g.color);
  return leds.map((c, i) => `${i}:${c ?? ""}`).join(",");
}
