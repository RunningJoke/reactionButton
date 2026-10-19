import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Flag, Lock, OctagonX, Unlink } from "lucide-react";
import "./editor.css";
import { colorToRgb } from "@reactpod/program-model";
import type { GraphNode, ProgramGraph } from "../model/graph";
import { blockCategory, blockIcon } from "./blockStyle";
import { columnLayout, type Side, type SideArrow } from "./columnLayout";
import { blockSummary } from "./summary";

/** distance of the first lane from the column, and between lanes */
const LANE_OFFSET = 10;
const LANE_GAP = 10;
const EDGE_GUTTER = 8;
const RADIUS = 5;

type Props = {
  graph: ProgramGraph;
  selected?: string | null;
  /** block that is running (simulator) */
  active?: string | null;
  /** block the simulator came from: the arrow previous → active is animated */
  previous?: string | null;
  /** blocks with a breakpoint (simulator) */
  breakpoints?: ReadonlySet<string>;
  onSelect?: (id: string | null) => void;
};

type Geometry = {
  left: number;
  right: number;
  /** header centre per node id */
  entry: Record<string, number>;
  /** port row centre per edge id */
  exit: Record<string, number>;
};

const gutter = (lanes: number) => (lanes === 0 ? EDGE_GUTTER : LANE_OFFSET + (lanes - 1) * LANE_GAP + EDGE_GUTTER);

/**
 * Read-only block graph as one column of cards. Blocks that simply continue to the block below
 * are stacked without an arrow; choices and jumps are arrows beside the column (see columnLayout).
 */
