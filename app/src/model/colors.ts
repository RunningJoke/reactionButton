/** Colours as the firmware understands them (src/Block/JsonUtil.cpp, docs/firmware/programs.md §2). */

/** Named colours. Only these can be sent to peripherals (the link transports 8 colours). */
export const NAMED_COLORS = ["off", "red", "green", "blue", "yellow", "magenta", "cyan", "white"] as const;
export type NamedColor = (typeof NAMED_COLORS)[number];

/** "black" is accepted by the firmware as an alias of "off". */
const COLOR_ALIASES: Record<string, NamedColor> = { black: "off" };

/** `"red"`, `"#FF8800"` or `[255, 136, 0]` */
export type Color = string | [number, number, number];

export function namedColor(value: unknown): NamedColor | null {
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();
  if ((NAMED_COLORS as readonly string[]).includes(lower)) return lower as NamedColor;
  return COLOR_ALIASES[lower] ?? null;
}

export function isNamedColor(value: unknown): boolean {
  return namedColor(value) !== null;
}

export function isColor(value: unknown): value is Color {
  if (typeof value === "string") return isNamedColor(value) || /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)
  );
}

const NAMED_RGB: Record<NamedColor, [number, number, number]> = {
  off: [0, 0, 0],
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  magenta: [255, 0, 255],
  cyan: [0, 255, 255],
  white: [255, 255, 255],
};

/** RGB as the pod would show it. Invalid colours count as off. */
export function colorToRgb(value: unknown): [number, number, number] {
  const named = namedColor(value);
  if (named) return NAMED_RGB[named];
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
    const n = parseInt(value.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  if (isColor(value) && Array.isArray(value)) return value;
  return [0, 0, 0];
}
