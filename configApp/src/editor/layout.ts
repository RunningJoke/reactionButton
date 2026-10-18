/**
 * Automatic layout of a block graph (dagre, top to bottom). Positions are never stored on the
 * pod (decision 5); manual positions are kept locally later (O1).
 */
import dagre from "@dagrejs/dagre";
import type { ProgramGraph } from "../model/graph";

export const NODE_WIDTH = 200;
const HEADER = 34;
const LINE = 18;
const PADDING = 14;

export type Point = { x: number; y: number };
export type NodeBox = { x: number; y: number; width: number; height: number };

export type GraphLayout = {
  /** top-left corner and size per node id */
  nodes: Map<string, NodeBox>;
  /** dagre route per edge id (without the end points, which React Flow takes from the handles) */
  edges: Map<string, Point[]>;
  width: number;
  height: number;
};

/** Node height from the number of summary lines (see BlockNode). */
export function nodeHeight(summaryLines: number, hint: boolean): number {
  return HEADER + PADDING + Math.max(1, summaryLines) * LINE + (hint ? LINE : 0);
}

export function layoutGraph(graph: ProgramGraph, heights: (id: string) => number): GraphLayout {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 56, edgesep: 14, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: heights(node.id) });
  }
  for (const edge of graph.edges) {
    // edge labels take room between ranks
    const label = edge.port === "next" ? {} : { width: 56, height: 16, labelpos: "c" };
    g.setEdge(edge.source, edge.target, label, edge.id);
  }

  dagre.layout(g);

  const nodes = new Map<string, NodeBox>();
  for (const node of graph.nodes) {
    const n = g.node(node.id);
    nodes.set(node.id, { x: n.x - n.width / 2, y: n.y - n.height / 2, width: n.width, height: n.height });
  }
  const edges = new Map<string, Point[]>();
  for (const edge of graph.edges) {
    const e = g.edge({ v: edge.source, w: edge.target, name: edge.id });
    const points = (e?.points ?? []) as Point[];
    edges.set(edge.id, points.slice(1, -1));
  }
  const size = g.graph();
  return { nodes, edges, width: size.width ?? 0, height: size.height ?? 0 };
}
