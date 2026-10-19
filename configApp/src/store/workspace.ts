/**
 * The user's local programs and menu: the set they are building. Everything is saved at once,
 * so nothing is lost when the app is closed. Also the sync state per pod set (README §9.2).
 */
import { create } from "zustand";
import { formatProgram } from "../model/format";
import { pathForName } from "../model/limits";
import { isObject } from "../model/program";
import { createStorage, type ProgramDoc, type Storage, type SyncBase, type SyncState } from "./programStore";

type Workspace = {
  loaded: boolean;
  programs: ProgramDoc[];
  /** undefined until the user changes the menu (then the pod's or the shipped menu is shown) */
  menu: string[] | undefined;
  storage: Storage;
  /** sync state of the connected set, see `loadSync` */
  sync: SyncState | null;

  load: () => Promise<void>;
  /** saves a changed program document (updates `updatedAt`) */
  save: (doc: ProgramDoc) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** `undefined` forgets the local menu */
  setMenu: (menu: string[] | undefined) => Promise<void>;
  /** reads the sync state of a set (empty if never synced) */
  loadSync: (setId: string) => Promise<SyncState>;
  /** remembers the common state of files (`null` forgets a file, e.g. after delete) */
  recordSync: (setId: string, files: Record<string, SyncBase | null>) => Promise<void>;
  /** adds a program; the path is made unique against `taken` and the local programs */
  add: (json: Record<string, unknown>, origin: ProgramDoc["origin"], options?: { path?: string; taken?: Iterable<string> }) => Promise<ProgramDoc>;
};

export const useWorkspace = create<Workspace>((set, get) => ({
  loaded: false,
  programs: [],
  menu: undefined,
  storage: createStorage(),
  sync: null,

  async load() {
    if (get().loaded) return;
    const { storage } = get();
    try {
      const [programs, menu] = await Promise.all([storage.listPrograms(), storage.getMenu()]);
      set({ programs: programs.sort((a, b) => b.updatedAt - a.updatedAt), menu, loaded: true });
    } catch {
      set({ loaded: true }); // storage blocked (private mode): work in memory
    }
  },

  async save(doc) {
    const saved = { ...doc, updatedAt: Date.now() };
    set((s) => ({ programs: [saved, ...s.programs.filter((p) => p.id !== doc.id)] }));
    await get().storage.saveProgram(saved);
  },

  async remove(id) {
    set((s) => ({ programs: s.programs.filter((p) => p.id !== id) }));
    await get().storage.deleteProgram(id);
  },

  async setMenu(menu) {
    set({ menu });
    await get().storage.saveMenu(menu);
  },

  async loadSync(setId) {
    const current = get().sync;
    if (current?.setId === setId) return current;
    let state: SyncState = { setId, files: {} };
    try {
      state = (await get().storage.getSyncState(setId)) ?? state;
    } catch {
      // storage blocked: start empty
    }
    set({ sync: state });
    return state;
  },

  async recordSync(setId, files) {
    const base = await get().loadSync(setId);
    const next: SyncState = { setId, files: { ...base.files } };
    for (const [path, entry] of Object.entries(files)) {
      if (entry) next.files[path] = { crc: entry.crc.toLowerCase(), size: entry.size };
      else delete next.files[path];
    }
    set({ sync: next });
    try {
      await get().storage.saveSyncState(next);
    } catch {
      // kept in memory
    }
  },

  async add(json, origin, options = {}) {
    const taken = new Set([...get().programs.map((p) => p.path), ...(options.taken ?? [])]);
    const path = options.path ?? pathForName(typeof json.name === "string" ? json.name : "program", taken);
    const doc: ProgramDoc = { id: crypto.randomUUID(), path, json, origin, updatedAt: Date.now() };
    await get().save(doc);
    return doc;
  },
}));

/** Local programs as store files (path → formatted text), for validation and the catalog. */
export function localFiles(programs: readonly ProgramDoc[]): Record<string, string> {
  return Object.fromEntries(programs.map((p) => [p.path, formatProgram(p.json)]));
}

/** Parses an imported program file. Throws when it is not a program (needs a `name`). */
export function parseProgramText(text: string): Record<string, unknown> {
  const json = JSON.parse(text) as unknown;
  if (!isObject(json) || typeof json.name !== "string") throw new Error("not a program");
  return json;
}
