// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({ needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} }),
}));

import i18n from "../i18n";
import { App } from "../app/App";
import { useEditor } from "../editor/editorStore";
import { MemoryStorage } from "../store/programStore";
import { useWorkspace } from "../store/workspace";

// jsdom has no CSS.escape (the step list scrolls to the selected step)
(globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s };

const solo = encodeURIComponent("/prog/solo.json");

/** A game with an invalid colour on step 2: the check finds one problem. */
const MINE = {
  version: 1,
  name: "Mine",
  start: "Wait",
  blocks: [
    { name: "Wait", type: "delay", ms: 1000, next: "Late" },
    { name: "Late", type: "led", color: "purple", next: "Done" },
    { name: "Done", type: "led", color: "green", next: "Wait" },
  ],
};

async function openMine(mode: string) {
  const doc = await useWorkspace.getState().add(JSON.parse(JSON.stringify(MINE)), "default", { path: "/prog/mine.json" });
  window.location.hash = `#/games/game?id=${doc.id}&mode=${mode}`;
  render(<App />);
  return doc;
}

describe("editor of my game", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    window.location.hash = "";
    useWorkspace.setState({ loaded: true, programs: [], menu: undefined, sync: null, storage: new MemoryStorage() });
    useEditor.getState().close();
  });
  afterEach(cleanup);

  it("my game has the bottom bar: undo, redo, add step and Try (one undo only, the top bar has none)", async () => {
    await openMine("edit");
    expect(await screen.findByRole("button", { name: "Add step" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Redo" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Try" })).toBeTruthy();
    // undo has nothing to undo yet: disabled
    expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Try in the bar switches the game page to Try", async () => {
    await openMine("edit");
    fireEvent.click(await screen.findByRole("button", { name: "Try" }));
    await waitFor(() => expect(window.location.hash).toContain("mode=try"));
    expect(screen.getByRole("tab", { name: "Try" }).getAttribute("aria-selected")).toBe("true");
  });

  it("Add step opens the add-step sheet", async () => {
    await openMine("edit");
    fireEvent.click(await screen.findByRole("button", { name: "Add step" }));
    expect(await screen.findByRole("complementary", { name: "Add a step" })).toBeTruthy();
  });

  it("a problem shows as a banner on top of the steps, with Fix", async () => {
    await openMine("edit");
    expect(await screen.findByText("1 problem: Invalid colour")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fix" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fix" }));
    // the step of the problem is open
    await waitFor(() => expect(useEditor.getState().selected).toBe("Late"));
  });

  it("a shipped game has no bar: its read-only notice and Make my copy stay", async () => {
    window.location.hash = `#/games/game?source=shipped&path=${solo}&mode=edit`;
    render(<App />);
    expect((await screen.findAllByRole("button", { name: "Make my copy" })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Add step" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});
