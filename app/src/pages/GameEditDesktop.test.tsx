// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({ needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} }),
}));

import i18n from "../i18n";
import { App } from "../app/App";
import { useEditor } from "../editor/editorStore";
import { MemoryStorage } from "../store/programStore";
import { useWorkspace } from "../store/workspace";

(globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s };

const MINE = {
  version: 1,
  name: "Mine",
  start: "Wait",
  blocks: [
    { name: "Wait", type: "delay", ms: 1000, next: "Go" },
    { name: "Go", type: "led", color: "green", next: "Wait" },
  ],
};

/** jsdom has no media queries: `desktop` answers (min-width: 900px) */
const viewport = (desktop: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: desktop && query.includes("900px"), media: query, addEventListener() {}, removeEventListener() {} }));

async function openEdit() {
  const doc = await useWorkspace.getState().add(JSON.parse(JSON.stringify(MINE)), "default", { path: "/prog/mine.json" });
  window.location.hash = `#/games/game?id=${doc.id}&mode=edit`;
  render(<App />);
}
const now = () => document.querySelector("[aria-live='polite'] p")?.textContent;

describe("Edit on desktop: live simulator beside the step list", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    window.location.hash = "";
    useWorkspace.setState({ loaded: true, programs: [], menu: undefined, sync: null, storage: new MemoryStorage() });
    useEditor.getState().close();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the simulator next to the editor on desktop", async () => {
    viewport(true);
    await openEdit();
    expect(await screen.findByRole("button", { name: "Add step" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
  });

  it("has no simulator in Edit on the phone", async () => {
    viewport(false);
    await openEdit();
    expect(await screen.findByRole("button", { name: "Add step" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
  });

  it("an edit restarts the simulator after a short pause, not at once", async () => {
    viewport(true);
    await openEdit();
    await screen.findByRole("button", { name: "Run" });
    fireEvent.click(screen.getByRole("button", { name: "Skip pause" }));
    const running = now();
    expect(running).not.toMatch(/Press Run/);
    const json = JSON.parse(JSON.stringify(MINE));
    json.blocks[0].ms = 2000;
    act(() => useEditor.getState().apply(json));
    expect(now()).toBe(running);
    await waitFor(() => expect(now()).toMatch(/Press Run/), { timeout: 2000 });
  });
});
