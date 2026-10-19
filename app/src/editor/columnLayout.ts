/**
 * Single-column layout of a block graph: all blocks stacked top to bottom, connections drawn
 * as arrows in lanes beside the column. Pure data; the view measures the cards and draws.
 *
 * - Order: flow order from the start block. Loops (back edges) are ignored for the order, the
 *   rest is placed topologically, following the first port first, so the main path reads
 *   straight down and a short branch sits between its fork and the block where it rejoins.
 * - A block with exactly one connection to the block directly below just continues downwards
 *   ("joined", no arrow).
 * - Every other connection is a side arrow from a port row of the source card to the header of
 *   the target card: right side when it goes down, left side when it goes back up (loops).
 *   Arrows into the same target on the same side share one lane (a trunk).
 */
import type { GraphEdge, ProgramGraph } from "../model/graph";

export type Side = "left" | "right";

export type SideArrow = {
  edge: GraphEdge;
  side: Side;
  /** lane index on its side, 0 = next to the column */
  lane: number;
};

export type ColumnLayout = {
  /** node ids, top to bottom */
  order: string[];
  /** ids of blocks that continue straight into the block below (no arrow) */
  joined: Set<string>;
  arrows: SideArrow[];
  /** number of lanes per side */
  lanes: Record<Side, number>;
};

export function columnLayout(graph: ProgramGraph): ColumnLayout {
  const order = flowOrder(graph);
  const index = new Map(order.map((id, i) => [id, i]));
  const bySource = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) bySource.set(edge.source, [...(bySource.get(edge.source) ?? []), edge]);

  const joined = new Set<string>();
  const arrows: Omit<SideArrow, "lane">[] = [];
  for (const [i, id] of order.entries()) {
    const out = bySource.get(id) ?? [];
    if (out.length === 1 && out[0]!.target === order[i + 1]) {
      joined.add(id);
      continue;
    }
    for (const edge of out) {
      arrows.push({ edge, side: index.get(edge.target)! > i ? "right" : "left" });
    }
  }

  const lanes: Record<Side, number> = { left: 0, right: 0 };
  const laneOf = new Map<string, number>();
  for (const side of ["left", "right"] as const) {
    lanes[side] = assignLanes(
      arrows.filter((a) => a.side === side),
      index,
      bySource,
      laneOf,
    );
  }
  return { order, joined, arrows: arrows.map((a) => ({ ...a, lane: laneOf.get(trunkKey(a))! })), lanes };
}

const trunkKey = (a: Omit<SideArrow, "lane">) => `${a.side}>${a.edge.target}`;

/**
 * Greedy interval colouring of the trunks of one side. Positions in "row units": card i spans
 * [i, i + 1), arrows enter at the header (i + 0.1) and leave from a port row (i + 0.5 + …).
 * Short trunks are placed first, so they hug the column. Returns the number of lanes.
 */
function assignLanes(
  arrows: Omit<SideArrow, "lane">[],
  index: Map<string, number>,
  bySource: Map<string, GraphEdge[]>,
  laneOf: Map<string, number>,
): number {
  const spans = new Map<string, { lo: number; hi: number }>();
  for (const a of arrows) {
    const ports = bySource.get(a.edge.source)!;
    const exit = index.get(a.edge.source)! + 0.5 + ports.indexOf(a.edge) * 0.05;
    const entry = index.get(a.edge.target)! + 0.1;
    const key = trunkKey(a);
    const span = spans.get(key) ?? { lo: entry, hi: entry };
    spans.set(key, { lo: Math.min(span.lo, exit), hi: Math.max(span.hi, exit) });
  }
  const trunks = [...spans.entries()].sort(([, a], [, b]) => a.hi - a.lo - (b.hi - b.lo) || a.lo - b.lo);
  const placed: { lo: number; hi: number; lane: number }[] = [];
  let count = 0;
  for (const [key, span] of trunks) {
    let lane = 0;
    while (placed.some((p) => p.lane === lane && p.lo < span.hi && span.lo < p.hi)) lane++;
    placed.push({ ...span, lane });
    laneOf.set(key, lane);
    count = Math.max(count, lane + 1);
  }
  return count;
}

/** Topological order of the graph without its back edges; start first, the first port first. */
export function flowOrder(graph: ProgramGraph): string[] {
  const ids = graph.nodes.map((n) => n.id);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of graph.edges) out.get(e.source)?.push(e.target);
  const roots = graph.start ? [graph.start, ...ids] : ids;

  // back edges: found by a depth-first search in port order
  const back = new Set<string>();
  const state = new Map<string, "open" | "done">();
  const visit = (id: string) => {
    state.set(id, "open");
    for (const next of out.get(id) ?? []) {
      if (state.get(next) === "open") back.add(`${id}>${next}`);
      else if (!state.has(next)) visit(next);
    }
    state.set(id, "done");
  };
  for (const root of roots) if (!state.has(root)) visit(root);

  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const [id, targets] of out) {
    for (const t of targets) if (!back.has(`${id}>${t}`)) indegree.set(t, indegree.get(t)! + 1);
  }

  const order: string[] = [];
  const placed = new Set<string>();
  const ready: string[] = []; // stack: the most recently freed block continues the column
  while (order.length < ids.length) {
    if (ready.length === 0) {
      const next = roots.find((id) => !placed.has(id) && indegree.get(id) === 0) ?? roots.find((id) => !placed.has(id))!;
      ready.push(next);
    }
    const id = ready.pop()!;
    if (placed.has(id)) continue;
    placed.add(id);
    order.push(id);
    const freed: string[] = [];
    for (const t of out.get(id) ?? []) {
      if (back.has(`${id}>${t}`)) continue;
      const d = indegree.get(t)! - 1;
      indegree.set(t, d);
      if (d === 0 && !freed.includes(t)) freed.push(t);
    }
    // first port on top of the stack
    for (const t of freed.reverse()) ready.push(t);
  }
  return order;
}
