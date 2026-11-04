/** The game page (docs/app/spec.md §3): one game, three modes – About, Edit, Try. */
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Copy, Download, MoreVertical, Pencil, Trash2, Settings2 } from "lucide-react";
import { Split, useDesktop } from "../components/Split";
import { Modal, modalStyles } from "../components/Modal";
import { useEditor } from "../editor/editorStore";
import { isLibraryPath, isObject, resolveProgram, validateProgram } from "@reactpod/program-model";
import { buildGraph } from "../model/graph";
import { DeleteProgramModal, downloadProgram, NewProgramModal, useEditCopy } from "../programs/actions";
import { fileName } from "../programs/catalog";
import { podsNeeded } from "../programs/requirements";
import { GAME_MODES, useProgramSource, validateOptionsOf, type GameMode, type SourceId } from "../programs/sources";
import { useWorkspace } from "../store/workspace";
import { EditorPage } from "./EditorPage";
import { GameAbout } from "./GameAbout";
import { SimulatePage } from "./SimulatePage";
import styles from "./Game.module.css";


/** The game of the query: `?id=` (mine) or `?source=&path=`; undefined when none is named. */
function useGameRef(): { source: SourceId; path: string; id?: string } | null | undefined {
  const [params] = useSearchParams();
  const programs = useWorkspace((s) => s.programs);
  const loaded = useWorkspace((s) => s.loaded);
  const id = params.get("id");
  const source = params.get("source");
  const path = params.get("path");
  if (id) {
    if (!loaded) return undefined;
    const doc = programs.find((p) => p.id === id);
    return doc ? { source: "local", path: doc.path, id } : null;
  }
  if (!path || !(source === "pod" || source === "shipped" || source === "local")) return null;
  if (source === "local") {
    if (!loaded) return undefined;
    const doc = programs.find((p) => p.path === path);
    return doc ? { source, path, id: doc.id } : null;
  }
  return { source, path };
}

/** Typing in the editor does not restart the side simulator on every key. */
const RESTART_MS = 400;

export function GamePage() {
  const ref = useGameRef();
  if (ref === undefined) return null;
  // no game named (an old link without a path, or my game was deleted): the list
  if (ref === null) return <Navigate to="/games" replace />;
  return <Game key={`${ref.source}:${ref.path}`} game={ref} />;
}

