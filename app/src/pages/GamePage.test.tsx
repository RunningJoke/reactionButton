// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({ needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} }),
}));

import i18n from "../i18n";
import { App } from "../app/App";
import { backOf, SUBPAGES } from "../app/navigation";
import { useResults } from "../results/results";
import { gameUrl } from "../programs/sources";
import { GameAbout } from "./GameAbout";

// jsdom has no CSS.escape (the simulator graph scrolls to the active block)
(globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s };

const solo = encodeURIComponent("/prog/solo.json");
const dreieck = encodeURIComponent("/prog/dreieck.json");

describe("game page", () => {
  beforeEach(async () => {
    window.location.hash = "";
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("the old game routes redirect to the game page with their mode and the query", async () => {
    for (const [route, mode] of [["view", "about"], ["edit", "edit"], ["try", "try"]] as const) {
      window.location.hash = `#/games/${route}?source=shipped&path=${solo}`;
      const { unmount } = render(<App />);
      await waitFor(() => expect(window.location.hash).toBe(`#/games/game?source=shipped&path=${solo}&mode=${mode}`));
      unmount();
    }
  });

  it("without a game the page goes to the list", async () => {
    window.location.hash = "#/games/edit";
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/games"));
  });

  it("About shows the story, or the first sentence of the description", async () => {
    window.location.hash = `#/games/game?source=shipped&path=${dreieck}`;
    render(<App />);
    expect(await screen.findByRole("heading", { level: 3, name: "What happens" })).toBeTruthy();
  });

  it("About falls back to the first sentence of the description", async () => {
    const json = { name: "X", description: "Short one. More text." };
    const props = { sourceId: "shipped", path: "/prog/x.json", json, isProgram: true, resolved: { blocks: [], variables: {}, issues: [], doc: json }, graph: { nodes: [], edges: [] }, mine: false, copyLabel: "Make my copy", onMode: () => {}, onCopy: () => {}, onAdjust: () => {} };
    render(<GameAbout {...(props as unknown as Parameters<typeof GameAbout>[0])} />);
    expect(screen.getByText("Short one.")).toBeTruthy();
    expect(screen.queryByText(/More text/)).toBeNull();
  });

  it("the tabs switch the mode in the URL (replace) and respond to the arrow keys", async () => {
    window.location.hash = `#/games/game?source=shipped&path=${solo}`;
    render(<App />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["About", "Edit", "Try"]);
    const length = window.history.length;
    fireEvent.click(screen.getByRole("tab", { name: "Try" }));
    await waitFor(() => expect(window.location.hash).toContain("mode=try"));
    expect(screen.getByRole("tab", { name: "Try" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    await waitFor(() => expect(window.location.hash).toContain("mode=edit"));
    // a shipped game is read only in Edit: it offers a copy
    expect(screen.getAllByRole("button", { name: "Make my copy" }).length).toBeGreaterThan(0);
    expect(window.history.length).toBe(length);
  });

  it("the header back goes to an explicit parent", () => {
    expect(backOf(SUBPAGES["/games/game"]!, `?${gameUrl({ id: "x" }).split("?")[1]}`)).toBe("/games");
    expect(backOf(SUBPAGES["/set/menu"]!, "")).toBe("/set");
    expect(backOf(SUBPAGES["/results/session"]!, "?id=nope")).toBe("/results");
    useResults.setState({ sessions: [{ id: "s1", athleteId: "a1" } as never] });
    expect(backOf(SUBPAGES["/results/session"]!, "?id=s1")).toBe("/results/athlete?id=a1");
    useResults.setState({ sessions: [{ id: "s2", athleteId: null } as never] });
    expect(backOf(SUBPAGES["/results/session"]!, "?id=s2")).toBe("/results/athlete?id=none");
  });
});
