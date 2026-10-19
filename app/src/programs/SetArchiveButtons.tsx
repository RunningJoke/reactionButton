/** Export / import of a whole set as .zip (docs/app/spec.md §6), on the Programs tab. */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileArchive, PackageOpen } from "lucide-react";
import { Modal, modalStyles } from "../components/Modal";
import { setLabel, usePodSession } from "../pod/session";
import { useWorkspace } from "../store/workspace";
import { collectSet, unzipSet, zipSet, type ImportedSet } from "./setArchive";
import { useLocalMenu, useProgramSource } from "./sources";

type Props = { className?: string; errorClassName?: string };

export function SetArchiveButtons({ className, errorClassName }: Props) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const { menu } = useLocalMenu();
  const local = useProgramSource("local");
  const { programs, save, add, setMenu } = useWorkspace();
  const name = usePodSession((s) => setLabel(s));
  const [pending, setPending] = useState<{ file: string; set: ImportedSet } | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const exportSet = () => {
    const files = collectSet(menu, programs.map((p) => p.path), local.read);
    const blob = new Blob([zipSet(files) as BlobPart], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(name ?? "reactpod-set").replace(/[^\p{L}\p{N}_-]+/gu, "-").toLowerCase()}.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const apply = async () => {
    if (!pending) return;
    const { set } = pending;
    for (const program of set.programs) {
      const existing = programs.find((p) => p.path === program.path);
      if (existing) await save({ ...existing, json: program.json });
      else await add(program.json, "local", { path: program.path });
    }
    if (set.menu) await setMenu(set.menu);
    setPending(null);
    setMessage({ error: false, text: t("programs.importSetDone", { count: set.programs.length }) });
  };

  const replaced = pending ? pending.set.programs.filter((p) => programs.some((d) => d.path === p.path)).length : 0;

  return (
    <>
      <button className={className} onClick={exportSet}>
        <FileArchive size={16} aria-hidden /> {t("programs.exportSet")}
      </button>
      <button className={className} onClick={() => input.current?.click()}>
        <PackageOpen size={16} aria-hidden /> {t("programs.importSet")}
      </button>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            setPending({ file: file.name, set: unzipSet(new Uint8Array(await file.arrayBuffer())) });
            setMessage(null);
          } catch {
            setMessage({ error: true, text: t("programs.importSetFailed", { file: file.name }) });
          }
        }}
      />
      {message && (
        <p className={errorClassName} role={message.error ? "alert" : "status"} data-ok={!message.error || undefined}>
          {message.text}
        </p>
      )}
      <Modal
        open={pending !== null}
        title={t("programs.importSetTitle")}
        onClose={() => setPending(null)}
        actions={
          <>
            <button className={modalStyles.button} onClick={() => setPending(null)}>
              {t("common.cancel")}
            </button>
            <button className={`${modalStyles.button} ${modalStyles.primary}`} onClick={() => void apply()}>
              {t("programs.importSet")}
            </button>
          </>
        }
      >
        {pending && (
          <>
            <p>{t("programs.importSetText", { file: pending.file, count: pending.set.programs.length })}</p>
            <ul>
              {pending.set.programs.map((p) => (
                <li key={p.path}>
                  {String(p.json.name)} <code>{p.path}</code>
                </li>
              ))}
            </ul>
            {pending.set.menu && <p>{t("programs.importSetMenu", { count: pending.set.menu.length })}</p>}
            {replaced > 0 && <p className={modalStyles.error}>{t("programs.importSetReplaces", { count: replaced })}</p>}
            {pending.set.ignored.length > 0 && <p>{t("programs.importSetIgnored", { files: pending.set.ignored.join(", ") })}</p>}
          </>
        )}
      </Modal>
    </>
  );
}
