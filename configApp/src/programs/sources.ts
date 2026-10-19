import { useMemo } from "react";
import { DEFAULT_FILES } from "../defaults";
import { usePodSession } from "../pod/session";
import { localFiles, useWorkspace } from "../store/workspace";
import { menuOf } from "./catalog";

/** Where a program comes from: the connected pod, the shipped defaults or the user's own ("local"). */
export type SourceId = "pod" | "shipped" | "local";

export type ProgramSource = {
  id: SourceId;
  /** the files of this source (for listing) */
  files: Readonly<Record<string, string>>;
  /** reads a file for resolving includes; local programs fall back to the pod and the shipped files */
  read: (path: string) => string | undefined;
  /** block types the target can run (pod only) */
  supportedTypes?: readonly string[];
  available: boolean;
};

export function useProgramSource(id: SourceId): ProgramSource {
  const files = usePodSession((s) => s.files);
  const info = usePodSession((s) => s.info);
  const connected = usePodSession((s) => s.state === "connected");
  const programs = useWorkspace((s) => s.programs);
  const local = useMemo(() => localFiles(programs), [programs]);
  return useMemo(() => {
    if (id === "pod") return { id, files, read: (p) => files[p], supportedTypes: info?.blockTypes, available: connected };
    if (id === "local") {
      return {
        id,
        files: local,
        read: (p) => local[p] ?? (connected ? files[p] : undefined) ?? DEFAULT_FILES[p],
        supportedTypes: connected ? info?.blockTypes : undefined,
        available: true,
      };
    }
    return { id, files: DEFAULT_FILES, read: (p) => DEFAULT_FILES[p], available: true };
  }, [id, files, info, connected, local]);
}

/** The menu the user is building: the saved local menu, else the pod's, else the shipped one. */
export function useLocalMenu(): { menu: string[]; saved: boolean } {
  const saved = useWorkspace((s) => s.menu);
  const podMenu = usePodSession((s) => (s.state === "connected" ? s.list?.menu : undefined));
  return useMemo(() => {
    if (saved) return { menu: saved, saved: true };
    if (podMenu) return { menu: podMenu, saved: false };
    return { menu: menuOf((p) => DEFAULT_FILES[p]), saved: false };
  }, [saved, podMenu]);
}

export function viewUrl(source: SourceId, path: string): string {
  return `/programs/view?source=${source}&path=${encodeURIComponent(path)}`;
}

export function editorUrl(id: string): string {
  return `/editor?id=${encodeURIComponent(id)}`;
}
