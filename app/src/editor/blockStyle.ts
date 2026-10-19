import { Lightbulb, Timer, CircleDot, GitBranch, Variable, Radio, RadioTower, PowerOff, Sigma, Box, type LucideIcon } from "lucide-react";
import { blockType, type BlockCategory } from "@reactpod/program-model";

/** Icon per block type; colour per category (CSS variables in editor.css). */
const ICONS: Record<string, LucideIcon> = {
  led: Lightbulb,
  delay: Timer,
  button: CircleDot,
  if: GitBranch,
  setVariable: Variable,
  remotePress: Radio,
  remoteMultiPress: RadioTower,
  remoteResetAll: PowerOff,
  summary: Sigma,
};

export function blockIcon(type: unknown): LucideIcon {
  return (typeof type === "string" && ICONS[type]) || Box;
}

export function blockCategory(type: unknown): BlockCategory | "unknown" {
  return blockType(type)?.category ?? "unknown";
}
