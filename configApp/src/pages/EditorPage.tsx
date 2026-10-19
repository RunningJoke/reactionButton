import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CircleAlert, CircleCheck, Copy, Download, Lock, MoreVertical, Plus, Redo2, Settings2, Trash2, Undo2, Users, Workflow } from "lucide-react";
import { Modal, modalStyles } from "../components/Modal";
import { Sheet } from "../components/Sheet";
import { BlockDetailsSheet, IssueList } from "../editor/BlockDetails";
import { BlockInspector, type InspectorContext } from "../editor/BlockInspector";
import { columnLayout } from "../editor/columnLayout";
import { lastOpenedProgram, useEditor } from "../editor/editorStore";
import { addBlock, deleteBlock, flattenIncludes, insertTemplate, namesUsedByIncludes, setBlockField, type ProgramJson } from "../editor/ops";
import { Palette } from "../editor/Palette";
import { ProgramColumnView } from "../editor/ProgramColumnView";
import { ProgramSettings } from "../editor/ProgramSettings";
import { DEFAULT_FILES } from "../defaults";
import { blockType } from "../model/blockTypes";
import { formatProgram } from "../model/format";
import { buildGraph } from "../model/graph";
import { isLibraryPath } from "../model/limits";
import { BUILTIN_VARIABLES, isObject } from "../model/program";
import { validateProgram } from "../model/validate";
import { DeleteProgramModal, downloadProgram, NewProgramModal } from "../programs/actions";
import { useProgramSource } from "../programs/sources";
import { usePodSession } from "../pod/session";
import type { ProgramDoc } from "../store/programStore";
import { useWorkspace } from "../store/workspace";
import page from "./Page.module.css";
import styles from "./EditorPage.module.css";

export function EditorPage() {
  const [params] = useSearchParams();
  const loaded = useWorkspace((s) => s.loaded);
  const programs = useWorkspace((s) => s.programs);
  const open = useEditor((s) => s.open);
  const current = useEditor((s) => s.doc);
  const id = params.get("id") ?? current?.id ?? lastOpenedProgram();
  const stored = programs.find((p) => p.id === id);

  useEffect(() => {
    if (stored) open(stored);
  }, [stored, open]);

  if (!loaded) return null;
  if (!stored) return <NoProgram />;
  if (current?.id !== stored.id) return null;
  return <ProgramEditor doc={current} />;
}

