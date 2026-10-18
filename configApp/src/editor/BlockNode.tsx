import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { Flag, Lock, OctagonX, Unlink } from "lucide-react";
import { colorToRgb } from "../model/colors";
import type { GraphNode } from "../model/graph";
import { blockCategory, blockIcon } from "./blockStyle";
import { blockSummary } from "./summary";

export type BlockNodeData = { node: GraphNode; active?: boolean };
export type BlockFlowNode = Node<BlockNodeData, "block">;

/** One block: header with icon and name, key parameters, one output handle per connected port. */
export const BlockNode = memo(function BlockNode({ data, selected }: NodeProps<BlockFlowNode>) {
  const { t } = useTranslation();
  const { node, active } = data;
  const block = node.block;
  const Icon = node.external ? Unlink : blockIcon(block?.type);
  const parts = block ? blockSummary(block, t) : [];

  return (
    <div
      className="rp-node"
      data-category={node.external ? "external" : blockCategory(block?.type)}
      data-own={node.own || undefined}
      data-unreachable={node.unreachable || undefined}
      data-selected={selected || undefined}
      data-active={active || undefined}
    >
      <Handle type="target" position={Position.Top} className="rp-handle" isConnectable={false} />
      <div className="rp-node-header">
        <Icon size={16} aria-hidden />
        <span className="rp-node-name" title={node.id}>
          {node.id}
        </span>
        {node.start && <Flag size={14} aria-label={t("graph.start")} className="rp-flag" />}
        {!node.own && !node.external && <Lock size={12} aria-label={t("graph.locked")} />}
      </div>
      <div className="rp-node-body">
        {node.external ? (
          <span className="rp-node-muted">{t("graph.external")}</span>
        ) : (
          <>
            <span className="rp-node-type">
              {t(`blocks.${block?.type}.name`, { defaultValue: String(block?.type) })}
              {!node.own && ` · ${fileLabel(node.file)}`}
            </span>
            {parts.map((part, i) =>
              part.kind === "color" ? (
                <span key={i} className="rp-node-line">
                  <span className="rp-swatch" style={{ background: `rgb(${colorToRgb(part.color).join(",")})` }} />
                  {part.label}
                </span>
              ) : (
                <span key={i} className="rp-node-line">
                  {part.text}
                </span>
              ),
            )}
            {node.fallbackPorts.length > 0 && (
              <span className="rp-node-hint">{t("graph.fallback", { ports: node.fallbackPorts.map((p) => t(`ports.${p}`)).join(", ") })}</span>
            )}
          </>
        )}
      </div>
      {node.ends && !node.external && (
        <span className="rp-end" title={t("graph.ends")}>
          <OctagonX size={14} aria-label={t("graph.ends")} />
        </span>
      )}
      {node.ports.map((port, i) => (
        <Handle
          key={port}
          id={port}
          type="source"
          position={Position.Bottom}
          className="rp-handle"
          isConnectable={false}
          style={{ left: `${((i + 1) / (node.ports.length + 1)) * 100}%` }}
        />
      ))}
    </div>
  );
});

/** "/prog/lib/loop.json" → "loop" */
function fileLabel(path: string) {
  return path.split("/").pop()!.replace(/\.json$/, "");
}

/** Lines of the summary, for the layout height. */
export function summaryLines(node: GraphNode, t: (key: string) => string): number {
  if (!node.block) return 1;
  return 1 + blockSummary(node.block, t).length;
}
