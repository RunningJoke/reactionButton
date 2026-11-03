import { useMemo } from "react";
import type { ValidateOptions } from "@reactpod/program-model";
import { DEFAULT_FILES } from "../defaults";
import type { InfoResponse } from "../pod/protocol";
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
  /**
   * `info.programFormat` of the connected pod (missing → 1, firmware before 2.3); undefined
   * without a pod (no limit). Blocks of a newer format are errors, fields of a newer one warnings.
   */
  programFormat?: number;
  available: boolean;
};

/** The program format a connected pod runs: `info.programFormat`, 1 when the firmware does not report it. */
export function podProgramFormat(info: Pick<InfoResponse, "programFormat"> | null | undefined): number | undefined {
  return info ? (info.programFormat ?? 1) : undefined;
}

/** What `validateProgram` needs to check a program against the source's target pod. */
export function validateOptionsOf(source: Pick<ProgramSource, "supportedTypes" | "programFormat">): ValidateOptions {
  return { supportedTypes: source.supportedTypes, programFormat: source.programFormat };
}

export function useProgramSource(id: SourceId): ProgramSource {
  const files = usePodSession((s) => s.files);
  const info = usePodSession((s) => s.info);
  const connected = usePodSession((s) => s.state === "connected");
  const programs = useWorkspace((s) => s.programs);
  const local = useMemo(() => localFiles(programs), [programs]);
  return useMemo(() => {
    const programFormat = connected ? podProgramFormat(info) : undefined;
    if (id === "pod") return { id, files, read: (p) => files[p], supportedTypes: info?.blockTypes, programFormat, available: connected };
    if (id === "local") {
      return {
        id,
        files: local,
        read: (p) => local[p] ?? (connected ? files[p] : undefined) ?? DEFAULT_FILES[p],
        supportedTypes: connected ? info?.blockTypes : undefined,
        programFormat,
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

/** A game: one of my games (`id`) or a program of a source. */
export type GameTarget = { id: string } | { source: SourceId; path: string };
export type GameMode = "about" | "edit" | "try";
export const GAME_MODES: readonly GameMode[] = ["about", "edit", "try"];

/** The game page (docs/app/spec.md §3): About, Edit and Try are modes of one game. */
export function gameUrl(target: GameTarget, mode: GameMode = "about", block?: string): string {
  const which = "id" in target ? `id=${encodeURIComponent(target.id)}` : `source=${target.source}&path=${encodeURIComponent(target.path)}`;
  return `/games/game?${which}&mode=${mode}${block ? `&block=${encodeURIComponent(block)}` : ""}`;
}

/** Try with a local program (`id`) or a program of a source. */
export const simulateUrl = (target: GameTarget): string => gameUrl(target, "try");

export const viewUrl = (source: SourceId, path: string): string => gameUrl({ source, path });

/** Edit, optionally with a block selected (e.g. from a push error). */
export const editorUrl = (id: string, block?: string): string => gameUrl({ id }, "edit", block);
