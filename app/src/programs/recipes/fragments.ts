/**
 * Reusable block groups. The game wizard builds its programs from them (wizard/generate.ts);
 * the "add a step" recipes reuse them (editor-ux.md §4 E).
 *
 * A fragment is a few blocks with one entry and open exits. `chain` links the exits of one
 * fragment to the entry of the next. `roundEnds` are exits that leave the round early
 * (false start, red pod hit, "end the round" on a timeout); the loop links them back to its head.
 */
import type { Block, Value } from "@reactpod/program-model";

export type Exit = { from: string; port: string };
export type Fragment = { blocks: Block[]; entry: string; exits: Exit[]; roundEnds?: Exit[] };

export const METRIC = "reaction";
export const MISSES = "MISSES";

/** Sets `port` of every exit to `target` (in place, the blocks belong to the caller). */
export function connect(blocks: Block[], exits: readonly Exit[], target: string): void {
  const byName = new Map(blocks.map((b) => [b.name, b]));
  for (const exit of exits) {
    const block = byName.get(exit.from);
    if (!block) throw new Error(`fragment exit from unknown block ${exit.from}`);
    block[exit.port] = target;
  }
}

/** Runs the fragments one after another: exits of each go to the entry of the next. */
export function chain(...parts: Fragment[]): Fragment {
  if (parts.length === 0) throw new Error("chain needs at least one fragment");
  const blocks = parts.flatMap((p) => p.blocks.map((b) => ({ ...b })));
  for (let i = 0; i + 1 < parts.length; i++) connect(blocks, parts[i]!.exits, parts[i + 1]!.entry);
  return {
    blocks,
    entry: parts[0]!.entry,
    exits: parts[parts.length - 1]!.exits,
    roundEnds: parts.flatMap((p) => p.roundEnds ?? []),
  };
}

function single(block: Block, port = "next"): Fragment {
  return { blocks: [block], entry: block.name, exits: [{ from: block.name, port }] };
}

/** Light the central's LEDs (all, or `leds`). */
export function light(name: string, color: string, leds?: number[]): Fragment {
  return single({ name, type: "led", color, ...(leds ? { leds } : {}) });
}

/** A pause: fixed (`ms`) or random between `minMs` and `maxMs`. */
export function pause(name: string, time: { ms: Value } | { minMs: Value; maxMs: Value }): Fragment {
  return single({ name, type: "delay", ...time });
}

/** Change a variable (counter, random pod). */
export function setVariable(name: string, variable: string, op: string, value: Value): Fragment {
  return single({ name, type: "setVariable", var: variable, op, value });
}

/** Add 1 to the miss counter. */
export function countMiss(name: string, variable = MISSES): Fragment {
  return setVariable(name, variable, "+", 1);
}

export type TimeLimit = {
  ms: Value;
  /** go on with the next step, count a miss and go on, or end the round */
  onTimeout: "goOn" | "countMiss" | "endRound";
  /** count a miss on "endRound" too */
  countMiss?: boolean;
  /** name of the miss counter block (default `<block>Miss`) */
  missName?: string;
};

/**
 * Connects a waiting block's `timeout` port as the time limit says. Returns the extra blocks,
 * exits (go on) and round ends.
 */
function timeoutBranch(from: string, limit: TimeLimit): Omit<Fragment, "entry"> {
  const missName = limit.missName ?? `${from}Miss`;
  const counts = limit.onTimeout === "countMiss" || (limit.onTimeout === "endRound" && limit.countMiss === true);
  if (!counts) {
    const exit = [{ from, port: "timeout" }];
    return limit.onTimeout === "endRound" ? { blocks: [], exits: [], roundEnds: exit } : { blocks: [], exits: exit };
  }
  // the caller links from.timeout to the miss counter
  const exit = [{ from: missName, port: "next" }];
  return {
    blocks: countMiss(missName).blocks,
    exits: limit.onTimeout === "endRound" ? [] : exit,
    roundEnds: limit.onTimeout === "endRound" ? exit : [],
  };
}

function withTimeout(block: Block, port: string, limit: TimeLimit | null | undefined, timeoutField = "timeoutMs"): Fragment {
  if (!limit) return single(block, port);
  const branch = timeoutBranch(block.name, limit);
  const head: Block = { ...block, [timeoutField]: limit.ms };
  if (branch.blocks.length) head.timeout = branch.blocks[0]!.name;
  return {
    blocks: [head, ...branch.blocks],
    entry: head.name,
    exits: [{ from: head.name, port }, ...branch.exits],
    roundEnds: branch.roundEnds,
  };
}

