import { colorToRgb } from "../model/colors";
import { LED_COUNT } from "../model/limits";
import type { MenuGroup } from "../model/program";

type Props = {
  /** LED colours by index; missing = off */
  colors?: readonly unknown[];
  /** alternative input: menu groups of a program */
  groups?: readonly MenuGroup[];
  size?: number;
  label?: string;
};

/**
 * The pod's 18-LED ring. Assumption to check on hardware: LED 0 at the top, indices clockwise
 * (seen from above).
 */
export function LedRing({ colors, groups, size = 40, label }: Props) {
  const leds: unknown[] = colors ? [...colors] : new Array(LED_COUNT).fill(undefined);
  for (const group of groups ?? []) {
    for (const led of Array.isArray(group.leds) ? group.leds : []) {
      if (Number.isInteger(led) && led >= 0 && led < LED_COUNT) leds[led] = group.color;
    }
  }
  const r = 40;
  const dot = size < 60 ? 7.5 : 6.5;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={label} className="led-ring">
      <circle cx="50" cy="50" r="48" fill="var(--surface-2)" />
      <circle cx="50" cy="50" r="22" fill="var(--surface)" stroke="var(--border)" />
      {Array.from({ length: LED_COUNT }, (_, i) => {
        const a = (i / LED_COUNT) * Math.PI * 2 - Math.PI / 2;
        const rgb = leds[i] === undefined ? null : colorToRgb(leds[i]);
        const lit = rgb !== null && (rgb[0] > 0 || rgb[1] > 0 || rgb[2] > 0);
        return (
          <circle
            key={i}
            cx={50 + Math.cos(a) * r}
            cy={50 + Math.sin(a) * r}
            r={dot / 2 + (lit ? 0.6 : 0)}
            fill={lit ? `rgb(${rgb!.join(",")})` : "var(--led-off)"}
            stroke={lit ? "rgb(0 0 0 / 0.25)" : "none"}
            strokeWidth={0.6}
          />
        );
      })}
    </svg>
  );
}
