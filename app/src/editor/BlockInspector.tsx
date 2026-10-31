import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Copy, Flag, Plus, Trash2 } from "lucide-react";
import { Sheet } from "../components/Sheet";
import { BLOCK_TYPES, blockType, SET_OPS, type FieldDef } from "@reactpod/program-model";
import type { Block } from "@reactpod/program-model";
import { blockCategory, blockIcon } from "./blockStyle";
import type { Step } from "./structure";
import { teamColors } from "./toggleStep";
import { ColorField, LedsField, SuggestField, ValueField } from "./fields";
import { EditableField, NameListField, editableValue, nameItems } from "./ListFields";
import { changeBlockType, deleteBlock, duplicateBlock, isValidBlockName, renameBlock, setBlockField, setProgramField, type ProgramJson } from "./ops";
import styles from "./Inspector.module.css";

export const NEW_BLOCK = "\u0000new";

export type InspectorContext = {
  json: ProgramJson;
  /** every block name (own and included), in column order */
  names: readonly string[];
  variables: readonly string[];
  metrics: readonly string[];
  /** own blocks that presets point to → file of the preset */
  lockedBy: ReadonlyMap<string, string>;
  isProgram: boolean;
  apply: (json: ProgramJson, options?: { mergeKey?: string; select?: string | null }) => void;
  select: (name: string | null) => void;
  /** "new block…" in a port select: opens the palette, the new block is connected to this port */
  addConnected: (from: string, port: string) => void;
  /** opens the palette to insert a block after this one */
  addAfter: (name: string) => void;
  /** deletes a block (the editor offers undo); default: deleteBlock without asking */
  remove?: (name: string) => void;
  /** step list (simple view): move the step within its list */
  step?: { canUp: boolean; canDown: boolean; move: (direction: "up" | "down") => void };
  /** duplicates a step right after it (step sheet) */
  duplicate?: (name: string) => void;
  /** program format of the connected pod (missing: unknown, everything is offered); the effect step and countdown need 3 */
  programFormat?: number;
  /** step list of the flat program (exit picker); missing: computed from `json` */
  steps?: readonly Step[];
  /** every block of the program and its includes, by name (exit picker) */
  blocks?: ReadonlyMap<string, Block>;
};

/** Editable block: name, type, parameters, connections, actions. */
export function BlockInspector({ block, ctx }: { block: Block; ctx: InspectorContext }) {
  const { t } = useTranslation();
  const def = blockType(block.type);
  const Icon = blockIcon(block.type);
  const locked = ctx.lockedBy.get(block.name);
  const isStart = ctx.isProgram && ctx.json.start === block.name;
  const remove = () => (ctx.remove ? ctx.remove(block.name) : ctx.apply(deleteBlock(ctx.json, block.name), { select: null }));

  return (
    <Sheet
      title={block.name}
      icon={<Icon size={18} aria-hidden />}
      category={blockCategory(block.type)}
      sub={
        <>
          {t(`blocks.${block.type}.name`, { defaultValue: block.type })}
          {isStart && (
            <>
              {" · "}
              <Flag size={12} aria-hidden /> {t("graph.start")}
            </>
          )}
        </>
      }
      onClose={() => ctx.select(null)}
    >
      {ctx.step && (
        <div className={styles.stepActions}>
          <button className={styles.action} disabled={!ctx.step.canUp} onClick={() => ctx.step!.move("up")}>
            <ArrowUp size={18} aria-hidden /> {t("editor.step.moveUp")}
          </button>
          <button className={styles.action} disabled={!ctx.step.canDown} onClick={() => ctx.step!.move("down")}>
            <ArrowDown size={18} aria-hidden /> {t("editor.step.moveDown")}
          </button>
          <button className={styles.action} data-danger disabled={!!locked} onClick={() => remove()} aria-label={t("editor.step.deleteStep")} title={t("editor.step.deleteStep")}>
            <Trash2 size={18} aria-hidden />
          </button>
        </div>
      )}
      <BlockExpertFields block={block} ctx={ctx} />

      <div className={styles.actions}>
        {def?.ports[0] === "next" && (
          <button className={styles.action} onClick={() => ctx.addAfter(block.name)}>
            <Plus size={18} aria-hidden /> {t("editor.addAfterAction")}
          </button>
        )}
        {ctx.isProgram && !isStart && (
          <button className={styles.action} onClick={() => ctx.apply(setProgramField(ctx.json, "start", block.name))}>
            <Flag size={18} aria-hidden /> {t("editor.setStart")}
          </button>
        )}
        <button
          className={styles.action}
          onClick={() => {
            const { doc, name } = duplicateBlock(ctx.json, block.name, new Set(ctx.names));
            ctx.apply(doc, { select: name });
          }}
        >
          <Copy size={18} aria-hidden /> {t("editor.duplicate")}
        </button>
        <button className={styles.action} data-danger disabled={!!locked} onClick={remove}>
          <Trash2 size={18} aria-hidden /> {t("editor.delete")}
        </button>
      </div>
      {locked && <p className={styles.muted}>{t("editor.lockedBy", { file: locked })}</p>}
    </Sheet>
  );
}

