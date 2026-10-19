/**
 * Local persistence of the user's programs and menu (README §6). Behind an interface, so a
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

export interface Storage {
  listPrograms(): Promise<ProgramDoc[]>;
  saveProgram(doc: ProgramDoc): Promise<void>;
  deleteProgram(id: string): Promise<void>;
  /** the local menu (paths in /programs.json order); undefined until the user changed it */
  getMenu(): Promise<string[] | undefined>;
  saveMenu(menu: string[]): Promise<void>;
}

export class MemoryStorage implements Storage {
  private programs = new Map<string, ProgramDoc>();
  private menu: string[] | undefined;
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
  async saveMenu(menu: string[]) {
    this.menu = [...menu];
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
  async saveMenu(menu: string[]) {
    await (await this.open()).put("meta", menu, "menu");
  }
}

export function createStorage(): Storage {
  return typeof indexedDB === "undefined" ? new MemoryStorage() : new IdbStorage();
}
