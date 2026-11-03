import { useTranslation } from "react-i18next";
import { labelOf } from "../editor/settingLabels";
import { useExpertModeStore } from "../editor/expertMode";

/** A variable or metric in words; expert mode adds the raw name as secondary text. */
export function Named({ name }: { name: string }) {
  const { t } = useTranslation();
  const expert = useExpertModeStore((s) => s.on);
  const label = labelOf(name, t);
  return (
    <>
      {label}
      {expert && label !== name && <small style={{ color: "var(--text-muted)" }}> ({name})</small>}
    </>
  );
}
