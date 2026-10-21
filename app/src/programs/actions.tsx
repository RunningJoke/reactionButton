/** Program actions shared by the Programs page, the program view, the editor and the menu. */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Modal, modalStyles } from "../components/Modal";
import { DEFAULT_FILES } from "../defaults";
import { formatProgram } from "@reactpod/program-model";
import { newProgram, type ProgramJson } from "../editor/ops";
import { Copy, FilePlus, Wand2 } from "lucide-react";
import type { MenuGroup } from "@reactpod/program-model";
import { LedRing } from "../components/LedRing";
import { WIZARD_PATH, useWizard } from "../wizard/wizardStore";
import wizard from "../wizard/Wizard.module.css";
import { buildCatalog } from "./catalog";
import { usePodSession } from "../pod/session";
import { rememberPodBase } from "../pod/syncActions";
import type { ProgramDoc } from "../store/programStore";
import { useWorkspace } from "../store/workspace";
import { editorUrl } from "./sources";

/** Paths a new program must not take: local, on the pod, shipped. */
export function useTakenPaths(): Set<string> {
  const programs = useWorkspace((s) => s.programs);
  const pod = usePodSession((s) => s.files);
  return useMemo(() => new Set([...programs.map((p) => p.path), ...Object.keys(pod), ...Object.keys(DEFAULT_FILES)]), [programs, pod]);
}

/** Local copy of a pod or shipped program with the same path (opens the existing one if there is one). */
export function useEditCopy() {
  const navigate = useNavigate();
  const add = useWorkspace((s) => s.add);
  const programs = useWorkspace((s) => s.programs);
  return async (path: string, text: string, origin: "pod" | "default") => {
    const existing = programs.find((p) => p.path === path);
    const doc = existing ?? (await add(JSON.parse(text) as Record<string, unknown>, origin, { path }));
    if (!existing && origin === "pod") await rememberPodBase(path);
    navigate(editorUrl(doc.id));
    return doc;
  };
}

/** Local copy of a program, made silently (e.g. when the menu pattern of a pod program changes). */
export async function ensureLocal(path: string, text: string | undefined, origin: "pod" | "default"): Promise<ProgramDoc | undefined> {
  const { programs, add } = useWorkspace.getState();
  const existing = programs.find((p) => p.path === path);
  if (existing) return existing;
  if (text === undefined) return undefined;
  const doc = await add(JSON.parse(text) as Record<string, unknown>, origin, { path });
  if (origin === "pod") await rememberPodBase(path);
  return doc;
}

