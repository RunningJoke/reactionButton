import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FirmwareError, type FirmwareImage, type ReleaseManifest } from "../pod/firmwareUpdate";
import { createFirmwareCache, type FirmwareStore } from "./firmwareCache";

/** A plain key-value store, the same contract as the IndexedDB one. */
function memoryStore(): FirmwareStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    async get(key) {
      return map.get(key);
    },
    async put(key, value) {
      map.set(key, value);
    },
  };
}

const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const image = (version: string, seed: number): FirmwareImage => {
  const data = Uint8Array.from({ length: 64 }, (_, i) => (i * seed) % 256);
  return { version, sha256: sha(data), size: data.length, data: data.slice().buffer };
};
const manifest = (version: string): ReleaseManifest => ({ version, programFormat: 6, image: { size: 64, sha256: "0".repeat(64) } });

describe("firmware cache", () => {
  it("round trip: the image comes back intact and verified", async () => {
    const cache = createFirmwareCache(memoryStore());
    const img = image("2.20.0", 3);
    await cache.putImage(img);
    const back = await cache.getImage();
    expect(back?.version).toBe("2.20.0");
    expect(back?.sha256).toBe(img.sha256);
    expect(Buffer.from(back!.data).equals(Buffer.from(img.data))).toBe(true);
  });

  it("the manifest round trip keeps the version the offline app knows", async () => {
    const cache = createFirmwareCache(memoryStore());
    await cache.putManifest(manifest("2.20.0"));
    expect(await cache.getManifest()).toEqual(manifest("2.20.0"));
  });

  it("no image and no manifest before anything is stored", async () => {
    const cache = createFirmwareCache(memoryStore());
    expect(await cache.getImage()).toBeNull();
    expect(await cache.getManifest()).toBeNull();
  });

  it("keeps only the newest image", async () => {
    const cache = createFirmwareCache(memoryStore());
    await cache.putImage(image("2.19.0", 3));
    await cache.putImage(image("2.20.0", 5));
    expect((await cache.getImage())?.version).toBe("2.20.0");
  });

  it("a hash mismatch on put is rejected and the old image stays", async () => {
    const store = memoryStore();
    const cache = createFirmwareCache(store);
    const good = image("2.20.0", 3);
    await cache.putImage(good);
    const bad = { ...image("2.21.0", 7), sha256: "f".repeat(64) };
    await expect(cache.putImage(bad)).rejects.toBeInstanceOf(FirmwareError);
    expect((await cache.getImage())?.version).toBe("2.20.0");
  });

  it("an image that no longer matches its hash is not returned (corrupted storage)", async () => {
    const store = memoryStore();
    const cache = createFirmwareCache(store);
    await cache.putImage(image("2.20.0", 3));
    const stored = store.map.get("image") as FirmwareImage;
    new Uint8Array(stored.data)[10]! ^= 0xff;
    expect(await cache.getImage()).toBeNull();
  });

  it("a stored manifest that is not valid is no information", async () => {
    const store = memoryStore();
    store.map.set("manifest", { version: "2.20.0" });
    expect(await createFirmwareCache(store).getManifest()).toBeNull();
  });
});
