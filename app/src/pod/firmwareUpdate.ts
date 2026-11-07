/**
 * Firmware releases for the pod update (#128): the version compare, the release manifest that
 * the release flow publishes (`firmware/ota-manifest.json`, .github/workflows/release-firmware.yml),
 * and the image download with its SHA-256 check. Nothing here stores anything: see store/firmwareCache.ts.
 */

/** The image in the manifest's `files` list, and where the app downloads it from (same origin). */
export const IMAGE_NAME = "firmware.bin";
const MANIFEST_PATH = "firmware/ota-manifest.json";
const IMAGE_PATH = `firmware/${IMAGE_NAME}`;

export type ReleaseManifest = {
  /** release version from the tag, three parts ("2.19.0") */
  version: string;
  /** program format of the release (programs.md §6) */
  programFormat: number;
  image: { size: number; sha256: string };
};

/** The image with its checks: what the cache keeps and an update installs. */
export type FirmwareImage = { version: string; sha256: string; size: number; data: ArrayBuffer };

export type FirmwareErrorCode = "no_crypto" | "mismatch" | "download";

export class FirmwareError extends Error {
  constructor(readonly code: FirmwareErrorCode) {
    super(code);
  }
}

/** "2.19" and "2.19.0" are version parts 1 to 3, numeric; anything else is not a version. */
export function parseVersion(text: string): number[] | null {
  if (!/^\d+(\.\d+){0,2}$/.test(text)) return null;
  return text.split(".").map(Number);
}

/** -1, 0 or 1 by numeric parts (2.9 < 2.19), missing parts are 0; null if a version is not valid. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

export type UpdateStatus = "unknown" | "upToDate" | "available";

/** The pod's `info.firmware` against the release version. A pod on newer firmware is up to date. */
export function updateStatus(installed: string, release: string): UpdateStatus {
  const d = compareVersions(release, installed);
  if (d === null) return "unknown";
  return d > 0 ? "available" : "upToDate";
}

/** The manifest of the release flow, or null when it is missing or not a valid manifest. */
export function parseManifest(value: unknown): ReleaseManifest | null {
  if (!value || typeof value !== "object") return null;
  const m = value as { version?: unknown; programFormat?: unknown; files?: unknown };
  if (typeof m.version !== "string" || parseVersion(m.version) === null) return null;
  if (!Number.isInteger(m.programFormat) || (m.programFormat as number) < 1) return null;
  if (!Array.isArray(m.files)) return null;
  const file = m.files.find((f) => f && typeof f === "object" && (f as { name?: unknown }).name === IMAGE_NAME) as
    | { size?: unknown; sha256?: unknown }
    | undefined;
  if (!file || !Number.isInteger(file.size) || (file.size as number) <= 0) return null;
  if (typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(file.sha256)) return null;
  return {
    version: m.version,
    programFormat: m.programFormat as number,
    image: { size: file.size as number, sha256: file.sha256.toLowerCase() },
  };
}

/** A ReleaseManifest as the cache stored it (checked again on every read). */
export function isReleaseManifest(value: unknown): value is ReleaseManifest {
  const m = value as Partial<ReleaseManifest> | null;
  return (
    !!m &&
    typeof m.version === "string" &&
    parseVersion(m.version) !== null &&
    Number.isInteger(m.programFormat) &&
    (m.programFormat as number) >= 1 &&
    !!m.image &&
    Number.isInteger(m.image.size) &&
    m.image.size > 0 &&
    typeof m.image.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(m.image.sha256)
  );
}

/** Lower-case hex SHA-256. Without crypto.subtle (no HTTPS) the check cannot run: an error, not a skip. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new FirmwareError("no_crypto");
  const digest = new Uint8Array(await subtle.digest("SHA-256", data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The manifest from the same origin, or null: offline, a 404 page, HTML, or a bad manifest. Never throws. */
export async function fetchManifest(): Promise<ReleaseManifest | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}${MANIFEST_PATH}`, { cache: "no-cache" });
    if (!res.ok) return null;
    return parseManifest(await res.json());
  } catch {
    return null;
  }
}

/** Downloads the image and checks its size and SHA-256 against the manifest; a mismatch is an error. */
export async function downloadImage(manifest: ReleaseManifest): Promise<FirmwareImage> {
  let data: ArrayBuffer;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}${IMAGE_PATH}`, { cache: "no-cache" });
    if (!res.ok) throw new FirmwareError("download");
    data = await res.arrayBuffer();
  } catch (e) {
    throw e instanceof FirmwareError ? e : new FirmwareError("download");
  }
  if (data.byteLength !== manifest.image.size || (await sha256Hex(data)) !== manifest.image.sha256) {
    throw new FirmwareError("mismatch");
  }
  return { version: manifest.version, sha256: manifest.image.sha256, size: data.byteLength, data };
}