function NoProgram() {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  return (
    <div className={page.page}>
      <div className={page.empty}>
        <Workflow size={40} aria-hidden className={page.emptyIcon} />
        <p>
          <strong>{t("editor.noProgram")}</strong>
          <br />
          {t("editor.noProgramHint")}
        </p>
        <div className={page.actions}>
          <button className={`${page.bigButton} ${page.primary}`} onClick={() => setCreating(true)}>
            <Plus size={20} aria-hidden /> {t("programs.new")}
          </button>
          <Link to="/programs" className={page.bigButton}>
            {t("editor.openProgram")}
          </Link>
        </div>
      </div>
      <NewProgramModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

type Panel = "palette" | "settings" | "issues" | null;

function ProgramEditor({ doc }: { doc: ProgramDoc }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { apply, undo, redo, select, selected, past, future } = useEditor();
  const source = useProgramSource("local");
  const podFiles = usePodSession((s) => (s.state === "connected" ? s.files : null));
  const [panel, setPanel] = useState<Panel>(null);
  const [pending, setPending] = useState<{ from: string; port: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState<ProgramDoc | null>(null);
  const json = doc.json;

  const model = useMemo(() => {
    const text = formatProgram(json);
    const read = (p: string) => (p === doc.path ? text : source.read(p));
    const resolved = validateProgram(doc.path, read, { supportedTypes: source.supportedTypes });
    const graph = buildGraph(resolved);
    const order = columnLayout(graph).order;
    const defined = new Set(graph.nodes.filter((n) => !n.external).map((n) => n.id));
    const names = order.filter((n) => defined.has(n));
    const written = new Set<string>();
    const metrics = new Set<string>(["reaction"]);
    for (const { block } of resolved.blocks) {
      if (!isObject(block)) continue;
      for (const field of blockType(block.type)?.fields ?? []) {
        const v = block[field.name];
        if (typeof v !== "string") continue;
        if (field.kind === "variable") written.add(v);
        if (field.kind === "metric") metrics.add(v);
      }
    }
    const variables = [...new Set([...Object.keys(resolved.variables), ...written, ...BUILTIN_VARIABLES])];
    const library = [...new Set([...Object.keys(DEFAULT_FILES), ...Object.keys(podFiles ?? {})])].filter(isLibraryPath).sort();
    return { resolved, graph, names, variables, metrics: [...metrics], lockedBy: namesUsedByIncludes(resolved), size: new Blob([text]).size, library, read };
  }, [json, doc.path, source, podFiles]);

  const { resolved, graph } = model;
  const errors = resolved.issues.filter((i) => i.severity === "error").length;
  const warnings = resolved.issues.length - errors;
  const selectedNode = graph.nodes.find((n) => n.id === selected) ?? null;
  const taken = useMemo(() => new Set(model.names), [model.names]);

  const ctx: InspectorContext = {
    json,
    names: model.names,
    variables: model.variables,
    metrics: model.metrics,
    lockedBy: model.lockedBy,
    isProgram: true,
    apply,
    select: (name) => {
      select(name);
      setPanel(null);
    },
    addAfter: (name) => {
      select(name);
      setPending(null);
      setPanel("palette");
    },
    addConnected: (from, port) => {
      setPending({ from, port });
      setPanel("palette");
    },
  };

  const pick = (type: string) => {
    let next: ProgramJson;
    let name: string;
    if (pending) {
      ({ doc: next, name } = addBlock(json, type, taken, null));
      next = setBlockField(next, pending.from, pending.port, name);
    } else {
      const after = selectedNode?.own && !selectedNode.external ? selectedNode.id : null;
      ({ doc: next, name } = addBlock(json, type, taken, after));
    }
    apply(next, { select: name });
    setPending(null);
    setPanel(null);
  };

  const template = (path: string) => {
    const text = model.read(path);
    if (!text) return;
    const { doc: next, names } = insertTemplate(json, JSON.parse(text) as ProgramJson, taken);
    apply(next, { select: names[0] ?? null });
    setPanel(null);
  };

  // desktop shortcuts: undo / redo, Delete removes the selected block
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "Delete" && selectedNode?.own && !selectedNode.external && !model.lockedBy.has(selectedNode.id)) {
        apply(deleteBlock(json, selectedNode.id), { select: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, apply, json, selectedNode, model.lockedBy]);

  const name = typeof json.name === "string" && json.name ? json.name : t("editor.untitled");
  const ownBlock = selectedNode?.own && !selectedNode.external ? (json.blocks as ProgramJson[] | undefined)?.find((b) => b.name === selectedNode.id) : undefined;

  return (
    <div className={styles.editor}>
      <div className={styles.bar}>
        <button className={styles.title} onClick={() => setPanel(panel === "settings" ? null : "settings")} aria-label={t("editor.settings")}>
          <h2>{name}</h2>
          <span className={styles.sub}>
            <Users size={13} aria-hidden /> {t("programs.pods", { count: Number(json.peripherals ?? 0) + 1 })} · {t("programs.blocks", { count: resolved.blocks.length })} ·{" "}
            <code>{doc.path}</code>
          </span>
        </button>
        <button className={styles.icon} onClick={undo} disabled={past.length === 0} aria-label={t("editor.undo")} title={t("editor.undo")}>
          <Undo2 size={20} aria-hidden />
        </button>
        <button className={styles.icon} onClick={redo} disabled={future.length === 0} aria-label={t("editor.redo")} title={t("editor.redo")}>
          <Redo2 size={20} aria-hidden />
        </button>
        <button
          className={styles.icon}
          data-level={errors ? "error" : warnings ? "warn" : "ok"}
          onClick={() => setPanel(panel === "issues" ? null : "issues")}
          aria-pressed={panel === "issues"}
          aria-label={errors ? t("programs.errors", { count: errors }) : warnings ? t("programs.warnings", { count: warnings }) : t("programs.valid")}
          title={errors ? t("programs.errors", { count: errors }) : warnings ? t("programs.warnings", { count: warnings }) : t("programs.valid")}
        >
          {errors ? <CircleAlert size={20} aria-hidden /> : warnings ? <AlertTriangle size={20} aria-hidden /> : <CircleCheck size={20} aria-hidden />}
          {resolved.issues.length > 0 && <span className={styles.count}>{resolved.issues.length}</span>}
        </button>
        <button className={styles.icon} onClick={() => setMenuOpen(true)} aria-label={t("editor.more")} title={t("editor.more")}>
          <MoreVertical size={20} aria-hidden />
        </button>
      </div>

      <div className={styles.graph}>
        {graph.nodes.length === 0 ? (
          <div className={page.empty}>
            <p>{t("editor.emptyProgram")}</p>
          </div>
        ) : (
          <ProgramColumnView graph={graph} selected={panel ? null : selected} onSelect={ctx.select} />
        )}

        <button
          className={styles.fab}
          onClick={() => {
            setPending(null);
            setPanel("palette");
          }}
          aria-label={t("editor.addBlock")}
          title={t("editor.addBlock")}
        >
          <Plus size={26} aria-hidden />
        </button>

        {panel === "palette" && (
          <Palette
            context={pending ? `${pending.from} · ${t(`ports.${pending.port}`)} →` : (selectedNode?.own && !selectedNode.external ? t("editor.addAfter", { name: selectedNode.id }) : null)}
            templates={model.library}
            supportedTypes={source.supportedTypes}
            onPick={pick}
            onTemplate={template}
            onClose={() => {
              setPending(null);
              setPanel(null);
            }}
          />
        )}
        {panel === "settings" && (
          <ProgramSettings
            json={json}
            path={doc.path}
            names={model.names}
            library={model.library}
            apply={apply}
            onFlatten={() => apply(flattenIncludes(json, resolved))}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "issues" && (
          <Sheet title={t("editor.check")} sub={t("editor.size", { size: model.size, max: 16384 })} onClose={() => setPanel(null)}>
            <IssueList issues={resolved.issues} onSelect={ctx.select} />
          </Sheet>
        )}
        {!panel && ownBlock && <BlockInspector key={ownBlock.name as string} block={ownBlock as never} ctx={ctx} />}
        {!panel && selectedNode && !ownBlock && (
          <BlockDetailsSheet node={selectedNode} known={taken} onSelect={ctx.select}>
            {!selectedNode.external && (
              <p className={styles.locked}>
                <Lock size={14} aria-hidden /> {t("editor.presetBlock", { file: selectedNode.file })}
              </p>
            )}
          </BlockDetailsSheet>
        )}
      </div>

      <Modal open={menuOpen} title={name} onClose={() => setMenuOpen(false)}>
        <div className={styles.menu}>
          <button onClick={() => (setMenuOpen(false), setPanel("settings"))}>
            <Settings2 size={18} aria-hidden /> {t("editor.settings")}
          </button>
          <button onClick={() => (setMenuOpen(false), setDuplicating(true))}>
            <Copy size={18} aria-hidden /> {t("programs.duplicate")}
          </button>
          <button onClick={() => (setMenuOpen(false), downloadProgram(doc))}>
            <Download size={18} aria-hidden /> {t("programs.export")}
          </button>
          <button data-danger onClick={() => (setMenuOpen(false), setDeleting(doc))}>
            <Trash2 size={18} aria-hidden /> {t("programs.delete")}
          </button>
        </div>
        <div className={modalStyles.actions}>
          <button className={modalStyles.button} onClick={() => setMenuOpen(false)}>
            {t("view.close")}
          </button>
        </div>
      </Modal>
      <NewProgramModal open={duplicating} from={doc} onClose={() => setDuplicating(false)} />
      <DeleteProgramModal
        doc={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          useEditor.getState().close();
          navigate("/programs");
        }}
      />
    </div>
  );
}
