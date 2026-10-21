/**
 * A step in plain language (docs/app/editor-ux.md §4 C): "Wait 1–3 s (random)", "Light pod 2
 * green, wait for the press · max 2 s". Times in seconds, pods counted from 1, no field or port
 * names. Texts are under `sentence.*` in the i18n files.
 */
import { isObject, namedColor, type Block } from "@reactpod/program-model";
import { isCatchEarly } from "./structure";

export type TFunction = (key: string, options?: Record<string, unknown>) => string;

export type SentenceOptions = {
  /** label of a variable (setting) name; default: built-ins in words, the rest as is */
  label?: (name: string) => string;
  /** variables picked at random as a pod ("the chosen pod") */
  chosenPods?: ReadonlySet<string>;
  /** values of settings no step changes: shown as numbers ("Wait 2 s" for PAUSE_MS = 2000) */
  values?: Readonly<Record<string, number>>;
};

const JOIN = " · ";

/** 1500 → "1.5" (en) / "1,5" (de); up to two decimals. */
function seconds(ms: number, t: TFunction): string {
  const s = Math.round(ms / 10) / 100;
  return String(s).replace(".", t("sentence.decimal"));
}

function makeLabel(t: TFunction, options: SentenceOptions) {
  return (name: string) => {
    if (name === "REQUIRED_PERIPHERALS") return t("sentence.var.peripherals");
    if (name === "NODE_COUNT") return t("sentence.var.nodes");
    return options.label?.(name) ?? name;
  };
}

