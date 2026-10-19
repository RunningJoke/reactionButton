/** Program actions shared by the Programs page, the program view, the editor and the menu. */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Modal, modalStyles } from "../components/Modal";
import { DEFAULT_FILES } from "../defaults";
import { formatProgram } from "../model/format";
import { newProgram } from "../editor/ops";
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

/** Asks for a name and creates an empty program (or a copy of `from`). */
export function NewProgramModal({ open, onClose, from }: { open: boolean; onClose: () => void; from?: ProgramDoc }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const add = useWorkspace((s) => s.add);
  const taken = useTakenPaths();
  const [name, setName] = useState("");
  const trimmed = name.trim();

  const create = async () => {
    if (!trimmed) return;
    const json = from ? { ...structuredClone(from.json), name: trimmed } : newProgram(trimmed);
    const doc = await add(json, "local", { taken });
    setName("");
    onClose();
    navigate(editorUrl(doc.id));
  };

  return (
    <Modal
      open={open}
      title={from ? t("programs.duplicateTitle") : t("programs.newTitle")}
      onClose={onClose}
      actions={
        <>
          <button className={modalStyles.button} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className={`${modalStyles.button} ${modalStyles.primary}`} disabled={!trimmed} onClick={() => void create()}>
            {from ? t("programs.duplicate") : t("programs.create")}
          </button>
        </>
      }
    >
      <label htmlFor="new-program-name">{t("editor.programName")}</label>
      <input
        id="new-program-name"
        className={modalStyles.input}
        value={name}
        placeholder={from ? t("programs.copyOf", { name: String(from.json.name) }) : t("programs.namePlaceholder")}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void create()}
      />
    </Modal>
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