export function ProgramColumnView({ graph, selected, active, previous, breakpoints, onSelect }: Props) {
  const layout = useMemo(() => columnLayout(graph), [graph]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const arrowsBySource = useMemo(() => {
    const map = new Map<string, SideArrow[]>();
    for (const a of layout.arrows) map.set(a.edge.source, [...(map.get(a.edge.source) ?? []), a]);
    return map;
  }, [layout]);

  const content = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);

  const measure = useCallback(() => {
    const root = content.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const column = root.querySelector<HTMLElement>(".rp-cards")!.getBoundingClientRect();
    const next: Geometry = { left: column.left - box.left, right: column.right - box.left, entry: {}, exit: {} };
    for (const el of root.querySelectorAll<HTMLElement>("[data-entry]")) {
      const r = el.getBoundingClientRect();
      next.entry[el.dataset.entry!] = r.top + r.height / 2 - box.top;
    }
    for (const el of root.querySelectorAll<HTMLElement>("[data-exit]")) {
      const r = el.getBoundingClientRect();
      next.exit[el.dataset.exit!] = r.top + r.height / 2 - box.top;
    }
    setGeometry((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, []);

  useLayoutEffect(measure, [measure, layout, selected]);
  useEffect(() => {
    const root = content.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  // keep the selected block in view (also when picked from the issues or the block sheet)
  useEffect(() => {
    if (!selected) return;
    const card = content.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(selected)}"]`);
    card?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  // follow the running block (simulator), only inside a panel marked data-scroll-follow, never the page
  useEffect(() => {
    if (!active) return;
    const card = content.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(active)}"]`);
    const panel = card?.closest<HTMLElement>("[data-scroll-follow]");
    if (!card || !panel) return;
    const box = [card.closest<HTMLElement>(".rp-column-scroll"), panel].find((el) => el && el.scrollHeight > el.clientHeight);
    if (!box) return;
    const c = card.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (c.top < b.top) box.scrollTop -= b.top - c.top + 8;
    else if (c.bottom > b.bottom) box.scrollTop += c.bottom - b.bottom + 8;
  }, [active]);

  return (
    <div className="rp-column-scroll" data-sheet={selected ? true : undefined} onClick={() => onSelect?.(null)}>
      <div
        ref={content}
        className="rp-column"
        style={{ paddingLeft: gutter(layout.lanes.left), paddingRight: gutter(layout.lanes.right) }}
      >
        <ol className="rp-cards">
          {layout.order.map((id) => (
            <li key={id} className="rp-card-slot" data-joined={layout.joined.has(id) || undefined}>
              <BlockCard
                node={byId.get(id)!}
                arrows={arrowsBySource.get(id) ?? []}
                joinedPort={layout.joined.has(id) ? byId.get(id)!.ports[0] : undefined}
                selected={id === selected}
                active={id === active}
                breakpoint={breakpoints?.has(id) ?? false}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ol>
        {geometry && <Arrows arrows={layout.arrows} geometry={geometry} selected={selected} active={active} previous={previous} />}
      </div>
    </div>
  );
}

function Arrows({
  arrows,
  geometry,
  selected,
  active,
  previous,
}: {
  arrows: SideArrow[];
  geometry: Geometry;
  selected?: string | null;
  active?: string | null;
  previous?: string | null;
}) {
  const id = useId().replace(/:/g, "");
  // highlighted arrows are drawn last, on top
  const sorted = [...arrows].sort((a, b) => Number(isLit(a, selected, active)) - Number(isLit(b, selected, active)));
  return (
    <svg className="rp-arrows" aria-hidden>
      <defs>
        {["plain", "lit"].map((kind) => (
          <marker key={kind} id={`${id}-${kind}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" className={`rp-arrowhead-${kind}`} />
          </marker>
        ))}
      </defs>
      {sorted.map((arrow) => {
        const exit = geometry.exit[arrow.edge.id];
        const entry = geometry.entry[arrow.edge.target];
        if (exit === undefined || entry === undefined) return null;
        const lit = isLit(arrow, selected, active);
        return (
          <path
            key={arrow.edge.id}
            d={arrowPath(arrow.side, arrow.lane, exit, entry, geometry)}
            className="rp-arrow"
            data-lit={lit || undefined}
            data-taken={(previous && arrow.edge.source === previous && arrow.edge.target === active) || undefined}
            markerEnd={`url(#${id}-${lit ? "lit" : "plain"})`}
          />
        );
      })}
    </svg>
  );
}

function isLit(arrow: SideArrow, selected?: string | null, active?: string | null) {
  return arrow.edge.source === active || (!!selected && (arrow.edge.source === selected || arrow.edge.target === selected));
}

function arrowPath(side: Side, lane: number, exit: number, entry: number, g: Geometry): string {
  const dir = side === "right" ? 1 : -1;
  const edge = side === "right" ? g.right : g.left;
  const x = edge + dir * (LANE_OFFSET + lane * LANE_GAP);
  const points = [
    { x: edge, y: exit },
    { x, y: exit },
    { x, y: entry },
    { x: edge + dir, y: entry },
  ];
  return roundedPath(points);
}

type Point = { x: number; y: number };

function roundedPath(points: Point[]): string {
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [prev, cur, next] = [points[i - 1]!, points[i]!, points[i + 1]!];
    const r = Math.min(RADIUS, dist(prev, cur) / 2, dist(cur, next) / 2);
    const a = toward(cur, prev, r);
    const b = toward(cur, next, r);
    d += ` L ${a.x} ${a.y} Q ${cur.x} ${cur.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L ${last.x} ${last.y}`;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function toward(from: Point, to: Point, r: number): Point {
  const d = dist(from, to) || 1;
  return { x: from.x + ((to.x - from.x) / d) * r, y: from.y + ((to.y - from.y) / d) * r };
}

type CardProps = {
  node: GraphNode;
  arrows: SideArrow[];
  /** port that continues straight down (no arrow) */
  joinedPort?: string;
  selected: boolean;
  active: boolean;
  breakpoint?: boolean;
  onSelect?: (id: string | null) => void;
};

/** One block: header with icon, name and type, key parameters, one row per outgoing arrow. */
const BlockCard = memo(function BlockCard({ node, arrows, joinedPort, selected, active, breakpoint, onSelect }: CardProps) {
  const { t } = useTranslation();
  const block = node.block;
  const Icon = node.external ? Unlink : blockIcon(block?.type);
  const parts = block ? blockSummary(block, t) : [];

  return (
    <button
      type="button"
      className="rp-card"
      data-card={node.id}
      data-category={node.external ? "external" : blockCategory(block?.type)}
      data-own={node.own || undefined}
      data-unreachable={node.unreachable || undefined}
      data-selected={selected || undefined}
      data-active={active || undefined}
      data-breakpoint={breakpoint || undefined}
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(node.id);
      }}
    >
      <span className="rp-card-header" data-entry={node.id}>
        <Icon size={16} aria-hidden />
        <span className="rp-card-name">{node.id}</span>
        {breakpoint && <span className="rp-breakpoint" role="img" aria-label={t("graph.breakpoint")} />}
        {node.start && <Flag size={14} aria-label={t("graph.start")} className="rp-flag" />}
        {!node.own && !node.external && <Lock size={12} aria-label={t("graph.locked")} />}
        {node.ends && !node.external && <OctagonX size={14} aria-label={t("graph.ends")} className="rp-end" />}
        <span className="rp-card-type">
          {node.external
            ? t("graph.external")
            : t(`blocks.${block?.type}.name`, { defaultValue: String(block?.type) }) + (node.own ? "" : ` · ${fileLabel(node.file)}`)}
        </span>
      </span>
      {(parts.length > 0 || node.fallbackPorts.length > 0) && (
        <span className="rp-card-body">
          {parts.map((part, i) =>
            part.kind === "color" ? (
              <span key={i} className="rp-card-line">
                <span className="rp-swatch" style={{ background: `rgb(${colorToRgb(part.color).join(",")})` }} />
                {part.label}
              </span>
            ) : (
              <span key={i} className="rp-card-line">
                {part.text}
              </span>
            ),
          )}
          {node.fallbackPorts.length > 0 && (
            <span className="rp-card-hint">{t("graph.fallback", { ports: node.fallbackPorts.map((p) => t(`ports.${p}`)).join(", ") })}</span>
          )}
        </span>
      )}
      {arrows.length > 0 && (
        <span className="rp-card-ports">
          {arrows.map((arrow) => (
            <span key={arrow.edge.id} className="rp-port-row" data-side={arrow.side} data-exit={arrow.edge.id}>
              {arrow.edge.port !== "next" && <span className="rp-port">{t(`ports.${arrow.edge.port}`)}</span>}
              <span className="rp-port-target">→ {arrow.edge.target}</span>
            </span>
          ))}
        </span>
      )}
      {/* continuing straight down through a port other than "next": name the port, a press etc. still matters */}
      {joinedPort && joinedPort !== "next" && (
        <span className="rp-card-ports">
          <span className="rp-port-row" data-side="down">
            <span className="rp-port">{t(`ports.${joinedPort}`)}</span>
            <span className="rp-port-target">↓</span>
          </span>
        </span>
      )}
    </button>
  );
});

/** "/prog/lib/loop.json" → "loop" */
function fileLabel(path: string) {
  return path.split("/").pop()!.replace(/\.json$/, "");
}
