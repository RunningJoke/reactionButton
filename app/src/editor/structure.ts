/**
 * Structure of a program for the simple view (docs/app/editor-ux.md §4 C): round loops and a
 * numbered list of steps with their branches. Pure data, no layout.
 *
 * Works on a flat program (`start` + every block, includes already resolved). Two loop forms are
 * shown as the same "Repeat N rounds" bracket:
 * - `repeat` block (program format 2): `body` is one round, `done` continues after the last round.
 * - counter (the `lib/loop` pattern, format 1): `setVariable X + 1` → round → `if X >= N`, whose
 *   other port leads back to the setVariable. An optional `setVariable X = 0` that leads to the
 *   setVariable ("start again") belongs to the loop too.
 *
 * Port roles come from the program model (`portRole`), plus "ifPressedEarly" for the false-start pause.
 */
import { blockType, isObject, portRole as modelPortRole, type Block, type PortRole as ModelPortRole } from "@reactpod/program-model";
import type { ProgramJson } from "./ops";

export type LoopInfo = {
  kind: "repeat" | "counter";
  /** the repeat block, or the `if` that ends a round */
  head: string;
  /** the block where a round starts: the repeat block, or the counter's setVariable */
  entry: string;
  counterVar?: string;
  /** number of rounds: a number or a variable name */
  countValue: unknown;
  /** blocks of one round in step-list order (main path first, branch steps after their fork) */
  body: string[];
  /** first block after the last round */
  after?: string;
  /** blocks the bracket stands for (not listed as steps) */
  hidden: string[];
};

/**
 * Words for a port (editor-ux.md §5 "Port names"): the model's roles, plus one the step list
 * adds: the pause of a "catch early presses" step (button with a random time limit) was pressed.
 */
export type PortRole = ModelPortRole | "ifPressedEarly";

export type StepBranch = { port: string; role: string; target?: string };

export type Step = {
  block: string;
  /** nesting: 0 = top level; +1 inside a Repeat bracket and inside a branch */
  depth: number;
  /** ports that do not simply continue with the next step in the list */
  branches: StepBranch[];
  /** "3", or "3.1" for the first step of a branch of step 3 */
  number: string;
  /** set on the bracket of a loop (its `block` is the loop head) */
  loop?: LoopInfo;
  /** head of the innermost loop around this step */
  inLoop?: string;
  /** steps with the same scope form one list; only they can be moved past each other */
  scope: string;
  /** the step and port this branch list starts at */
  branchOf?: { block: string; port: string };
  /** not reachable from the start */
  unreachable?: boolean;
};

/** Output ports of a block in firmware order; none for an unknown type. */
export function portsOf(block: Block): readonly string[] {
  return blockType(block.type)?.ports ?? [];
}

const target = (block: Block, port: string) => (typeof block[port] === "string" ? (block[port] as string) : undefined);

/**
 * A button with a random time limit, a `timeout` link and no recorded time: the pause of a
 * reaction game that catches early presses (solo.json). Its time-out is the normal way on.
 */
export function isCatchEarly(block: Block): boolean {
  return (
    block.type === "button" &&
    block.minTimeoutMs !== undefined &&
    block.maxTimeoutMs !== undefined &&
    target(block, "timeout") !== undefined &&
    block.record === undefined
  );
}

export function portRole(block: Block, port: string): PortRole {
  if (isCatchEarly(block)) return port === "timeout" ? "then" : port === "long" ? "longPress" : "ifPressedEarly";
  return modelPortRole(block, port) ?? "then";
}

/**
 * The connected port that leads to the next step in the list. `if` has none (both answers are
 * branches); a repeat block continues after its last round.
 */
export function mainPort(block: Block): string | undefined {
  let order: readonly string[];
  if (block.type === "if") return undefined;
  if (block.type === "repeat") order = ["done", "next"];
  else if (isCatchEarly(block)) order = ["timeout"];
  else if (block.type === "button") order = ["pressed", "next", "short"];
  else order = ["next"];
  return order.find((p) => target(block, p) !== undefined);
}

