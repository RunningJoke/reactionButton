/** Short text for a block's main parameters, shown on the graph node. */
import type { Block } from "@reactpod/program-model";
import { namedColor } from "@reactpod/program-model";

export type SummaryPart =
  | { kind: "text"; text: string }
  | { kind: "color"; color: unknown; label: string };

const v = (value: unknown) => (value === undefined ? "?" : typeof value === "string" ? value : String(value));

function ms(value: unknown) {
  return typeof value === "number" ? `${value} ms` : v(value);
}

function range(min: unknown, max: unknown) {
  return typeof min === "number" && typeof max === "number" ? `${min}–${max} ms` : `${v(min)}–${v(max)}`;
}

function colorLabel(color: unknown) {
  if (Array.isArray(color)) return `rgb(${color.join(",")})`;
  return namedColor(color) ?? v(color);
}

/** Summary parts; `t` translates the few words that are not technical. */
export function blockSummary(block: Block, t: (key: string, options?: Record<string, unknown>) => string): SummaryPart[] {
  const text = (s: string): SummaryPart => ({ kind: "text", text: s });
  switch (block.type) {
    case "led": {
      const leds = Array.isArray(block.leds) ? t("summary.leds", { count: block.leds.length }) : t("summary.allLeds");
      return [{ kind: "color", color: block.color, label: colorLabel(block.color) }, text(leds)];
    }
    case "delay":
      return [text(block.ms !== undefined ? ms(block.ms) : range(block.minMs, block.maxMs))];
    case "button": {
      const parts: SummaryPart[] = [];
      if (block.timeoutMs !== undefined) parts.push(text(`⏱ ${ms(block.timeoutMs)}`));
      else if (block.minTimeoutMs !== undefined) parts.push(text(`⏱ ${range(block.minTimeoutMs, block.maxTimeoutMs)}`));
      if (typeof block.record === "string") parts.push(text(`● ${block.record}`));
      return parts.length ? parts : [text(t("summary.waitPress"))];
    }
    case "if":
      return [text(`${v(block.left)} ${typeof block.op === "string" ? block.op : "=="} ${v(block.right)}`)];
    case "setVariable": {
      const op = typeof block.op === "string" ? block.op : "=";
      if (op === "random" || op === "?") return [text(`${v(block.var)} = random(${v(block.value)})`)];
      if (op === "randomOther" || op === "!") return [text(`${v(block.var)} = randomOther(${v(block.value)})`)];
      if (op === "+" || op === "add") return [text(`${v(block.var)} += ${v(block.value)}`)];
      if (op === "-" || op === "sub") return [text(`${v(block.var)} −= ${v(block.value)}`)];
      return [text(`${v(block.var)} = ${v(block.value)}`)];
    }
    case "remotePress": {
      const mode = block.mode === "avoid" ? t("summary.avoid") : t("summary.hit");
      const parts: SummaryPart[] = [text(`${t("summary.pod")} ${v(block.pod)} · ${mode}`)];
      if (block.timeoutMs !== undefined) parts.push(text(`⏱ ${ms(block.timeoutMs)}`));
      if (typeof block.record === "string") parts.push(text(`● ${block.record}`));
      return parts;
    }
    case "remoteMultiPress": {
      const pods = block.pods === undefined ? t("summary.allPods") : `${t("summary.pods")} ${v(block.pods)}`;
      const parts: SummaryPart[] = [text(pods)];
      if (block.avoid !== undefined && block.avoid !== 0) parts.push(text(`${t("summary.avoid")} ${v(block.avoid)}`));
      if (block.timeoutMs !== undefined) parts.push(text(`⏱ ${ms(block.timeoutMs)}`));
      if (typeof block.record === "string") parts.push(text(`● ${block.record}`));
      return parts;
    }
    case "remoteResetAll":
      return [text(block.pods === undefined ? t("summary.allPods") : `${t("summary.pods")} ${v(block.pods)}`)];
    case "summary":
      return [text(`Σ ${v(block.metric)}`)];
    case "repeat": {
      const parts: SummaryPart[] = [text(`↻ ${v(block.count)}×`)];
      if (typeof block.storeIndex === "string") parts.push(text(`# ${block.storeIndex}`));
      return parts;
    }
    case "effect": {
      const parts: SummaryPart[] = [{ kind: "color", color: block.color ?? "white", label: colorLabel(block.color ?? "white") }, text(String(block.effect ?? "?"))];
      if (typeof block.durationMs === "number" && block.durationMs > 0) parts.push(text(ms(block.durationMs)));
      if (block.wait === true) parts.push(text("⏳"));
      return parts;
    }
    default:
      return [];
  }
}
