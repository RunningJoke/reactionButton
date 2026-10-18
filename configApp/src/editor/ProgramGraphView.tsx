import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Background, Controls, MarkerType, ReactFlow, type EdgeTypes, type NodeTypes, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./editor.css";
import type { ProgramGraph } from "../model/graph";
import { BlockNode, summaryLines, type BlockFlowNode } from "./BlockNode";
import { layoutGraph, nodeHeight, NODE_WIDTH } from "./layout";
import { RoutedEdge, type RoutedFlowEdge } from "./RoutedEdge";

const nodeTypes: NodeTypes = { block: BlockNode };
const edgeTypes: EdgeTypes = { routed: RoutedEdge };

/** Below this zoom block texts get hard to read; tall programs are scrolled instead. */
const MIN_READABLE_ZOOM = 0.55;

type Props = {
  graph: ProgramGraph;
  selected?: string | null;
  /** block that is running (simulator) */
  active?: string | null;
  onSelect?: (id: string | null) => void;
};

/** Read-only block graph with automatic layout. Opens at the top, fitted to the width. */
export function ProgramGraphView({ graph, selected, active, onSelect }: Props) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return layoutGraph(graph, (id) => {
      const node = byId.get(id)!;
      return nodeHeight(summaryLines(node, t), node.fallbackPorts.length > 0);
    });
  }, [graph, t]);

  const nodes = useMemo<BlockFlowNode[]>(
    () =>
      graph.nodes.map((node) => {
        const box = layout.nodes.get(node.id)!;
        return {
          id: node.id,
          type: "block",
          position: { x: box.x, y: box.y },
          data: { node, active: node.id === active },
          style: { width: NODE_WIDTH, height: box.height },
          width: NODE_WIDTH,
          height: box.height,
          selected: node.id === selected,
          draggable: false,
          connectable: false,
        };
      }),
    [graph, layout, selected, active],
  );

  const edges = useMemo<RoutedFlowEdge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        type: "routed",
        source: edge.source,
        sourceHandle: edge.port,
        target: edge.target,
        data: {
          points: layout.edges.get(edge.id) ?? [],
          label: edge.port === "next" ? undefined : t(`ports.${edge.port}`),
          active: edge.source === active,
        },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        selectable: false,
      })),
    [graph, layout, t, active],
  );

  /** Whole graph if it fits readably, else fitted to the width (or readable zoom) from the top. */
  const placeView = useCallback(
    (flow: ReactFlowInstance<BlockFlowNode, RoutedFlowEdge>) => {
      const el = container.current;
      if (!el || layout.width === 0) return;
      const { width, height } = el.getBoundingClientRect();
      const fitAll = Math.min(1, width / layout.width, height / layout.height);
      if (fitAll >= MIN_READABLE_ZOOM) {
        void flow.fitView({ padding: 0.08, maxZoom: 1 });
        return;
      }
      const zoom = Math.max(MIN_READABLE_ZOOM, Math.min(1, width / layout.width));
      void flow.setViewport({ x: Math.max(0, (width - layout.width * zoom) / 2), y: 0, zoom });
    },
    [layout],
  );

  return (
    <div className="rp-graph" ref={container}>
      <ReactFlow
        key={graph.start ?? graph.nodes[0]?.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode="system"
        onInit={placeView}
        minZoom={0.15}
        maxZoom={2}
        panOnScroll
        zoomOnPinch
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        onNodeClick={(_, node) => onSelect?.(node.id)}
        onPaneClick={() => onSelect?.(null)}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} position="top-right" />
      </ReactFlow>
    </div>
  );
}