type Graph = { blocks: Map<string, Block>; order: string[]; start: string | null };

function graphOf(program: ProgramJson): Graph {
  const blocks = new Map<string, Block>();
  const order: string[] = [];
  for (const b of Array.isArray(program.blocks) ? program.blocks : []) {
    if (!isObject(b) || typeof b.name !== "string" || typeof b.type !== "string" || blocks.has(b.name)) continue;
    blocks.set(b.name, b as Block);
    order.push(b.name);
  }
  const start = typeof program.start === "string" && blocks.has(program.start) ? program.start : (order[0] ?? null);
  return { blocks, order, start };
}

const isIncrement = (b: Block) => b.type === "setVariable" && (b.op === "+" || b.op === "add") && typeof b.var === "string";
const isReset = (b: Block, v: string) => b.type === "setVariable" && b.var === v && (b.op === undefined || b.op === "=" || b.op === "set") && b.value === 0;

/** Loop heads without bodies (the bodies need the step order). */
function findLoops(g: Graph): LoopInfo[] {
  const loops: LoopInfo[] = [];
  const used = new Set<string>();
  for (const name of g.order) {
    const b = g.blocks.get(name)!;
    if (b.type === "repeat") {
      loops.push({
        kind: "repeat",
        head: name,
        entry: name,
        counterVar: typeof b.storeIndex === "string" ? b.storeIndex : undefined,
        countValue: b.count,
        body: [],
        // body and done both fall back to next; with neither connected, next is the round
        after: target(b, "done") ?? (target(b, "body") ? target(b, "next") : undefined),
        hidden: [name],
      });
      continue;
    }
    if (!isIncrement(b) || used.has(name)) continue;
    const first = target(b, "next");
    if (!first) continue;
    const v = b.var as string;
    // breadth first from the round's first block: the `if` on the counter that leads back here
    const seen = new Set<string>([name]);
    const queue = [first];
    let head: Block | undefined;
    while (queue.length && !head) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const c = g.blocks.get(id);
      if (!c) continue;
      if (c.type === "if" && (c.left === v || c.right === v) && (c.true === name || c.false === name)) {
        head = c;
        break;
      }
      for (const p of portsOf(c)) {
        const t = target(c, p);
        if (t && !seen.has(t)) queue.push(t);
      }
    }
    if (!head) continue;
    const exitPort = head.true === name ? "false" : "true";
    const reset = g.order.find((n) => n !== name && isReset(g.blocks.get(n)!, v) && g.blocks.get(n)!.next === name);
    used.add(name);
    loops.push({
      kind: "counter",
      head: head.name,
      entry: name,
      counterVar: v,
      countValue: head.left === v ? head.right : head.left,
      body: [],
      after: target(head, exitPort),
      hidden: reset ? [name, head.name, reset] : [name, head.name],
    });
  }
  return loops;
}

type Scope = {
  id: string;
  depth: number;
  /** blocks that end this list (loop heads of enclosing rounds) */
  stops: ReadonlySet<string>;
  /** blocks of enclosing lists: a branch that reaches one of them has rejoined */
  reserved: ReadonlySet<string>;
  /** where the flow naturally goes when this list ends */
  continues: ReadonlySet<string>;
  inLoop?: string;
  prefix: string;
  /** numbers inside `prefix`: shared by all branches of one step, so they count on (3.1, 3.2 …) */
  counter?: { n: number };
  branchOf?: { block: string; port: string };
  unreachable?: boolean;
};

class Linearizer {
  steps: Step[] = [];
  placed = new Set<string>();
  private loopByEntry = new Map<string, LoopInfo>();
  private hidden = new Set<string>();
  private counter = 0;
  private scopes = 0;

