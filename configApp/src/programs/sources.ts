import { DEFAULT_FILES } from "../defaults";
import { usePodSession } from "../pod/session";

/** Where a program comes from. Local programs ("mine") follow with the editor (P4). */
export type SourceId = "pod" | "shipped";

export type ProgramSource = {
  id: SourceId;
  files: Readonly<Record<string, string>>;
  /** block types the target can run (pod only) */
  supportedTypes?: readonly string[];
  available: boolean;
};

export function useProgramSource(id: SourceId): ProgramSource {
  const files = usePodSession((s) => s.files);
  const info = usePodSession((s) => s.info);
  const connected = usePodSession((s) => s.state === "connected");
  if (id === "pod") return { id, files, supportedTypes: info?.blockTypes, available: connected };
  return { id, files: DEFAULT_FILES, available: true };
}

export function viewUrl(source: SourceId, path: string): string {
  return `/programs/view?source=${source}&path=${encodeURIComponent(path)}`;
}
