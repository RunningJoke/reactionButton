import { Radio, Layers, Workflow, Play, ListOrdered, Settings, type LucideIcon } from "lucide-react";

export type NavItem = {
  path: string;
  labelKey: string;
  icon: LucideIcon;
  /** shown in the bottom tab bar on phones; the rest is reachable from the header */
  primary: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { path: "/pod", labelKey: "nav.pod", icon: Radio, primary: true },
  { path: "/programs", labelKey: "nav.programs", icon: Layers, primary: true },
  { path: "/editor", labelKey: "nav.editor", icon: Workflow, primary: true },
  { path: "/simulate", labelKey: "nav.simulate", icon: Play, primary: true },
  { path: "/menu", labelKey: "nav.menu", icon: ListOrdered, primary: true },
  { path: "/settings", labelKey: "nav.settings", icon: Settings, primary: false },
];

export const DEFAULT_PATH = "/programs";
