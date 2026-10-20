import { colorToRgb } from "@reactpod/program-model";
import { LED_COUNT } from "@reactpod/program-model";
import type { MenuGroup } from "@reactpod/program-model";

type Props = {
  /** LED colours by index; missing = off */
  colors?: readonly unknown[];
  /** alternative input: menu groups of a program */
  groups?: readonly MenuGroup[];
  size?: number;
  label?: string;
  /** text inside the cap (pod name, pod count); leave out on small rings */
  title?: string;
  /** second line inside the cap (state) */
  subtitle?: string;
  /** cap pushed down (simulated press) */
  pressed?: boolean;
};

/**
 * The pod as a raised puck (DESIGN.md, "pod"): one cap with a drop edge, the 18 LEDs as light
 * segments on the cap rim, optional text inside the cap. Assumption to check on hardware: LED 0 at
 * the top, indices clockwise (seen from above).
 */
export function LedRing({ colors, groups, size = 40, label, title, subtitle, pressed }: Props) {
  const leds: unknown[] = colors ? [...colors] : new Array(LED_COUNT).fill(undefined);
  for (const group of groups ?? []) {
    for (const led of Array.isArray(group.leds) ? group.leds : []) {
      if (Number.isInteger(led) && led >= 0 && led < LED_COUNT) leds[led] = group.color;
    }
  }
  // small rings get bigger segments so the pattern stays readable
  const small = size < 72;
  const segW = small ? 11 : 9;
  const segH = small ? 6 : 4.6;
  const drop = pressed ? 1.5 : 5;
  const lift = pressed ? 3.5 : 0;
  return (
    <svg
      viewBox="0 0 100 106"
      width={size}
      height={(size * 106) / 100}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="led-ring"
    >
      <circle cx="50" cy={50 + drop} r="48" fill="var(--pod-edge)" />
      <g transform={`translate(0 ${lift})`}>
        <circle cx="50" cy="50" r="48" fill="var(--pod-base)" />
        <circle cx="50" cy="50" r="44.5" fill="var(--pod-cap)" />
        <path d="M16.7 22A43.5 43.5 0 0 1 83.3 22" fill="none" stroke="rgb(255 255 255 / 0.16)" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M16.7 78A43.5 43.5 0 0 0 83.3 78" fill="none" stroke="rgb(0 0 0 / 0.28)" strokeWidth="3" strokeLinecap="round" />
        {Array.from({ length: LED_COUNT }, (_, i) => {
          const rgb = leds[i] === undefined ? null : colorToRgb(leds[i]);
          const lit = rgb !== null && (rgb[0] > 0 || rgb[1] > 0 || rgb[2] > 0);
          const fill = lit ? `rgb(${rgb!.join(",")})` : "var(--led-off)";
          return (
            <g key={i} transform={`rotate(${(i * 360) / LED_COUNT} 50 50)`}>
              {lit && <rect x={50 - segW / 2 - 2} y={11 - segH / 2 - 2} width={segW + 4} height={segH + 4} rx={(segH + 4) / 2} fill={fill} opacity="0.35" />}
              <rect x={50 - segW / 2} y={11 - segH / 2} width={segW} height={segH} rx={segH / 2} fill={fill} />
            </g>
          );
        })}
        {title && (
          <text
            x="50"
            y={subtitle ? 49 : small ? 60 : 55}
            textAnchor="middle"
            fill="var(--pod-ink)"
            fontFamily="var(--font-display)"
            fontWeight="700"
            fontSize={small ? 30 : title.length > 9 ? 13 : 16}
          >
            {title}
          </text>
        )}
        {title && subtitle && !small && (
          <text x="50" y="62" textAnchor="middle" fill="var(--pod-ink-muted)" fontFamily="var(--font)" fontWeight="600" fontSize="8.5">
            {subtitle}
          </text>
        )}
      </g>
    </svg>
  );
}
