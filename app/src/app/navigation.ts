import type { ComponentType } from "react";
import { Layers, Workflow, Play, ListOrdered, Trophy, Settings } from "lucide-react";
import { PodIcon } from "../components/PodIcon";

export type NavItem = {
  path: string;
  labelKey: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  /** shown in the floating tab bar on phones (five at most); Menu is linked from the Pod page, Settings from the header */
  primary: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { path: "/pod", labelKey: "nav.pod", icon: PodIcon, primary: true },
  { path: "/programs", labelKey: "nav.programs", icon: Layers, primary: true },
  { path: "/editor", labelKey: "nav.editor", icon: Workflow, primary: true },
  { path: "/simulate", labelKey: "nav.simulate", icon: Play, primary: true },
  { path: "/menu", labelKey: "nav.menu", icon: ListOrdered, primary: false },
  { path: "/results", labelKey: "nav.results", icon: Trophy, primary: true },
  { path: "/settings", labelKey: "nav.settings", icon: Settings, primary: false },
];

export const DEFAULT_PATH = "/programs";

/** The tab of a page that is not in NAV_ITEMS: the training view (#46) belongs to the Pod tab. */
export function tabOfRoute(pathname: string): string | undefined {
  return pathname.startsWith("/training") ? "/pod" : undefined;
}