/**
 * Today's inspector fields: block name, type, one "go to" select per port and every parameter
 * with its raw key. The step sheet shows them in expert mode.
 */
export function BlockExpertFields({ block, ctx }: { block: Block; ctx: InspectorContext }) {
  const { t } = useTranslation();
  const def = blockType(block.type);
  const locked = ctx.lockedBy.get(block.name);
  const set = (field: string, value: unknown, merge = true) =>
    ctx.apply(setBlockField(ctx.json, block.name, field, value), merge ? { mergeKey: `${block.name}.${field}` } : undefined);
  return (
    <>
      <NameField block={block} ctx={ctx} locked={locked} />
      <div className={styles.field}>
        <label className={styles.label} htmlFor="block-type">
          {t("editor.type")}
        </label>
        <select id="block-type" className={styles.input} value={block.type} onChange={(e) => ctx.apply(changeBlockType(ctx.json, block.name, e.target.value))}>
          {!def && <option value={block.type}>{block.type}</option>}
          {BLOCK_TYPES.map((d) => (
            <option key={d.type} value={d.type}>
              {t(`blocks.${d.type}.name`)}
            </option>
          ))}
        </select>
        {def && <p className={styles.fieldHelp}>{t(`blocks.${def.type}.help`)}</p>}
      </div>

      {def && (
        <section className={styles.group}>
          <h4>{t("editor.connections")}</h4>
          {def.ports.map((port) => (
            <PortRow key={port} port={port} block={block} ctx={ctx} hasNext={def.ports[0] === "next"} />
          ))}
        </section>
      )}

      {def && (
        <section className={styles.group}>
          <h4>{t("editor.parameters")}</h4>
          {def.fields.map((field) => (
            <FieldRow key={field.name} field={field} block={block} ctx={ctx} onChange={(v, merge) => set(field.name, v, merge)} />
          ))}
        </section>
      )}

    </>
  );
}

