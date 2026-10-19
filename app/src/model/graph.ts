/**
 * Block graph of a program or fragment: nodes, edges and which blocks start, end, or are
 * unreachable. Pure data, no layout (see editor/layout.ts).
 */
import { blockType } from "./blockTypes";
import { isObject, type Block } from "./program";
import type { ResolvedProgram } from "./validate";

export type GraphNode = {
  /** block name (unique in a program) */
  id: string;
  /** undefined for an external node */
  block?: Block;
  /** file that defines the block */
  file: string;
  /** false for blocks from included files (presets) */
  own: boolean;
  start: boolean;
  /** no outgoing connection at all: the program ends after this block */
  ends: boolean;
  unreachable: boolean;
  /** a target that no loaded file defines (e.g. a fragment viewed on its own) */
  external: boolean;
  /** connected output ports in firmware order */
  ports: string[];
  /** unconnected ports that continue at `next` (firmware fallback) */
  fallbackPorts: string[];
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  port: string;
};

export type ProgramGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** files of included blocks, in load order */
  includedFiles: string[];
  start: string | null;
};

/** Builds the graph of a resolved program (blocks of the program and all its includes). */
export function buildGraph(resolved: ResolvedProgram): ProgramGraph {
  const own = resolved.path;
  const blocks = resolved.blocks.filter(
    (b): b is { file: string; block: Block } => isObject(b.block) && typeof b.block.name === "string",
  );
  const byName = new Map<string, { file: string; block: Block }>();
  for (const entry of blocks) if (!byName.has(entry.block.name)) byName.set(entry.block.name, entry);

  const doc = resolved.doc;
  const start = typeof doc?.start === "string" && byName.has(doc.start) ? doc.start : (blocks[0]?.block.name ?? null);
  // a fragment on its own has no start (its entry is reached from the including program)
  const isProgram = typeof doc?.name === "string";

  const edges: GraphEdge[] = [];
  const external = new Map<string, GraphNode>();
  const nodes: GraphNode[] = [];

  for (const { file, block } of byName.values()) {
    const def = blockType(block.type);
    const ports: string[] = [];
    for (const port of def?.ports ?? []) {
      const target = block[port];
      if (typeof target !== "string") continue;
      ports.push(port);
      edges.push({ id: `${block.name}:${port}`, source: block.name, target, port });
      if (!byName.has(target) && !external.has(target)) {
        external.set(target, emptyNode(target, "", { external: true }));
      }
    }
    const hasNext = def?.ports[0] === "next";
    const fallbackPorts = hasNext && typeof block.next === "string" ? (def?.ports.slice(1).filter((p) => block[p] === undefined) ?? []) : [];
    nodes.push({
      ...emptyNode(block.name, file),
      block,
      own: file === own,
      start: isProgram && block.name === start,
      ends: ports.length === 0,
      ports,
      fallbackPorts,
    });
  }

  if (isProgram && start) {
    const reached = reachable(start, edges);
    for (const node of nodes) node.unreachable = !reached.has(node.id);
  }

  const includedFiles = [...new Set(nodes.filter((n) => !n.own).map((n) => n.file))];
  return { nodes: [...nodes, ...external.values()], edges, includedFiles, start: isProgram ? start : null };
}

function emptyNode(id: string, file: string, extra: Partial<GraphNode> = {}): GraphNode {
  return { id, file, own: true, start: false, ends: false, unreachable: false, external: false, ports: [], fallbackPorts: [], ...extra };
}

function reachable(start: string, edges: GraphEdge[]): Set<string> {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const next of out.get(queue.pop()!) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}
