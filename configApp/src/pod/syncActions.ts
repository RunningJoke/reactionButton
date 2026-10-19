/**
 * Sync as the UI uses it: the states of the connected set, take over / keep mine, push,
 * restore defaults and delete. Ties `sync.ts` to the pod session and the workspace.
 */
import { useEffect, useMemo } from "react";
import { INDEX_PATH } from "../model/limits";
import { fileCache } from "../store/fileCache";
import { useWorkspace } from "../store/workspace";
import { PodError } from "./protocol";
import { hasFeature, isReadOnly, usePodSession } from "./session";
import { executePush, syncStates, type FileSync, type PushPlan, type PushResult, type PushStep } from "./sync";

/** States of all files of the connected set; `null` while not connected or files are still loading. */
export function useSyncStates(): FileSync[] | null {
  const { state, info, list, files, loading } = usePodSession();
  const { programs, menu, sync, loadSync } = useWorkspace();
  const setId = state === "connected" ? info?.setId : undefined;

  useEffect(() => {
    if (setId) void loadSync(setId);
  }, [setId, loadSync]);

  return useMemo(() => {
    if (!setId || !list || loading || sync?.setId !== setId) return null;
    return syncStates({ programs, menu, list, podFiles: files, base: sync.files });
  }, [setId, list, loading, sync, programs, menu, files]);
}

function connected() {
  const session = usePodSession.getState();
  if (!session.client || !session.info || !session.list) throw new PodError("disconnected", "not connected");
  return { session, client: session.client, info: session.info, list: session.list };
}

function baseOf(state: FileSync) {
  return state.pod ? { crc: state.pod.crc, size: state.pod.size } : null;
}

/** "Take over" / "keep pod": the local copy becomes the pod's file. */
export async function keepPod(state: FileSync) {
  const { session, info } = connected();
  const workspace = useWorkspace.getState();
  if (state.path === INDEX_PATH) {
    await workspace.setMenu(undefined);
  } else if (state.doc) {
    const text = session.files[state.path];
    if (text === undefined) throw new PodError("not_found", `${state.path} is not loaded`);
    await workspace.save({ ...state.doc, json: JSON.parse(text) as Record<string, unknown> });
  }
  await workspace.recordSync(info.setId, { [state.path]: baseOf(state) });
}

/** "Keep mine": the pod's current file counts as seen, so the local file is pushed over it. */
export async function keepMine(state: FileSync) {
  const { info } = connected();
  await useWorkspace.getState().recordSync(info.setId, { [state.path]: baseOf(state) });
}

/** Remembers the pod's file as the base of a local copy that was just made from it. */
export async function rememberPodBase(path: string) {
  const session = usePodSession.getState();
  const entry = session.list?.files.find((f) => f.path === path);
  if (session.state !== "connected" || !session.info || !entry) return;
  await useWorkspace.getState().recordSync(session.info.setId, { [path]: { crc: entry.crc, size: entry.size } });
}

/** Writes are possible: a central, files loaded. */
export function canWrite(): boolean {
  const session = usePodSession.getState();
  return session.state === "connected" && !isReadOnly(session) && !session.loading;
}

/**
 * Runs a push plan (README §9.3) and remembers the sync state of every uploaded file at once,
 * so an interrupted push leaves the states right. The session is re-read afterwards, also on errors.
 */
export async function runPush(plan: PushPlan, onStep?: (step: PushStep) => void): Promise<PushResult> {
  const { session, client, info } = connected();
  const texts = new Map(plan.uploads.map((u) => [u.path, u.text]));
  try {
    return await executePush(client, plan, {
      dryRun: hasFeature(info, "validateInline"),
      maxRequest: info.maxRequest,
      onStep,
      onUploaded: async (path, base) => {
        await useWorkspace.getState().recordSync(info.setId, { [path]: base });
        await fileCache.put(texts.get(path)!); // no download after the refresh
      },
    });
  } finally {
    await session.refresh();
  }
}

/** Deletes files on the pod (Settings → Advanced, README §9.4). */
export async function deleteFiles(paths: readonly string[], onDone?: (path: string) => void) {
  const { session, client, info } = connected();
  try {
    for (const path of paths) {
      await client.delete(path);
      await useWorkspace.getState().recordSync(info.setId, { [path]: null });
      onDone?.(path);
    }
  } finally {
    await session.refresh();
  }
}