  constructor(
    private g: Graph,
    public loops: LoopInfo[],
  ) {
    for (const loop of loops) {
      this.loopByEntry.set(loop.entry, loop);
      for (const h of loop.hidden) this.hidden.add(h);
    }
  }

  /** Main path from `entry` without placing anything: block names and loop entries. */
  private mainPath(entry: string | undefined, stops: ReadonlySet<string>, reserved: ReadonlySet<string>): string[] {
    const path: string[] = [];
    const seen = new Set<string>();
    let cur = entry;
    while (cur && this.g.blocks.has(cur) && !seen.has(cur) && !stops.has(cur) && !this.placed.has(cur) && !reserved.has(cur)) {
      seen.add(cur);
      const loop = this.loopByEntry.get(cur);
      if (loop) {
        path.push(cur);
        cur = loop.after;
        continue;
      }
      if (this.hidden.has(cur)) break;
      path.push(cur);
      cur = this.nextOf(this.g.blocks.get(cur)!, stops, reserved);
    }
    return path;
  }

  /** The block after `b` in its list: its main port, or where both answers of an `if` meet again. */
  private nextOf(b: Block, stops: ReadonlySet<string>, reserved: ReadonlySet<string>): string | undefined {
    const port = mainPort(b);
    if (port) return target(b, port);
    if (b.type !== "if") return undefined;
    const yes = target(b, "true");
    const no = target(b, "false");
    if (!yes || !no) return undefined;
    const inner = new Set([...stops, b.name]);
    const a = [yes, ...this.mainPath(yes, inner, reserved)];
    const other = new Set([no, ...this.mainPath(no, inner, reserved)]);
    return a.find((n) => other.has(n));
  }

  walk(entry: string | undefined, scope: Scope) {
    const path = this.mainPath(entry, scope.stops, scope.reserved);
    const reserved = new Set([...scope.reserved, ...path]);
    const sub = scope.counter ?? { n: 0 };
    for (const [i, name] of path.entries()) {
      const after = path[i + 1];
      const loop = this.loopByEntry.get(name);
      if (loop) {
        // the bracket has no number of its own; its round continues the count
        for (const h of loop.hidden) this.placed.add(h);
        const number = scope.prefix ? `${scope.prefix}.${++sub.n}` : "";
        this.steps.push({ block: loop.head, depth: scope.depth, branches: [], number, loop, scope: scope.id, ...this.extra(scope) });
        const start = this.steps.length;
        const loopBlock = this.g.blocks.get(loop.head)!;
        const bodyEntry = loop.kind === "repeat" ? (target(loopBlock, "body") ?? target(loopBlock, "next")) : target(this.g.blocks.get(loop.entry)!, "next");
        this.walk(bodyEntry, {
          id: `s${++this.scopes}`,
          depth: scope.depth + 1,
          stops: new Set([...scope.stops, ...loop.hidden]),
          reserved,
          continues: new Set([loop.head, loop.entry]),
          inLoop: loop.head,
          prefix: number,
          unreachable: scope.unreachable,
        });
        loop.body = this.steps.slice(start).map((s) => s.block);
        continue;
      }
      const number = scope.prefix ? `${scope.prefix}.${++sub.n}` : String(++this.counter);
      this.placed.add(name);
      const b = this.g.blocks.get(name)!;
      const step: Step = { block: name, depth: scope.depth, branches: [], number, scope: scope.id, ...this.extra(scope) };
      this.steps.push(step);
      const main = mainPort(b);
      const branchCounter = { n: 0 };
      const flowsOn = b.type === "if" ? this.nextOf(b, scope.stops, scope.reserved) : main ? target(b, main) : undefined;
      for (const port of portsOf(b)) {
        const to = target(b, port);
        if (!to) continue;
        if (port === main) {
          // the way on shows only when it jumps: not to the next step, not the natural end of the list
          if (to === after || (after === undefined && scope.continues.has(to))) continue;
          step.branches.push({ port, role: "then", target: to });
          continue;
        }
        step.branches.push({ port, role: portRole(b, port), target: to });
        // a branch's own steps follow directly, one level deeper
        if (to !== flowsOn && !this.placed.has(to) && !reserved.has(to) && !scope.stops.has(to) && !this.hidden.has(to)) {
          this.walk(to, {
            id: `s${++this.scopes}`,
            depth: scope.depth + 1,
            stops: scope.stops,
            reserved,
            continues: new Set(flowsOn ? [flowsOn] : after ? [after] : [...scope.continues]),
            inLoop: scope.inLoop,
            prefix: number,
            counter: branchCounter,
            branchOf: { block: name, port },
            unreachable: scope.unreachable,
          });
        }
      }
    }
  }