/** Wait for a press on the central (leaves through `pressed` on the press). */
export function centralPress(name: string, options: { record?: boolean; timeLimit?: TimeLimit | null } = {}): Fragment {
  const block: Block = { name, type: "button", ...(options.record ? { record: METRIC } : {}) };
  return withTimeout(block, "pressed", options.timeLimit);
}

/** Light one pod (`pod`: id or variable) and wait for its press. */
export function podPress(name: string, options: { pod: Value; color: string; record?: boolean; timeLimit?: TimeLimit | null }): Fragment {
  const block: Block = { name, type: "remotePress", pod: options.pod, color: options.color, ...(options.record ? { record: METRIC } : {}) };
  return withTimeout(block, "next", options.timeLimit);
}

/**
 * Pause that catches early presses (the pattern of solo.json): a button whose timeout is the
 * pause. A press before the time is up is a false start: the central flashes red and the round ends.
 */
export function falseStartPause(
  name: string,
  time: { ms: Value } | { minMs: Value; maxMs: Value },
  options: { countMiss?: boolean; flashMs?: number } = {},
): Fragment {
  const timeout = "ms" in time ? { timeoutMs: time.ms } : { minTimeoutMs: time.minMs, maxTimeoutMs: time.maxMs };
  const red = `${name}FalseStart`;
  const miss = `${name}FalseStartMiss`;
  const hold = `${name}FalseStartPause`;
  const blocks: Block[] = [
    { name, type: "button", ...timeout, pressed: red },
    { name: red, type: "led", color: "red", next: options.countMiss ? miss : hold },
    ...(options.countMiss ? [{ name: miss, type: "setVariable", var: MISSES, op: "+", value: 1, next: hold }] : []),
    { name: hold, type: "delay", ms: options.flashMs ?? 1000 },
  ];
  return { blocks, entry: name, exits: [{ from: name, port: "timeout" }], roundEnds: [{ from: hold, port: "next" }] };
}

/** Light all pods at once (and the central); optionally some red "don't touch" pods. */
export function allAtOnce(
  name: string,
  options: { color: string; pods?: Value; red?: { count: Value; countMiss?: boolean; flashMs?: number } | null; record?: boolean; timeLimit?: TimeLimit | null },
): Fragment {
  const block: Block = {
    name,
    type: "remoteMultiPress",
    ...(options.pods !== undefined ? { pods: options.pods } : {}),
    hitColor: options.color,
    ...(options.record ? { record: METRIC } : {}),
  };
  const head = withTimeout(block, "next", options.timeLimit);
  if (!options.red) return head;
  const first = head.blocks[0]!;
  first.avoid = options.red.count;
  const red = `${name}RedHit`;
  const miss = `${name}RedMiss`;
  const hold = `${name}RedPause`;
  first.avoidHit = red;
  const extra: Block[] = [
    { name: red, type: "led", color: "red", next: options.red.countMiss ? miss : hold },
    ...(options.red.countMiss ? [{ name: miss, type: "setVariable", var: MISSES, op: "+", value: 1, next: hold }] : []),
    { name: hold, type: "delay", ms: options.red.flashMs ?? 1000 },
  ];
  return { ...head, blocks: [...head.blocks, ...extra], exits: [...head.exits, { from: hold, port: "next" }] };
}

/** Switch all pods (and the central) off. */
export function resetAll(name: string): Fragment {
  return single({ name, type: "remoteResetAll" });
}

/** Print the statistics of the reaction times and keep average and best. */
export function results(name: string): Fragment {
  return single({ name, type: "summary", metric: METRIC, storeAverage: "AVG_REACTION", storeBest: "BEST_REACTION" });
}

/** Pick a pod at random: `op` "random" (0 … value−1) or "randomOther" (never the same twice). */
export function pickPod(name: string, variable: string, op: "random" | "randomOther", value: Value): Fragment {
  return setVariable(name, variable, op, value);
}

/** Decide: `left op right` → `ifYes` / `ifNo` fragments; both end where the two branches end. */
export function decide(name: string, left: Value, op: string, right: Value, ifYes: Fragment, ifNo: Fragment): Fragment {
  return {
    blocks: [{ name, type: "if", left, op, right, true: ifYes.entry, false: ifNo.entry }, ...ifYes.blocks, ...ifNo.blocks],
    entry: name,
    exits: [...ifYes.exits, ...ifNo.exits],
    roundEnds: [...(ifYes.roundEnds ?? []), ...(ifNo.roundEnds ?? [])],
  };
}
