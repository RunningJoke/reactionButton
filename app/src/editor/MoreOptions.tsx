/**
 * "More options" of the step sheet: the few fields no behaviour claims (colour per state, brightness, LEDs,
 * cooldown, ...; at most 3 per block, editor-ux.md §5). `MoreField` also draws the raw fields inside a Sprinkle.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal } from "lucide-react";
import { blockType, fieldLevel, type Block, type FieldDef } from "@reactpod/program-model";
import { SwitchRow } from "../wizard/controls";
import { COUNTDOWN_FIELDS } from "./countdown";
import { ColorField, LedsField, SuggestField, ValueField } from "./fields";
import { chargeMode, releaseMode, setChargeMode } from "./holdStep";
import { EditableField, NameListField, editableValue, nameItems } from "./ListFields";
import { fieldWords, TimeValue, type FieldProps } from "./sheetParts";
import { settingLabel } from "./settingLabels";
import { MAX_COOLDOWN_MS, TOGGLE_RESULTS } from "./toggleStep";
import inspector from "./Inspector.module.css";
import styles from "./StepSheet.module.css";

/** The fields "More options" lists for this block now (level "more", right mode, not drawn elsewhere). */
export function moreFieldsOf(block: Block): FieldDef[] {
  // colour shift asks for its second colour above; only blink, spin, fill and drain have a background
  const mode = block.type === "release" ? releaseMode(block) : block.type === "charge" ? chargeMode(block) : undefined;
  const own: readonly string[] = [
    ...COUNTDOWN_FIELDS,
    ...(block.type === "toggle" ? TOGGLE_RESULTS.map((r) => r[0]) : []),
    ...(block.type === "charge" ? ["color2"] : []),
    ...(block.type === "effect" && !["blink", "spin", "fill", "drain"].includes(String(block.effect)) ? ["color2"] : []),
  ];
  return (blockType(block.type)?.fields ?? []).filter((f) => fieldLevel(f) === "more" && !own.includes(f.name) && (f.onlyMode === undefined || f.onlyMode === mode));
}

export function MoreOptions({ block, doc, set, apply, variables, metrics }: FieldProps & { variables: readonly string[]; metrics: readonly string[] }) {
  const { t } = useTranslation();
  const fields = moreFieldsOf(block);
  if (fields.length === 0) return null;
  const used = fields.some((f) => block[f.name] !== undefined);
  return (
    <details className={styles.more} open={used || undefined}>
      <summary>
        <SlidersHorizontal size={18} aria-hidden /> {t("editor.step.moreOptions")}
      </summary>
      <div className={styles.moreBody}>
        {fields.map((f) => (
          <MoreField key={f.name} field={f} block={block} doc={doc} set={set} apply={apply} variables={variables} metrics={metrics} />
        ))}
      </div>
    </details>
  );
}

export function MoreField({ field, block, doc, set, apply, variables, metrics }: FieldProps & { field: FieldDef; variables: readonly string[]; metrics: readonly string[] }) {
  const { t } = useTranslation();
  const label = fieldWords(field.name, t);
  const help = t(`editor.step.help.${field.name}`, { defaultValue: "" });
  const value = block[field.name];
  let input: ReactNode;
  switch (field.kind) {
    case "value":
      input = /Ms$/.test(field.name) ? (
        <TimeValue label={label} value={value ?? field.default ?? 0} doc={doc} apply={apply} onField={(ms) => set(field.name, ms)} {...(field.name === "cooldownMs" ? { step: 100, max: MAX_COOLDOWN_MS } : {})} />
      ) : (
        <ValueField value={value} variables={variables} labelOf={(v) => settingLabel(v, t).label} label={label} placeholder={t("fields.notSet")} onChange={(v) => set(field.name, v)} />
      );
      break;
    case "color":
    case "remoteColor":
      input = <ColorField value={value} optional defaultValue={field.default} custom={field.kind === "color"} label={label} onChange={(c) => set(field.name, c, false)} />;
      break;
    case "leds":
      input = <LedsField value={value} color={block.color} label={label} onChange={(v) => set(field.name, v)} />;
      break;
    case "bool": {
      // allowHeld: on for a trigger, off for a signal
      const dflt = field.name === "allowHeld" ? releaseMode(block) === "trigger" : field.default === true;
      const checked = typeof value === "boolean" ? value : dflt;
      return <SwitchRow label={label} hint={help || undefined} checked={checked} onChange={(v) => set(field.name, v === dflt ? undefined : v, false)} />;
    }
    case "enum": {
      const current = typeof value === "string" ? value : String(field.default ?? "");
      input = (
        <div className={styles.chips}>
          {(field.options ?? []).map((o) => (
            <button
              key={o}
              type="button"
              className={inspector.chip}
              aria-pressed={current === o}
              onClick={() => (field.name === "mode" && block.type === "charge" ? apply(setChargeMode(doc, block.name, o as never)) : set(field.name, o === field.default ? undefined : o, false))}
            >
              {t(`editor.step.enum.${field.name}.${o}`, { defaultValue: o })}
            </button>
          ))}
        </div>
      );
      break;
    }
    case "variable":
      input = <SuggestField value={value} suggestions={variables} placeholder={t("editor.step.notKept")} label={label} onChange={(v) => set(field.name, v)} />;
      break;
    case "metric":
      input = <SuggestField value={value} suggestions={metrics} placeholder={t("fields.notSet")} label={label} onChange={(v) => set(field.name, v)} />;
      break;
    case "metricList":
      input = <NameListField items={nameItems(value)} choices={[]} label={label} placeholder={t("list.metricPlaceholder")} onChange={(v) => set(field.name, v)} />;
      break;
    case "variableList":
      input = <NameListField items={nameItems(value)} choices={variables} label={label} placeholder="" onChange={(v) => set(field.name, v)} />;
      break;
    case "editableMap":
      input = <EditableField value={editableValue(value)} choices={variables} label={label} onChange={(v) => set(field.name, v)} />;
      break;
    default:
      return null;
  }
  return (
    <div className={styles.field}>
      {!(field.kind === "value" && /Ms$/.test(field.name)) && <span className={styles.label}>{label}</span>}
      {input}
      {help && <p className={styles.hint}>{help}</p>}
    </div>
  );
}
