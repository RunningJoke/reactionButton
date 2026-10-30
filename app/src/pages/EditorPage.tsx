import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CircleAlert, CircleCheck, Copy, Download, Lock, MoreVertical, Play, Plus, Redo2, Settings2, Trash2, Undo2, Users, Workflow, Wrench } from "lucide-react";
import { Modal, modalStyles } from "../components/Modal";
import { Sheet } from "../components/Sheet";
import { BlockDetailsSheet, IssueList } from "../editor/BlockDetails";
import type { InspectorContext } from "../editor/BlockInspector";
import { columnLayout } from "../editor/columnLayout";
import { lastOpenedProgram, useEditor } from "../editor/editorStore";
import { addBlock, deleteBlock, deleteStep, duplicateStep, flattenIncludes, insertTemplate, moveStep, namesUsedByIncludes, setBlockField, type ProgramJson } from "../editor/ops";
import { useExpertMode } from "../editor/expertMode";
import { sentenceOptions } from "../editor/sentence";
import { settingLabel } from "../editor/settingLabels";
import { RoundSheet, StepSheet } from "../editor/StepSheet";
import { Palette } from "../editor/Palette";
import { AddStepSheet } from "../editor/AddStepSheet";
import { ProgramColumnView } from "../editor/ProgramColumnView";
import { ProgramSettings } from "../editor/ProgramSettings";
import { StepListView } from "../editor/StepListView";
import { flatProgram, stepList, type Step } from "../editor/structure";
import { UndoToast } from "../editor/UndoToast";
import { DEFAULT_FILES } from "../defaults";
import { blockType } from "@reactpod/program-model";
import { formatProgram } from "@reactpod/program-model";
import { buildGraph } from "../model/graph";
import { isLibraryPath } from "@reactpod/program-model";
import { BUILTIN_VARIABLES, isObject, type Block } from "@reactpod/program-model";
import { validateProgram } from "@reactpod/program-model";
import { DeleteProgramModal, downloadProgram, NewProgramModal } from "../programs/actions";
import { useProgramSource, validateOptionsOf } from "../programs/sources";
import { usePodSession } from "../pod/session";
import type { ProgramDoc } from "../store/programStore";
import { useWorkspace } from "../store/workspace";
import { simulateUrl } from "../programs/sources";
import page from "./Page.module.css";
import styles from "./EditorPage.module.css";

