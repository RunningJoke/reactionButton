/**
 * Content cache for pod files, keyed by size + CRC: a file is only downloaded again when it
 * changed. IndexedDB when available, memory otherwise (private mode, tests).
 */
import { openDB, type IDBPDatabase } from "idb";
import { crcHex } from "../pod/crc32";
import { byteLength } from "../pod/utf8";

export interface FileCache {
  get(size: number, crc: string): Promise<string | undefined>;
  put(text: string): Promise<void>;
}

const key = (size: number, crc: string) => `${size}:${crc.toLowerCase()}`;

export class MemoryFileCache implements FileCache {
  private readonly files = new Map<string, string>();
  async get(size: number, crc: string) {
    return this.files.get(key(size, crc));
  }
  async put(text: string) {
    this.files.set(key(byteLength(text), crcHex(text)), text);
  }
}

let filesDb: Promise<IDBPDatabase> | null = null;

/** The one connection to "reactpod-files". v1: "files" (text). v2 adds "firmware" (images, manifest; firmwareCache.ts). */
export function openFilesDb(): Promise<IDBPDatabase> {
  filesDb ??= openDB("reactpod-files", 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
      if (!db.objectStoreNames.contains("firmware")) db.createObjectStore("firmware");
    },
  }).catch((e) => {
    filesDb = null; // a failed open is tried again on the next use
    throw e;
  });
  return filesDb;
}

export class IdbFileCache implements FileCache {
  private readonly fallback = new MemoryFileCache();

  async get(size: number, crc: string) {
    try {
      const text = (await (await openFilesDb()).get("files", key(size, crc))) as string | undefined;
      // never trust the cache blindly: it must still match the CRC
      return text !== undefined && crcHex(text) === crc.toLowerCase() ? text : undefined;
    } catch {
      return this.fallback.get(size, crc);
    }
  }

  async put(text: string) {
    try {
      await (await openFilesDb()).put("files", text, key(byteLength(text), crcHex(text)));
    } catch {
      await this.fallback.put(text);
    }
  }
}

export const fileCache: FileCache = typeof indexedDB === "undefined" ? new MemoryFileCache() : new IdbFileCache();