  private extra(scope: Scope): Partial<Step> {
    const out: Partial<Step> = {};
    if (scope.inLoop) out.inLoop = scope.inLoop;
    if (scope.branchOf) out.branchOf = scope.branchOf;
    if (scope.unreachable) out.unreachable = true;
    return out;
  }

  run() {
    const empty = new Set<string>();
    this.walk(this.g.start ?? undefined, { id: "s0", depth: 0, stops: empty, reserved: empty, continues: empty, prefix: "" });
    // blocks the start never reaches: one list each, at the end
    for (const name of this.g.order) {
      if (this.placed.has(name) || this.hidden.has(name)) continue;
      this.walk(name, { id: `s${++this.scopes}`, depth: 0, stops: empty, reserved: empty, continues: empty, prefix: "", unreachable: true });
    }
    // hidden blocks of loops that were never reached
    for (const loop of this.loops) {
      if (loop.hidden.some((h) => this.placed.has(h))) continue;
      this.walk(loop.entry, { id: `s${++this.scopes}`, depth: 0, stops: empty, reserved: empty, continues: empty, prefix: "", unreachable: true });
    }
  }
}

function analyse(program: ProgramJson): { loops: LoopInfo[]; steps: Step[] } {
  const g = graphOf(program);
  const lin = new Linearizer(g, findLoops(g));
  lin.run();
  return { loops: lin.loops, steps: lin.steps };
}

/** Round loops of a program (both forms), with their bodies in step-list order. */
export function detectLoops(program: ProgramJson): LoopInfo[] {
  return analyse(program).loops;
}

/**
 * The program as a numbered list in flow order from the start block: main path first; the steps
 * of a branch follow the step it starts at, one level deeper; a loop is one bracket step with its
 * round inside. Blocks the start does not reach come last (`unreachable`).
 */
export function stepList(program: ProgramJson): Step[] {
  return analyse(program).steps;
}

/** A flat program for the step list: the program's `start` with the blocks of all its files. */
export function flatProgram(doc: ProgramJson, blocks: readonly unknown[], start: string | null): ProgramJson {
  return { ...doc, start: start ?? undefined, blocks: [...blocks] };
}

/** The step of `block` and the steps of its branches (everything listed under it, one level deeper). */
export function stepFamily(steps: readonly Step[], block: string): string[] {
  const i = steps.findIndex((s) => s.block === block && !s.loop);
  if (i < 0) return [];
  const out = [block];
  for (let j = i + 1; j < steps.length && steps[j]!.depth > steps[i]!.depth; j++) out.push(steps[j]!.block);
  return out;
}

/** The step of `block` and the steps before and after it in its own list (same scope). */
export function stepNeighbours(steps: readonly Step[], block: string): { step?: Step; before?: Step; after?: Step } {
  const step = steps.find((s) => s.block === block && !s.loop);
  if (!step) return {};
  const list = steps.filter((s) => s.scope === step.scope);
  const i = list.indexOf(step);
  return { step, before: list[i - 1], after: list[i + 1] };
}

/** The block a link must point to so the flow enters this step (a counter loop starts at its setVariable). */
export function entryOf(step: Step): string {
  return step.loop ? step.loop.entry : step.block;
}
