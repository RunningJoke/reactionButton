/**
 * Firmware for offline use (#128): the release manifest and the newest image, in the "firmware"
 * store of "reactpod-files" (IndexedDB), memory when IndexedDB is missing. Binaries are not in the
 * service worker precache (vite.config.ts). A cached image is checked against its SHA-256 on every read.
 */
import { openFilesDb } from "./fileCache";
import { FirmwareError, isReleaseManifest, sha256Hex, type FirmwareImage, type ReleaseManifest } from "../pod/firmwareUpdate";

/** Key-value access, so the tests can run the cache without IndexedDB. */
export type FirmwareStore = {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
};

const memory = new Map<string, unknown>();
const memoryStore: FirmwareStore = {
  async get(key) {
    return memory.get(key);
  },
  async put(key, value) {
    memory.set(key, value);
  },
};

const idbStore: FirmwareStore = {
  async get(key) {
    return (await openFilesDb()).get("firmware", key);
  },
  async put(key, value) {
    await (await openFilesDb()).put("firmware", value, key);
  },
};

/** IndexedDB, or memory when it fails (private mode): the cache is an offline aid, never a blocker. */
export const defaultFirmwareStore: FirmwareStore = {
  async get(key) {
    try {
      return await idbStore.get(key);
    } catch {
      return memoryStore.get(key);
    }
  },
  async put(key, value) {
    try {
      await idbStore.put(key, value);
    } catch {
      await memoryStore.put(key, value);
    }
  },
};

/** One image and one manifest only: a new download replaces the old image ("keep only the newest"). */
export function createFirmwareCache(store: FirmwareStore) {
  return {
    async getManifest(): Promise<ReleaseManifest | null> {
      const manifest = await store.get("manifest");
      return isReleaseManifest(manifest) ? manifest : null;
    },
    async putManifest(manifest: ReleaseManifest): Promise<void> {
      await store.put("manifest", manifest);
    },
    /** The cached image, or null when none is stored or its bytes no longer match the stored hash. */
    async getImage(): Promise<FirmwareImage | null> {
      const image = (await store.get("image")) as FirmwareImage | undefined;
      if (!image || !(image.data instanceof ArrayBuffer) || typeof image.version !== "string") return null;
      if (image.data.byteLength !== image.size) return null;
      return (await sha256Hex(image.data)) === image.sha256 ? image : null;
    },
    /** Stores the image only if its bytes match its hash; a mismatch throws and the old image stays. */
    async putImage(image: FirmwareImage): Promise<void> {
      if ((await sha256Hex(image.data)) !== image.sha256) throw new FirmwareError("mismatch");
      await store.put("image", image);
    },
  };
}

export const firmwareCache = createFirmwareCache(defaultFirmwareStore);
