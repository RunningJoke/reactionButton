/** Plain helpers of the LED step: the chosen colour in words and "All lights / Half / Quarter". */
import { useTranslation } from "react-i18next";
import { isColor, LED_COUNT, namedColor } from "@reactpod/program-model";
import inspector from "./Inspector.module.css";
import styles from "./StepSheet.module.css";

/** The chosen colour in words, next to the swatches ("Green"). */
export function ColorName({ value }: { value: unknown }) {
  const { t } = useTranslation();
  const named = namedColor(value);
  const text = named ? t(`colors.${named}`) : isColor(value) ? t("fields.customColor") : "";
  return text ? <p className={styles.colorName}>{text.charAt(0).toUpperCase() + text.slice(1)}</p> : null;
}

/**
 * "All lights / Half / Quarter". A quarter of 18 is 4.5, rounded up to 5; the lights start at the top of
 * the ring, like the ring picker.
 */
export const LED_PRESETS: readonly (readonly [string, readonly number[] | undefined])[] = [
  ["all", undefined],
  ["half", Array.from({ length: LED_COUNT / 2 }, (_, i) => i)],
  ["quarter", Array.from({ length: Math.ceil(LED_COUNT / 4) }, (_, i) => i)],
];

export function LedPresets({ value, onChange }: { value: unknown; onChange: (leds: number[] | undefined) => void }) {
  const { t } = useTranslation();
  const same = (leds: readonly number[] | undefined) => (leds === undefined ? !Array.isArray(value) : Array.isArray(value) && value.length === leds.length && leds.every((n, i) => value[i] === n));
  return (
    <div className={styles.chips} role="group" aria-label={t("editor.step.ledPreset.label")}>
      {LED_PRESETS.map(([key, leds]) => (
        <button key={key} type="button" className={inspector.chip} aria-pressed={same(leds)} onClick={() => onChange(leds && [...leds])}>
          {t(`editor.step.ledPreset.${key}`)}
        </button>
      ))}
    </div>
  );
}
