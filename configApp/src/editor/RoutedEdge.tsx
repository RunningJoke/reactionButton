import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import type { Point } from "./layout";

export type RoutedEdgeData = { points: Point[]; label?: string; active?: boolean };
export type RoutedFlowEdge = Edge<RoutedEdgeData, "routed">;

const RADIUS = 10;

/** Path through the dagre route with rounded corners; ends at the handles React Flow reports. */
export function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, data, markerEnd, selected }: EdgeProps<RoutedFlowEdge>) {
  const points: Point[] = [{ x: sourceX, y: sourceY }, ...(data?.points ?? []), { x: targetX, y: targetY }];
  const path = roundedPath(points);
  const mid = points[Math.floor(points.length / 2)]!;
  const before = points[Math.floor(points.length / 2) - 1] ?? mid;
  const label = { x: (mid.x + before.x) / 2, y: (mid.y + before.y) / 2 };
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className="rp-edge"
        data-active={data?.active || undefined}
        data-selected={selected || undefined}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <div className="rp-edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)` }}>
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function roundedPath(points: Point[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;
    const r = Math.min(RADIUS, dist(prev, cur) / 2, dist(cur, next) / 2);
    const a = toward(cur, prev, r);
    const b = toward(cur, next, r);
    d += ` L ${a.x} ${a.y} Q ${cur.x} ${cur.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L ${last.x} ${last.y}`;
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toward(from: Point, to: Point, r: number): Point {
  const d = dist(from, to) || 1;
  return { x: from.x + ((to.x - from.x) / d) * r, y: from.y + ((to.y - from.y) / d) * r };
}