function Game({ game }: { game: { source: SourceId; path: string; id?: string } }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { source: sourceId, path, id } = game;
  const asked = params.get("mode");
  const mode: GameMode = GAME_MODES.includes(asked as GameMode) ? (asked as GameMode) : "about";
  const source = useProgramSource(sourceId);
  const doc = useWorkspace((s) => s.programs.find((p) => p.id === id));
  const live = useEditor((s) => (id && s.doc?.id === id ? s.doc : null));
  const editCopy = useEditCopy();
  const localCopy = useWorkspace((s) => s.programs.some((p) => p.path === path));
  const [menu, setMenu] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const mine = doc !== undefined;
  const desktop = useDesktop();

  const view = useMemo(() => {
    const text = source.read(path);
    if (text === undefined) return null;
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // shown as an issue
    }
    const isProgram = isObject(json) && typeof json.name === "string" && !isLibraryPath(path);
    const resolved = isProgram ? validateProgram(path, source.read, validateOptionsOf(source)) : resolveProgram(path, source.read);
    return { resolved, isProgram, graph: buildGraph(resolved), text };
  }, [path, source]);

  if (!view) {
    return (
      <div className={styles.empty}>
        <p>{source.available ? t("view.notFound", { path }) : t("view.notConnected")}</p>
      </div>
    );
  }
  const { resolved, isProgram } = view;
  const json = live?.json ?? resolved.doc ?? {};
  const name = isProgram ? String(json.name) : fileName(path);
  const peripherals = Number(json.peripherals ?? 0);
  const origin = mine ? t("game.origin.mine") : sourceId === "pod" ? t("game.origin.pod") : t("game.origin.shipped");
  const setMode = (next: GameMode) => {
    const query = new URLSearchParams(params);
    query.set("mode", next);
    if (next !== "edit") query.delete("panel");
    setParams(query, { replace: true });
  };
  // the settings panel lives in Edit (undo / redo, same store); About only shows the summary
  const openSettings = () => setParams(new URLSearchParams({ ...Object.fromEntries(params), mode: "edit", panel: "settings" }), { replace: true });
  const makeCopy = () => void editCopy(path, source.read(path)!, sourceId === "pod" ? "pod" : "default");
  const copyLabel = localCopy ? t("view.openCopy") : t("game.makeCopy");
  const effective: GameMode = isProgram ? mode : "about";

  return (
    <div className={styles.game}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.name}>{name}</h2>
          <p className={styles.sub}>{isProgram ? `${podsNeeded(peripherals, t)} · ${origin}` : t("view.fragment")}</p>
        </div>
        {isProgram && (
          <button className={styles.more} onClick={() => setMenu(true)} aria-label={t("game.more")} title={t("game.more")} aria-haspopup="dialog">
            <MoreVertical size={22} aria-hidden />
          </button>
        )}
      </header>

      {isProgram && <ModeTabs mode={effective} onChange={setMode} />}

      <div className={styles.body} role={isProgram ? "tabpanel" : undefined} id="game-panel" aria-labelledby={isProgram ? `game-tab-${effective}` : undefined}>
        {effective === "about" && (
          <GameAbout
            sourceId={sourceId}
            path={path}
            json={json}
            isProgram={isProgram}
            resolved={resolved}
            graph={view.graph}
            mine={mine}
            copyLabel={copyLabel}
            onMode={setMode}
            onCopy={makeCopy}
            onSettings={openSettings}
          />
        )}
        {effective === "edit" &&
          (mine && id ? (
            desktop ? (
              // desktop: the step list and, beside it, the game running; it restarts a moment after an edit
              <Split className={styles.editSplit} side={<SimulatePage target={{ source: sourceId, path, id }} restartAfterMs={RESTART_MS} />} sideOnPhone={false}>
                <EditorPage id={id} />
              </Split>
            ) : (
              <EditorPage id={id} />
            )
          ) : (
            <div className={styles.readOnly}>
              <p>{t("game.readOnly")}</p>
              <button type="button" className={`${styles.button} ${styles.primary}`} onClick={makeCopy}>
                <Pencil size={18} aria-hidden /> {copyLabel}
              </button>
            </div>
          ))}
        {effective === "try" && <SimulatePage target={{ source: sourceId, path, id }} />}
      </div>

      <Modal open={menu} title={name} onClose={() => setMenu(false)}>
        <div className={styles.menu}>
          {mine && doc ? (
            <>
              <button onClick={() => (setMenu(false), openSettings())}>
                <Settings2 size={18} aria-hidden /> {t("game.settings")}
              </button>
              <button onClick={() => (setMenu(false), setDuplicating(true))}>
                <Copy size={18} aria-hidden /> {t("programs.duplicate")}
              </button>
              <button onClick={() => (setMenu(false), downloadProgram(doc))}>
                <Download size={18} aria-hidden /> {t("programs.export")}
              </button>
              <button data-danger onClick={() => (setMenu(false), setDeleting(true))}>
                <Trash2 size={18} aria-hidden /> {t("programs.delete")}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => (setMenu(false), makeCopy())}>
                <Pencil size={18} aria-hidden /> {copyLabel}
              </button>
            </>
          )}
        </div>
        <div className={modalStyles.actions}>
          <button className={modalStyles.button} onClick={() => setMenu(false)}>
            {t("view.close")}
          </button>
        </div>
      </Modal>
      {doc && <NewProgramModal open={duplicating} from={doc} onClose={() => setDuplicating(false)} />}
      <DeleteProgramModal
        doc={deleting ? (doc ?? null) : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => {
          useEditor.getState().close();
          navigate("/games");
        }}
      />
    </div>
  );
}

/** About · Edit · Try: a tablist (arrow keys move and select, Home / End jump). */
function ModeTabs({ mode, onChange }: { mode: GameMode; onChange: (mode: GameMode) => void }) {
  const { t } = useTranslation();
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent) => {
    const at = GAME_MODES.indexOf(mode);
    const next = e.key === "ArrowRight" ? (at + 1) % 3 : e.key === "ArrowLeft" ? (at + 2) % 3 : e.key === "Home" ? 0 : e.key === "End" ? 2 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(GAME_MODES[next]!);
    tabs.current[GAME_MODES[next]!]?.focus();
  };
  return (
    <div className={styles.tabs} role="tablist" aria-label={t("game.modes")} onKeyDown={onKey}>
      {GAME_MODES.map((m) => (
        <button
          key={m}
          ref={(el) => void (tabs.current[m] = el)}
          type="button"
          role="tab"
          id={`game-tab-${m}`}
          aria-selected={m === mode}
          aria-controls="game-panel"
          tabIndex={m === mode ? 0 : -1}
          className={styles.tab}
          onClick={() => onChange(m)}
        >
          {t(`game.mode.${m}`)}
        </button>
      ))}
    </div>
  );
}