function NameField({ block, ctx, locked }: { block: Block; ctx: InspectorContext; locked?: string }) {
  const { t } = useTranslation();
  const [name, setName] = useState(block.name);
  useEffect(() => setName(block.name), [block.name]);
  const error =
    name === block.name ? null : !isValidBlockName(name) ? t("editor.nameInvalid") : ctx.names.includes(name) ? t("editor.nameTaken") : null;
  const commit = () => {
    if (name !== block.name && !error) ctx.apply(renameBlock(ctx.json, block.name, name), { select: name });
    else setName(block.name);
  };
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor="block-name">
        {t("editor.blockName")}
      </label>
      <input
        id="block-name"
        className={styles.input}
        value={name}
        disabled={!!locked}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={!!error}
        onChange={(e) => setName(e.target.value.replace(/\s/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

function FieldRow({ field, block, ctx, onChange }: { field: FieldDef; block: Block; ctx: InspectorContext; onChange: (value: unknown, merge?: boolean) => void }) {
  const { t } = useTranslation();
  const value = block[field.name];
  const label = t(`fields.${field.name}.label`, { defaultValue: field.name });
  const placeholder = field.default !== undefined ? t("fields.defaultIs", { value: String(field.default) }) : field.required ? undefined : t("fields.notSet");
  let input: React.ReactNode;
  switch (field.kind) {
    case "value":
      input = <ValueField value={value} onChange={onChange} variables={ctx.variables} placeholder={placeholder} label={label} />;
      break;
    case "color":
    case "remoteColor":
      input = (
        <ColorField
          value={value}
          onChange={(v) => onChange(v, false)}
          custom={field.kind === "color"}
          optional={!field.required}
          defaultValue={field.default}
          label={label}
        />
      );
      break;
    case "leds":
      input = <LedsField value={value} color={block.color} onChange={(v) => onChange(v)} label={label} />;
      break;
    case "enum":
      input = (
        <select className={styles.input} value={typeof value === "string" ? value : ""} aria-label={label} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value, false)}>
          {!field.required && <option value="">{placeholder}</option>}
          {typeof value === "string" && !field.options?.includes(value) && <option value={value}>{value}</option>}
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {field.options === SET_OPS ? t(`ops.${o}`, { defaultValue: o }) : o}
            </option>
          ))}
        </select>
      );
      break;
    case "bool": {
      const checked = typeof value === "boolean" ? value : field.default === true;
      input = (
        <label className={styles.switch}>
          <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked === field.default ? undefined : e.target.checked, false)} />
          <span>{checked ? t("fields.yes") : t("fields.no")}</span>
        </label>
      );
      break;
    }
    case "colorPair": {
      // toggle `colors`: the colours of team A and B
      const pair = teamColors(block);
      input = (
        <>
          {([0, 1] as const).map((i) => (
            <ColorField key={i} value={pair[i]} hide={["off"]} label={`${label} ${i === 0 ? "A" : "B"}`} onChange={(c) => onChange(pair.map((p, j) => (j === i ? (c ?? p) : p)), false)} />
          ))}
        </>
      );
      break;
    }
    case "metricList":
      // communicate `metrics`: none listed = all metrics
      input = <NameListField items={nameItems(value)} choices={[]} label={label} placeholder={t("list.metricPlaceholder")} onChange={(v) => onChange(v, false)} />;
      break;
    case "variableList":
      input = <NameListField items={nameItems(value)} choices={ctx.variables} label={label} placeholder={placeholder ?? ""} onChange={(v) => onChange(v, false)} />;
      break;
    case "editableMap":
      input = <EditableField value={editableValue(value)} choices={ctx.variables} label={label} onChange={(v) => onChange(v, false)} />;
      break;
    case "variable":
      input = <SuggestField value={value} onChange={onChange} suggestions={ctx.variables} placeholder={placeholder} label={label} />;
      break;
    case "metric":
      input = <SuggestField value={value} onChange={onChange} suggestions={ctx.metrics} placeholder={placeholder ?? "reaction"} label={label} />;
      break;
  }
  const help = t(`fields.${field.name}.help`, { defaultValue: "" });
  return (
    <div className={styles.field}>
      <span className={styles.label}>
        {label}
        <code className={styles.fieldName}>{field.name}</code>
        {field.required && <span className={styles.required}>{t("fields.required")}</span>}
      </span>
      {input}
      {help && <p className={styles.fieldHelp}>{help}</p>}
    </div>
  );
}

export function PortRow({ port, block, ctx, hasNext }: { port: string; block: Block; ctx: InspectorContext; hasNext: boolean }) {
  const { t } = useTranslation();
  const target = typeof block[port] === "string" ? (block[port] as string) : "";
  // the toggle block's allA / allB do not fall back to next: the game goes on (programs.md §7.15)
  const fallsBack = hasNext && port !== "next" && typeof block.next === "string" && block.type !== "toggle";
  return (
    <div className={styles.portRow}>
      <span className={styles.port}>{t(`ports.${port}`)}</span>
      <select
        className={styles.input}
        value={target}
        aria-label={t("editor.goTo", { port: t(`ports.${port}`) })}
        onChange={(e) => {
          if (e.target.value === NEW_BLOCK) ctx.addConnected(block.name, port);
          else ctx.apply(setBlockField(ctx.json, block.name, port, e.target.value || undefined));
        }}
      >
        <option value="">{fallsBack ? t("editor.portFallback") : port === "next" || !hasNext ? t("editor.portEnd") : t("editor.portNone")}</option>
        {target && !ctx.names.includes(target) && <option value={target}>{target}</option>}
        {ctx.names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
        <option value={NEW_BLOCK}>{t("editor.newBlock")}</option>
      </select>
    </div>
  );
}