/** One sentence for a block. */
export function stepSentence(block: Block, t: TFunction, options: SentenceOptions = {}): string {
  const label = makeLabel(t, options);
  const known = (v: unknown) => (typeof v === "string" && typeof options.values?.[v] === "number" ? options.values[v] : v);
  const value = (raw: unknown) => {
    const v = known(raw);
    return typeof v === "number" ? String(v) : typeof v === "string" ? label(v) : "?";
  };
  const time = (raw: unknown) => {
    const v = known(raw);
    return typeof v === "number" ? t("sentence.seconds", { value: seconds(v, t) }) : value(v);
  };
  const range = (rawMin: unknown, rawMax: unknown) => {
    const [min, max] = [known(rawMin), known(rawMax)];
    return typeof min === "number" && typeof max === "number"
      ? t("sentence.secondsRange", { min: seconds(min, t), max: seconds(max, t) })
      : t("sentence.range", { min: value(min), max: value(max) });
  };
  const color = (c: unknown, fallback = "green") => {
    if (Array.isArray(c)) return t("sentence.customColor");
    const name = namedColor(c ?? fallback);
    return name ? t(`colors.${name}`) : value(c);
  };
  const pod = (raw: unknown) => {
    const p = known(raw);
    if (typeof p === "number") return t("sentence.pod", { n: p + 1 });
    if (typeof p === "string" && options.chosenPods?.has(p)) return t("sentence.chosenPod");
    if (typeof p === "string") return t("sentence.podIn", { name: label(p) });
    return t("sentence.pod", { n: "?" });
  };
  const limit = (b: Block, field = "timeoutMs") => (b[field] !== undefined ? [t("sentence.max", { time: time(b[field]) })] : []);
  const join = (base: string, parts: string[]) => [base, ...parts].join(JOIN);

  switch (block.type) {
    case "led": {
      const off = namedColor(block.color) === "off";
      const some = Array.isArray(block.leds) && block.leds.length < 18;
      const count = Array.isArray(block.leds) ? block.leds.length : 18;
      if (off) return some ? t("sentence.ledSomeOff", { count }) : t("sentence.ledOff");
      return some ? t("sentence.ledSome", { count, color: color(block.color) }) : t("sentence.ledAll", { color: color(block.color) });
    }
    case "delay":
      if (known(block.ms) === 0) return t("sentence.noWait");
      if (block.ms !== undefined) return t("sentence.wait", { time: time(block.ms) });
      if (block.minMs !== undefined || block.maxMs !== undefined) return t("sentence.waitRandom", { time: range(block.minMs, block.maxMs) });
      return t("sentence.wait", { time: "?" });
    case "button": {
      const parts: string[] = [];
      const long = typeof block.long === "string" || typeof block.short === "string";
      if (long) parts.push(t("sentence.longFrom", { time: time(block.shortMs ?? 1000) }));
      if (isCatchEarly(block)) {
        return join(t("sentence.catchEarly", { time: range(block.minTimeoutMs, block.maxTimeoutMs) }), parts);
      }
      if (block.timeoutMs !== undefined) parts.unshift(...limit(block));
      else if (block.minTimeoutMs !== undefined || block.maxTimeoutMs !== undefined)
        parts.unshift(t("sentence.maxRandom", { time: range(block.minTimeoutMs, block.maxTimeoutMs) }));
      return join(t("sentence.press"), parts);
    }
    case "remotePress": {
      const avoid = block.mode === "avoid";
      const c = color(block.color, avoid ? "red" : "green");
      const parts = limit(block);
      const after = namedColor(block.colorAfter);
      if (block.colorAfter !== undefined && after !== "off") parts.push(t("sentence.colorAfter", { color: color(block.colorAfter) }));
      return join(t(avoid ? "sentence.podAvoid" : "sentence.podHit", { pod: pod(block.pod), color: c }), parts);
    }
    case "remoteMultiPress": {
      const c = color(block.hitColor, "green");
      const pods = known(block.pods);
      const all = pods === undefined || pods === "REQUIRED_PERIPHERALS";
      const base =
        all ? t("sentence.multiAll", { color: c })
        : typeof pods === "number" ? t("sentence.multiSome", { count: pods, color: c })
        : t("sentence.multiVar", { value: value(block.pods), color: c });
      const parts: string[] = [];
      if (block.avoid !== undefined && known(block.avoid) !== 0) parts.push(t("sentence.multiAvoid", { value: value(block.avoid), color: color(block.avoidColor, "red") }));
      if (block.includeCentral === false) parts.push(t("sentence.withoutCentral"));
      parts.push(...limit(block));
      return join(base, parts);
    }
    case "remoteResetAll": {
      const base = block.pods === undefined ? t("sentence.resetAll") : t("sentence.resetSome", { value: value(block.pods) });
      return block.ledsOff === false ? join(base, [t("sentence.centralStays")]) : base;
    }
    case "setVariable": {
      const v = value(block.var);
      const op = typeof block.op === "string" ? block.op : "=";
      switch (op) {
        case "+":
        case "add":
          return t("sentence.add", { value: value(block.value), var: v });
        case "-":
        case "sub":
          return t("sentence.subtract", { value: value(block.value), var: v });
        case "random":
        case "?":
        case "randomOther":
        case "!": {
          const other = op === "randomOther" || op === "!";
          const kind = block.value === "REQUIRED_PERIPHERALS" ? "Pod" : block.value === "NODE_COUNT" ? "Node" : "Number";
          return t(`sentence.random${kind}${other ? "Other" : ""}`, { var: v, value: value(block.value) });
        }
        default:
          return t("sentence.set", { var: v, value: value(block.value) });
      }
    }
    case "if": {
      const op = typeof block.op === "string" ? block.op : "==";
      const words = IF_WORDS[op] ?? "eq";
      return t("sentence.if", { left: value(block.left), op: t(`sentence.op.${words}`), right: value(block.right) });
    }
    case "summary": {
      const stats = (["Average", "Best", "Worst", "Count"] as const).filter((s) => typeof block[`store${s}`] === "string");
      const base = stats.length ? t("sentence.summaryOf", { list: stats.map((s) => t(`sentence.stat.${s.toLowerCase()}`)).join(", ") }) : t("sentence.summary");
      return typeof block.metric === "string" && block.metric !== "reaction" ? join(base, [t("sentence.ofMetric", { name: block.metric })]) : base;
    }
    case "repeat":
      return repeatSentence(block.count, t, options);
    default:
      return t("sentence.unknown", { type: String(block.type) });
  }
}

const IF_WORDS: Record<string, string> = { "==": "eq", "=": "eq", "!=": "ne", "!": "ne", ">": "gt", "<": "lt", ">=": "ge", "<=": "le" };

/** "Repeat 12 rounds"; a variable count shows its start value when it is known. */
export function repeatSentence(count: unknown, t: TFunction, options: SentenceOptions = {}): string {
  const n = typeof count === "number" ? count : typeof count === "string" && isObject(options.values) ? options.values[count] : undefined;
  if (typeof n === "number") return t("sentence.repeat", { count: n });
  return t("sentence.repeatVar", { value: typeof count === "string" ? makeLabel(t, options)(count) : "?" });
}
