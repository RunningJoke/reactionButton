/**
 * Local persistence of the user's programs and menu (docs/app/spec.md §6). Behind an interface, so a
 * native file store or a remote database can replace IndexedDB later.
 */
import { openDB, type IDBPDatabase } from "idb";

export type ProgramDoc = {
  /** local uuid */
  id: string;
  /** target path on the pod, e.g. "/prog/sprint.json" */
  path: string;
  /** exactly what goes to the pod (programs.md format) */
  json: Record<string, unknown>;
  /** where the program came from: made here, copied from the pod or from the shipped defaults */
  origin: "local" | "pod" | "default";
  updatedAt: number;
};

/** Last common state of a file on a pod set and in the app (docs/app/spec.md §6, §9.2). */
export type SyncBase = { crc: string; size: number };

/** Per pod set (setId), remembered after each push, take-over and copy from the pod. */
export type SyncState = {
  setId: string;
  files: Record<string, SyncBase>;
};

export interface Storage {
  listPrograms(): Promise<ProgramDoc[]>;
  saveProgram(doc: ProgramDoc): Promise<void>;
  deleteProgram(id: string): Promise<void>;
  /** the local menu (paths in /programs.json order); undefined until the user changed it */
  getMenu(): Promise<string[] | undefined>;
  /** `undefined` forgets the local menu (the pod's or the shipped menu is shown again) */
  saveMenu(menu: string[] | undefined): Promise<void>;
  getSyncState(setId: string): Promise<SyncState | undefined>;
  saveSyncState(state: SyncState): Promise<void>;
}

export class MemoryStorage implements Storage {
  private programs = new Map<string, ProgramDoc>();
  private menu: string[] | undefined;
  private sync = new Map<string, SyncState>();
  async listPrograms() {
    return [...this.programs.values()].map((d) => structuredClone(d));
  }
  async saveProgram(doc: ProgramDoc) {
    this.programs.set(doc.id, structuredClone(doc));
  }
  async deleteProgram(id: string) {
    this.programs.delete(id);
  }
  async getMenu() {
    return this.menu ? [...this.menu] : undefined;
  }
  async saveMenu(menu: string[] | undefined) {
    this.menu = menu ? [...menu] : undefined;
  }
  async getSyncState(setId: string) {
    const state = this.sync.get(setId);
    return state ? structuredClone(state) : undefined;
  }
  async saveSyncState(state: SyncState) {
    this.sync.set(state.setId, structuredClone(state));
  }
}

export class IdbStorage implements Storage {
  private db: Promise<IDBPDatabase> | null = null;

  private open() {
    this.db ??= openDB("reactpod-local", 1, {
      upgrade(db) {
        db.createObjectStore("programs", { keyPath: "id" });
        db.createObjectStore("meta");
      },
    });
    return this.db;
  }

  async listPrograms() {
    return (await (await this.open()).getAll("programs")) as ProgramDoc[];
  }
  async saveProgram(doc: ProgramDoc) {
    await (await this.open()).put("programs", doc);
  }
  async deleteProgram(id: string) {
    await (await this.open()).delete("programs", id);
  }
  async getMenu() {
    return (await (await this.open()).get("meta", "menu")) as string[] | undefined;
  }
  async saveMenu(menu: string[] | undefined) {
    const db = await this.open();
    if (menu) await db.put("meta", menu, "menu");
    else await db.delete("meta", "menu");
  }
  async getSyncState(setId: string) {
    return (await (await this.open()).get("meta", `sync:${setId}`)) as SyncState | undefined;
  }
  async saveSyncState(state: SyncState) {
    await (await this.open()).put("meta", state, `sync:${state.setId}`);
  }
}

export function createStorage(): Storage {
  return typeof indexedDB === "undefined" ? new MemoryStorage() : new IdbStorage();
}
