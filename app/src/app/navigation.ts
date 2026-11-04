import type { ComponentType } from "react";
import { Layers, Trophy, Settings } from "lucide-react";
import { PodIcon } from "../components/PodIcon";
import { useResults } from "../results/results";
import { isDesktop } from "../components/Split";

/** An athlete's page on the phone (`/results/athlete` redirects to the selection on desktop). */
export const athleteUrl = (id: string | null) => `/results/athlete?id=${id ?? "none"}`;
/** The Results list with an athlete selected (desktop: the list left, the athlete right). */
export const selectUrl = (id: string | null) => `/results?athlete=${id ?? "none"}`;
/** Where a link to an athlete goes on this screen size. */
export const athleteLinkUrl = (id: string | null) => (isDesktop() ? selectUrl(id) : athleteUrl(id));

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

/**
 * Sub-pages: header title and back target. Their tab stays highlighted by the path prefix (/set highlights none).
 * `back` is an explicit parent, computed from the current query when it depends on it (never history(-1)).
 */
export type SubPage = { titleKey: string; back: string | ((params: URLSearchParams) => string) };

export const SUBPAGES: Record<string, SubPage> = {
  "/set": { titleKey: "nav.set", back: "/train" },
  "/set/menu": { titleKey: "nav.menu", back: "/set" },
  "/games/game": { titleKey: "nav.games", back: "/games" },
  "/games/new": { titleKey: "nav.games", back: "/games" },
  "/results/athlete": { titleKey: "nav.results", back: "/results" },
  "/results/session": {
    titleKey: "nav.results",
    // a session goes back to its athlete, else to Results
    back: (params) => {
      const session = useResults.getState().sessions.find((s) => s.id === params.get("id"));
      return session ? athleteLinkUrl(session.athleteId) : "/results";
    },
  },
  "/login": { titleKey: "nav.results", back: "/results" },
};

export function backOf(sub: SubPage, search: string): string {
  return typeof sub.back === "string" ? sub.back : sub.back(new URLSearchParams(search));
}

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

/** The three former game routes now open the game page in this mode (query kept). */
export const GAME_MODE_REDIRECTS = { "/games/view": "about", "/games/edit": "edit", "/games/try": "try" } as const;