export function downloadProgram(doc: ProgramDoc) {
  const blob = new Blob([formatProgram(doc.json)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = doc.path.split("/").pop()!;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type NewStage = { kind: "choose" } | { kind: "copy" } | { kind: "name"; from?: ProgramJson };

/**
 * "New program" (editor-ux.md §4 A). Without `from`: the chooser – start from a game
 * (the wizard), copy a program, or start empty. With `from`: asks for the name of a copy.
 */
export function NewProgramModal({ open, onClose, from }: { open: boolean; onClose: () => void; from?: ProgramDoc }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const add = useWorkspace((s) => s.add);
  const taken = useTakenPaths();
  const [stage, setStage] = useState<NewStage>({ kind: "choose" });
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const current: NewStage = from ? { kind: "name", from: from.json } : stage;
  const source = current.kind === "name" ? current.from : undefined;

  const close = () => {
    setStage({ kind: "choose" });
    setName("");
    onClose();
  };

  const create = async () => {
    if (!trimmed) return;
    const json = source ? { ...structuredClone(source), name: trimmed } : newProgram(trimmed);
    const doc = await add(json, "local", { taken });
    close();
    navigate(editorUrl(doc.id));
  };

  if (current.kind === "choose") {
    return (
      <Modal open={open} title={t("programs.newTitle")} onClose={close} actions={<button className={modalStyles.button} onClick={close}>{t("common.cancel")}</button>}>
        <NewProgramChooser
          onGame={() => {
            useWizard.getState().start();
            close();
            navigate(WIZARD_PATH);
          }}
          onCopy={() => setStage({ kind: "copy" })}
          onEmpty={() => setStage({ kind: "name" })}
        />
      </Modal>
    );
  }

  if (current.kind === "copy") {
    return (
      <Modal
        open={open}
        title={t("wizard.chooser.copyTitle")}
        onClose={close}
        actions={
          <button className={modalStyles.button} onClick={() => setStage({ kind: "choose" })}>
            {t("wizard.back")}
          </button>
        }
      >
        <CopyPicker
          onPick={(json) => {
            setName(t("programs.copyOf", { name: String(json.name) }));
            setStage({ kind: "name", from: json });
          }}
        />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={source ? t("programs.duplicateTitle") : t("programs.newTitle")}
      onClose={close}
      actions={
        <>
          <button className={modalStyles.button} onClick={() => (from ? close() : setStage({ kind: "choose" }))}>
            {from ? t("common.cancel") : t("wizard.back")}
          </button>
          <button className={`${modalStyles.button} ${modalStyles.primary}`} disabled={!trimmed} onClick={() => void create()}>
            {source ? t("programs.duplicate") : t("programs.create")}
          </button>
        </>
      }
    >
      <label htmlFor="new-program-name">{t("editor.programName")}</label>
      <input
        id="new-program-name"
        className={modalStyles.input}
        value={name}
        placeholder={source ? t("programs.copyOf", { name: String(source.name) }) : t("programs.namePlaceholder")}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void create()}
      />
    </Modal>
  );
}

/** The three ways to start a program. */
function NewProgramChooser({ onGame, onCopy, onEmpty }: { onGame: () => void; onCopy: () => void; onEmpty: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={wizard.chooser}>
      <p className={wizard.muted}>{t("wizard.chooser.question")}</p>
      <button type="button" className={wizard.choice} onClick={onGame}>
        <span className={wizard.choiceIcon}>
          <Wand2 size={26} aria-hidden />
        </span>
        <span className={wizard.choiceText}>
          <strong>{t("wizard.chooser.game")}</strong>
          <span>{t("wizard.chooser.gameLine")}</span>
          <span className={`${wizard.tag} ${wizard.tagAccent}`}>{t("wizard.chooser.recommended")}</span>
        </span>
      </button>
      <button type="button" className={wizard.choice} onClick={onCopy}>
        <span className={wizard.choiceIcon}>
          <Copy size={24} aria-hidden />
        </span>
        <span className={wizard.choiceText}>
          <strong>{t("wizard.chooser.copy")}</strong>
          <span>{t("wizard.chooser.copyLine")}</span>
        </span>
      </button>
      <button type="button" className={wizard.choice} onClick={onEmpty}>
        <span className={wizard.choiceIcon}>
          <FilePlus size={24} aria-hidden />
        </span>
        <span className={wizard.choiceText}>
          <strong>{t("wizard.chooser.empty")}</strong>
          <span>{t("wizard.chooser.emptyLine")}</span>
          <span className={wizard.tag}>{t("wizard.chooser.expert")}</span>
        </span>
      </button>
    </div>
  );
}

/** My programs first, then the shipped ones. */
function CopyPicker({ onPick }: { onPick: (json: ProgramJson) => void }) {
  const { t } = useTranslation();
  const programs = useWorkspace((s) => s.programs);
  const shipped = useMemo(
    () =>
      buildCatalog(Object.keys(DEFAULT_FILES), (p) => DEFAULT_FILES[p]).programs.flatMap((entry) => {
        const text = DEFAULT_FILES[entry.path];
        return text ? [{ entry, json: JSON.parse(text) as ProgramJson }] : [];
      }),
    [],
  );
  const row = (key: string, name: string, menu: MenuGroup[] | undefined, json: ProgramJson) => (
    <li key={key}>
      <button type="button" className={wizard.pick} onClick={() => onPick(json)}>
        <LedRing groups={menu ?? []} size={36} />
        <span>{name}</span>
      </button>
    </li>
  );
  return (
    <ul className={wizard.pickList}>
      <li className={wizard.pickGroup}>{t("programs.mine")}</li>
      {programs.length === 0 && (
        <li>
          <p className={wizard.muted}>{t("wizard.chooser.noneMine")}</p>
        </li>
      )}
      {programs.map((doc) => row(doc.id, String(doc.json.name), Array.isArray(doc.json.menu) ? (doc.json.menu as MenuGroup[]) : undefined, doc.json))}
      <li className={wizard.pickGroup}>{t("programs.shipped")}</li>
      {shipped.map(({ entry, json }) => row(entry.path, entry.name, entry.menu, json))}
    </ul>
  );
}

/** Confirmation before a program is deleted locally. */
export function DeleteProgramModal({ doc, onClose, onDeleted }: { doc: ProgramDoc | null; onClose: () => void; onDeleted: () => void }) {
  const { t } = useTranslation();
  const remove = useWorkspace((s) => s.remove);
  return (
    <Modal
      open={doc !== null}
      title={t("programs.deleteTitle")}
      onClose={onClose}
      actions={
        <>
          <button className={modalStyles.button} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            className={`${modalStyles.button} ${modalStyles.danger}`}
            onClick={() => {
              if (!doc) return;
              void remove(doc.id);
              onClose();
              onDeleted();
            }}
          >
            {t("editor.delete")}
          </button>
        </>
      }
    >
      <p>{doc && t("programs.deleteText", { name: String(doc.json.name), path: doc.path })}</p>
    </Modal>
  );
}
