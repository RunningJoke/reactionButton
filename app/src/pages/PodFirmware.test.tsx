// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import i18n from "../i18n";
import type { InfoResponse } from "../pod/protocol";
import type { FirmwareImage } from "../pod/firmwareUpdate";
import { FirmwareCard } from "./PodFirmware";

// the cache keeps its data in this map (no IndexedDB in jsdom); reset before each test
const store = vi.hoisted(() => ({ map: new Map<string, unknown>() }));
vi.mock("../store/firmwareCache", async (orig) => {
  const mod = await orig<typeof import("../store/firmwareCache")>();
  return {
    ...mod,
    firmwareCache: mod.createFirmwareCache({
      async get(key) {
        return store.map.get(key);
      },
      async put(key, value) {
        store.map.set(key, value);
      },
    }),
  };
});

const SIZE = 1095344; // the demo image of the firmware tests: 1.1 MB
const image = Uint8Array.from({ length: SIZE }, (_, i) => (i * 7) % 256);
const sha = createHash("sha256").update(image).digest("hex");

/** What the server answers for ota-manifest.json and firmware.bin. */
type Server = { manifest: "ok" | "missing" | "offline"; programFormat?: number; bin?: Uint8Array };
let server: Server;

function serve() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (server.manifest === "offline") throw new TypeError("Failed to fetch");
      if (url.endsWith("ota-manifest.json")) {
        if (server.manifest === "missing") return { ok: false, json: async () => ({}) };
        return {
          ok: true,
          json: async () => ({
            version: "2.20.0",
            programFormat: server.programFormat ?? 6,
            board: "NewBoard",
            files: [{ name: "firmware.bin", size: SIZE, sha256: sha }],
          }),
        };
      }
      if (url.endsWith("firmware.bin")) {
        const data = server.bin ?? image;
        return { ok: true, arrayBuffer: async () => data.slice().buffer };
      }
      return { ok: false };
    }),
  );
}

const info = (over: Partial<InfoResponse> = {}) =>
  ({ firmware: "2.19", programFormat: 6, features: ["ota", "identify"], ...over }) as unknown as InfoResponse;

const renderCard = (props: Partial<Parameters<typeof FirmwareCard>[0]> & { info: InfoResponse }) =>
  render(<FirmwareCard {...props} />);

beforeEach(async () => {
  await i18n.changeLanguage("en");
  store.map.clear();
  server = { manifest: "ok" };
  serve();
  // jsdom's ArrayBuffer is another realm: Node's crypto.subtle refuses it, so the digest is Node's own
  vi.stubGlobal("crypto", { subtle: { digest: async (_: string, data: ArrayBuffer) => createHash("sha256").update(Buffer.from(data)).digest() } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("This set: pod software", () => {
  it("up to date: installed equals the release", async () => {
    renderCard({ info: info({ firmware: "2.20" }) });
    await waitFor(() => expect(screen.getByText("Up to date.")).toBeTruthy());
    expect(screen.getByText("2.20")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a pod on newer firmware than the release is up to date", async () => {
    renderCard({ info: info({ firmware: "2.21" }) });
    await waitFor(() => expect(screen.getByText("Up to date.")).toBeTruthy());
  });

  it("update available with ota: the version, the size of the download, no Update button without a handler", async () => {
    renderCard({ info: info() });
    await waitFor(() => expect(screen.getByText("Version 2.20.0 is available.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Download for offline use (1.1 MB)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("update handler given: Update downloads the image first and passes the verified image on", async () => {
    const onUpdate = vi.fn();
    renderCard({ info: info(), onUpdate });
    const update = await screen.findByRole("button", { name: "Update" });
    fireEvent.click(update);
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0]![0]).toBe("2.20.0");
    // the image is fetched when the update asks for it
    const passed = await (onUpdate.mock.calls[0]![1] as () => Promise<FirmwareImage>)();
    expect(passed).toMatchObject({ version: "2.20.0", sha256: sha, size: SIZE });
    // the image is kept: the card now says so
    expect(await screen.findByText("Stored for offline use: 2.20.0, 1.1 MB.")).toBeTruthy();
  });

  it("without ota: the installed version and the note that this firmware updates over USB", async () => {
    renderCard({ info: info({ firmware: "2.17", features: ["identify"] }) });
    await waitFor(() => expect(screen.getByText("Version 2.20.0 is available. This firmware updates over USB only.")).toBeTruthy());
    expect(screen.getByText("2.17")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("no manifest (dev server, no release yet): no information, no button", async () => {
    server = { manifest: "missing" };
    serve();
    renderCard({ info: info() });
    await waitFor(() => expect(screen.getByText("No release information available.")).toBeTruthy());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a program format that differs from the pod's: says that programs are not part of the update", async () => {
    server = { manifest: "ok", programFormat: 7 };
    serve();
    renderCard({ info: info() });
    await waitFor(() => expect(screen.getByText(/Programs are not part of the update/)).toBeTruthy());
    expect(screen.getByText(/program format 7, this pod 6/)).toBeTruthy();
  });

  it("offline with a cached image: the last release info and the stored image", async () => {
    renderCard({ info: info() });
    fireEvent.click(await screen.findByRole("button", { name: "Download for offline use (1.1 MB)" }));
    expect(await screen.findByText("Stored for offline use: 2.20.0, 1.1 MB.")).toBeTruthy();
    cleanup();

    server = { manifest: "offline" };
    serve();
    renderCard({ info: info() });
    await waitFor(() => expect(screen.getByText("Offline: this is the release information from the last check.")).toBeTruthy());
    expect(screen.getByText("Version 2.20.0 is available.")).toBeTruthy();
    expect(screen.getByText("Stored for offline use: 2.20.0, 1.1 MB.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
  });

  it("offline without a cached image: the release info is not stored for offline use", async () => {
    renderCard({ info: info() });
    await screen.findByRole("button", { name: "Download for offline use (1.1 MB)" });
    cleanup();

    store.map.delete("image");
    server = { manifest: "offline" };
    serve();
    renderCard({ info: info() });
    await waitFor(() => expect(screen.getByText("Not stored for offline use. Download it while online.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
  });

  it("offline and never online: no information", async () => {
    server = { manifest: "offline" };
    serve();
    renderCard({ info: info() });
    await waitFor(() => expect(screen.getByText("No release information available.")).toBeTruthy());
  });

  it("a download that does not match the hash is rejected and not stored", async () => {
    server = { manifest: "ok", bin: image.map((b, i) => (i === 5 ? b ^ 1 : b)) as unknown as Uint8Array };
    serve();
    renderCard({ info: info() });
    fireEvent.click(await screen.findByRole("button", { name: "Download for offline use (1.1 MB)" }));
    expect(await screen.findByText("The download does not match the release checksum. Nothing was stored; try again.")).toBeTruthy();
    expect(store.map.has("image")).toBe(false);
    expect(screen.queryByText(/Stored for offline use/)).toBeNull();
  });
});
