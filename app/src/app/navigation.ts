import type { ComponentType } from "react";
import { Layers, Trophy, Settings } from "lucide-react";
import { PodIcon } from "../components/PodIcon";

export type NavItem = {
  path: string;
  labelKey: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  /** shown in the floating tab bar on phones; Settings is reached from the header gear */
  primary: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { path: "/train", labelKey: "nav.train", icon: PodIcon, primary: true },
  { path: "/games", labelKey: "nav.games", icon: Layers, primary: true },
  { path: "/results", labelKey: "nav.results", icon: Trophy, primary: true },
  { path: "/settings", labelKey: "nav.settings", icon: Settings, primary: false },
];

export const DEFAULT_PATH = "/train";

/** Sub-pages: header title and back target. Their tab stays highlighted by the path prefix (/set highlights none). */
export const SUBPAGES: Record<string, { titleKey: string; back: string }> = {
  "/set": { titleKey: "nav.set", back: "/train" },
  "/set/menu": { titleKey: "nav.menu", back: "/set" },
  "/games/view": { titleKey: "nav.games", back: "/games" },
  "/games/new": { titleKey: "nav.games", back: "/games" },
  "/games/edit": { titleKey: "nav.editor", back: "/games" },
  "/games/try": { titleKey: "nav.simulate", back: "/games" },
  "/results/athlete": { titleKey: "nav.results", back: "/results" },
  "/results/session": { titleKey: "nav.results", back: "/results" },
  "/login": { titleKey: "nav.results", back: "/results" },
};

/** Old links and bookmarks (query strings are kept by the redirect). */
export const REDIRECTS: Record<string, string> = {
  "/pod": "/set",
  "/training": "/train",
  "/programs": "/games",
  "/programs/view": "/games/view",
  "/programs/new": "/games/new",
  "/editor": "/games/edit",
  "/simulate": "/games/try",
  "/menu": "/set/menu",
};