export function EditorPage() {
  const [params] = useSearchParams();
  const loaded = useWorkspace((s) => s.loaded);
  const programs = useWorkspace((s) => s.programs);
  const open = useEditor((s) => s.open);
  const select = useEditor((s) => s.select);
  const current = useEditor((s) => s.doc);
  const id = params.get("id") ?? current?.id ?? lastOpenedProgram();
  const block = params.get("block");
  const stored = programs.find((p) => p.id === id);
  const selectedFromUrl = useRef<string | null>(null);

  useEffect(() => {
    if (stored) open(stored);
  }, [stored, open]);

  // `&block=` (e.g. from a push error): select it once after the program is open
  useEffect(() => {
    const key = `${id}/${block}`;
    if (!block || current?.id !== id || selectedFromUrl.current === key) return;
    selectedFromUrl.current = key;
    select(block);
  }, [block, id, current?.id, select]);

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
/** simple view (step list), or today's block column in expert mode */
type View = "steps" | "blocks";

/** The step a new step goes after: the selected one, or the last step of the (first) round. */
function insertionPoint(steps: readonly Step[], selected: string | null, own: ReadonlySet<string>): { after: string | null; where: "selected" | "round" | "end"; number?: string } {
  const picked = steps.find((s) => s.block === selected && !s.loop);
  if (picked && own.has(picked.block)) return { after: picked.block, where: "selected", number: picked.number };
  const loop = steps.findIndex((s) => s.loop && !s.unreachable);
  if (loop >= 0) {
    const depth = steps[loop]!.depth + 1;
    let last: Step | undefined;
    for (let i = loop + 1; i < steps.length && steps[i]!.depth >= depth; i++) if (steps[i]!.depth === depth && !steps[i]!.loop) last = steps[i];
    if (last && own.has(last.block)) return { after: last.block, where: "round" };
  }
  const top = steps.filter((s) => s.depth === 0 && !s.loop && !s.unreachable).pop();
  return { after: top && own.has(top.block) ? top.block : null, where: "end" };
}

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
  const [expert, setExpert] = useExpertMode();
  const view: View = expert ? "blocks" : "steps";
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);
  const json = doc.json;

  const model = useMemo(() => {
    const text = formatProgram(json);
    const read = (p: string) => (p === doc.path ? text : source.read(p));
    const resolved = validateProgram(doc.path, read, validateOptionsOf(source));
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
    const blocks = resolved.blocks.filter((b) => isObject(b.block) && typeof b.block.name === "string").map((b) => b.block as Block);
    const flat = flatProgram(json, blocks, graph.start);
    const steps = stepList(flat);
    const blockMap = new Map(blocks.map((b) => [b.name, b]));
    const own = new Set(graph.nodes.filter((n) => n.own && !n.external).map((n) => n.id));
    const sentence = sentenceOptions(blocks, resolved.variables, (n) => settingLabel(n, t).label);
    return { sentence, resolved, graph, names, variables, metrics: [...metrics], lockedBy: namesUsedByIncludes(resolved), size: new Blob([text]).size, library, read, flat, steps, blockMap, own };
  }, [json, doc.path, source, podFiles, t]);

  const { resolved, graph } = model;
  const errors = resolved.issues.filter((i) => i.severity === "error").length;
  const warnings = resolved.issues.length - errors;
  const selectedNode = graph.nodes.find((n) => n.id === selected) ?? null;
  const taken = useMemo(() => new Set(model.names), [model.names]);

  const remove = (name: string) => {
    const next = view === "steps" ? deleteStep(json, name, model.flat) : deleteBlock(json, name);
    if (next === json) return;
    apply(next, { select: null });
    setToast({ text: t("editor.step.deleted"), at: useEditor.getState().past.length });
  };
  const move = (name: string, direction: "up" | "down") => moveStep(json, name, direction, model.flat);

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
    remove,
    programFormat: source.programFormat,
    steps: model.steps,
    blocks: model.blockMap,
    duplicate: (name) => {
      const { doc: next, name: copy } = duplicateStep(json, name, taken);
      apply(next, { select: copy });
    },
    step:
      selected
        ? {
            canUp: move(selected, "up") !== json,
            canDown: move(selected, "down") !== json,
            move: (direction) => apply(move(selected, direction), { select: selected }),
          }
        : undefined,
  };
  const insertAt = insertionPoint(model.steps, selected, model.own);

  /** expert: a new block of `type` on the port that asked for it ("new block…") */
  const pick = (type: string) => {
    if (!pending) return;
    const { doc: added, name } = addBlock(json, type, taken, null);
    apply(setBlockField(added, pending.from, pending.port, name), { select: name });
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
        remove(selectedNode.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const name = typeof json.name === "string" && json.name ? json.name : t("editor.untitled");
  // the Repeat bracket of the step list (its head may be a hidden block of the round)
  const bracket = view === "steps" ? model.steps.find((s) => s.loop && s.block === selected) : undefined;
  const ownBlock = selectedNode?.own && !selectedNode.external ? (json.blocks as ProgramJson[] | undefined)?.find((b) => b.name === selectedNode.id) : undefined;

  return (
    <div className={styles.editor}>
      <div className={styles.bar}>
        <button className={styles.title} onClick={() => setPanel(panel === "settings" ? null : "settings")} aria-label={t("editor.settings")}>
          <h2>{name}</h2>
          <span className={styles.sub}>
            <Users size={13} aria-hidden /> {t("programs.pods", { count: Number(json.peripherals ?? 0) + 1 })} ·{" "}
            {view === "steps" ? (
              t("editor.step.count", { count: model.steps.filter((s) => !s.loop).length })
            ) : (
              <>
                {t("programs.blocks", { count: resolved.blocks.length })} · <code>{doc.path}</code>
              </>
            )}
          </span>
        </button>
        <button className={styles.icon} onClick={undo} disabled={past.length === 0} aria-label={t("editor.undo")} title={t("editor.undo")}>
          <Undo2 size={20} aria-hidden />
        </button>
        <button className={styles.icon} onClick={redo} disabled={future.length === 0} aria-label={t("editor.redo")} title={t("editor.redo")}>
          <Redo2 size={20} aria-hidden />
        </button>
        <Link className={styles.icon} to={simulateUrl({ id: doc.id })} aria-label={t("simulate.open")} title={t("simulate.open")}>
          <Play size={20} aria-hidden />
        </Link>
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
            <p>{view === "steps" ? t("editor.step.empty") : t("editor.emptyProgram")}</p>
          </div>
        ) : view === "steps" ? (
          <StepListView
            steps={model.steps}
            blocks={model.blockMap}
            own={model.own}
            issues={resolved.issues}
            supportedTypes={source.supportedTypes}
            values={resolved.variables}
            selected={panel ? null : selected}
            onSelect={ctx.select}
          />
        ) : (
          <ProgramColumnView graph={graph} selected={panel ? null : selected} onSelect={ctx.select} />
        )}

        <button
          className={styles.fab}
          onClick={() => {
            setPending(null);
            setPanel("palette");
          }}
          aria-label={view === "steps" ? t("editor.step.addToRound") : t("editor.addBlock")}
          title={view === "steps" ? t("editor.step.addToRound") : t("editor.addBlock")}
        >
          <Plus size={26} aria-hidden />
        </button>

        {/* a step added from an exit ("a new step here…") is connected to that exit */}
        {panel === "palette" && (!pending || view === "steps") && (
          <AddStepSheet
            doc={json}
            after={pending?.from ?? (view === "steps" ? insertAt.after : selectedNode?.own && !selectedNode.external ? selectedNode.id : null) ?? undefined}
            connect={pending ?? undefined}
            supportedTypes={source.supportedTypes}
            programFormat={source.programFormat}
            taken={taken}
            library={{ paths: model.library, read: model.read }}
            onAdd={(next, focus) => {
              apply(next, { select: focus });
              setPending(null);
              setPanel(null);
            }}
            onClose={() => {
              setPending(null);
              setPanel(null);
            }}
          />
        )}
        {/* expert: "new block…" in a port select connects a block of the chosen type to that port */}
        {panel === "palette" && pending && view !== "steps" && (
          <Palette
            context={`${pending.from} · ${t(`ports.${pending.port}`)} →`}
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
        {!panel && bracket?.loop && (
          <RoundSheet
            key={bracket.block}
            loop={bracket.loop}
            blocks={model.blockMap}
            own={model.own}
            issues={resolved.issues.filter((i) => i.block !== undefined && bracket.loop!.hidden.includes(i.block))}
            expert={expert}
            ctx={ctx}
            onAddToRound={() => {
              select(null);
              setPanel("palette");
            }}
          />
        )}
        {!panel && !bracket && ownBlock && (
          <StepSheet
            key={ownBlock.name as string}
            block={ownBlock as never}
            step={model.steps.find((s) => s.block === ownBlock.name && !s.loop)}
            issues={resolved.issues.filter((i) => i.block === ownBlock.name)}
            sentence={model.sentence}
            expert={expert}
            ctx={ctx}
          />
        )}
        {toast && past.length === toast.at && <UndoToast text={toast.text} onUndo={undo} onClose={() => setToast(null)} />}
        {!panel && selectedNode && !ownBlock && !bracket && (
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
          <button onClick={() => (setMenuOpen(false), setExpert(!expert))} aria-pressed={expert}>
            <Wrench size={18} aria-hidden /> {t("editor.step.expertMode")}: {expert ? t("editor.step.on") : t("editor.step.off")}
          </button>
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
