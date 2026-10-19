import { useTranslation } from "react-i18next";
import { colorToRgb } from "../model/colors";
import { LED_COUNT } from "../model/limits";
import "./ledRingPicker.css";

type Props = {
  /** colour per LED index; undefined = not selected */
  colors: readonly unknown[];
  onToggle: (index: number) => void;
  size?: number;
  label: string;
};

/**
 * Tappable 18-LED ring (same geometry as LedRing: LED 0 at the top, clockwise). Each LED is a
 * checkbox, so the picker also works with a keyboard and a screen reader.
 */
export function LedRingPicker({ colors, onToggle, size = 240, label }: Props) {
  const { t } = useTranslation();
  const r = 40;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="group" aria-label={label} className="led-picker">
      <circle cx="50" cy="50" r="49" fill="var(--surface-2)" />
      <circle cx="50" cy="50" r="27" fill="var(--surface)" stroke="var(--border)" />
      {Array.from({ length: LED_COUNT }, (_, i) => {
        const a = (i / LED_COUNT) * Math.PI * 2 - Math.PI / 2;
        const x = 50 + Math.cos(a) * r;
        const y = 50 + Math.sin(a) * r;
        const on = colors[i] !== undefined;
        const rgb = on ? colorToRgb(colors[i]) : null;
        const dark = rgb !== null && rgb[0] + rgb[1] + rgb[2] === 0;
        return (
          <g
            key={i}
            role="checkbox"
            aria-checked={on}
            aria-label={t("picker.led", { n: i })}
            tabIndex={0}
            className="led-picker-led"
            onClick={() => onToggle(i)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onToggle(i);
              }
            }}
          >
            {/* larger invisible hit area */}
            <circle cx={x} cy={y} r={7.5} fill="transparent" />
            <circle
              cx={x}
              cy={y}
              r={on ? 5.2 : 4.2}
              fill={on && !dark ? `rgb(${rgb!.join(",")})` : "var(--led-off)"}
              stroke={on ? "var(--text)" : "none"}
              strokeWidth={on ? (dark ? 1.4 : 0.8) : 0}
            />
            <text x={50 + Math.cos(a) * 31.5} y={50 + Math.sin(a) * 31.5 + 1.4} className="led-picker-index">
              {i}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
