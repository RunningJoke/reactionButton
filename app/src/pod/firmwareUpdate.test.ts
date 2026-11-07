import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compareVersions, downloadImage, fetchManifest, FirmwareError, parseManifest, parseVersion, sha256Hex, updateStatus, type ReleaseManifest } from "./firmwareUpdate";

const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

function manifestJson(over: Record<string, unknown> = {}) {
  return {
    version: "2.20.0",
    programFormat: 6,
    board: "NewBoard",
    files: [
      { name: "bootloader.bin", size: 10, sha256: "0".repeat(64) },
      { name: "firmware.bin", size: bytes.length, sha256: sha(bytes) },
    ],
    ...over,
  };
}

const release = (over: Partial<ReleaseManifest> = {}): ReleaseManifest => ({
  version: "2.20.0",
  programFormat: 6,
  image: { size: bytes.length, sha256: sha(bytes) },
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("version compare", () => {
  it("compares numerically: 2.9 is older than 2.19", () => {
    expect(compareVersions("2.9", "2.19")).toBe(-1);
    expect(compareVersions("2.19", "2.9")).toBe(1);
    expect(updateStatus("2.9", "2.19.0")).toBe("available");
  });

  it("treats 2.19 and 2.19.0 as the same version", () => {
    expect(compareVersions("2.19", "2.19.0")).toBe(0);
    expect(updateStatus("2.19", "2.19.0")).toBe("upToDate");
  });

  it("counts a pod on newer firmware as up to date", () => {
    expect(updateStatus("2.20", "2.19.0")).toBe("upToDate");
    expect(updateStatus("3.0", "2.19.0")).toBe("upToDate");
  });

  it("rejects anything that is not one to three numeric parts", () => {
    expect(parseVersion("2.19.0.1")).toBeNull();
    expect(parseVersion("2.x")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(compareVersions("2.19", "dev")).toBeNull();
    expect(updateStatus("2.19", "")).toBe("unknown");
  });
});

describe("manifest parsing", () => {
  it("reads version, program format and the firmware.bin entry", () => {
    expect(parseManifest(manifestJson())).toEqual(release());
  });

  it("lower-cases the hash", () => {
    expect(parseManifest(manifestJson({ files: [{ name: "firmware.bin", size: 5, sha256: "A".repeat(64) }] }))?.image.sha256).toBe("a".repeat(64));
  });

  it.each([
    ["null", null],
    ["a string", "<!doctype html>"],
    ["no version", manifestJson({ version: undefined })],
    ["a bad version", manifestJson({ version: "latest" })],
    ["no program format", manifestJson({ programFormat: undefined })],
    ["program format 0", manifestJson({ programFormat: 0 })],
    ["no files", manifestJson({ files: undefined })],
    ["no firmware.bin", manifestJson({ files: [{ name: "bootloader.bin", size: 10, sha256: "0".repeat(64) }] })],
    ["a size of 0", manifestJson({ files: [{ name: "firmware.bin", size: 0, sha256: "0".repeat(64) }] })],
    ["a short hash", manifestJson({ files: [{ name: "firmware.bin", size: 5, sha256: "abc" }] })],
  ])("returns null for %s (no information, no crash)", (_, value) => {
    expect(parseManifest(value)).toBeNull();
  });
});

describe("fetchManifest", () => {
  it("returns the manifest of the same origin", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => manifestJson() })));
    expect(await fetchManifest()).toEqual(release());
  });

  it("returns null for a 404, an HTML page and offline (fetch rejects)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await fetchManifest()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError("Unexpected token <"); } })));
    expect(await fetchManifest()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await fetchManifest()).toBeNull();
  });
});

describe("image download", () => {
  it("returns the image when size and SHA-256 match", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.slice().buffer })));
    const image = await downloadImage(release());
    expect(image).toMatchObject({ version: "2.20.0", sha256: sha(bytes), size: bytes.length });
  });

  it("rejects an image whose hash does not match the manifest", async () => {
    const other = Uint8Array.from(bytes);
    other[500]! ^= 1;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => other.slice().buffer })));
    await expect(downloadImage(release())).rejects.toMatchObject({ code: "mismatch" });
  });

  it("rejects an image of the wrong size", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.slice(0, 10).buffer })));
    await expect(downloadImage(release())).rejects.toMatchObject({ code: "mismatch" });
  });

  it("reports a failed download as an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    await expect(downloadImage(release())).rejects.toBeInstanceOf(FirmwareError);
    await expect(downloadImage(release())).rejects.toMatchObject({ code: "download" });
  });

  it("reports it as an error, not a skipped check, without crypto.subtle (no HTTPS)", async () => {
    vi.stubGlobal("crypto", { subtle: undefined });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.slice().buffer })));
    await expect(downloadImage(release())).rejects.toMatchObject({ code: "no_crypto" });
    await expect(sha256Hex(bytes.slice().buffer)).rejects.toMatchObject({ code: "no_crypto" });
  });
});
