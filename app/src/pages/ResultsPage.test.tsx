// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({ needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} }),
}));

import i18n from "../i18n";
import { App } from "../app/App";
import { backOf, SUBPAGES } from "../app/navigation";
import { MemoryResultStorage } from "../results/resultStore";
import { useResults } from "../results/results";
import { pickSelected } from "./ResultsPage";

/** A wide window (the rail layout from 900 px) or the phone: jsdom has no matchMedia by itself. */
function setDesktop(on: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: on,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as never;
}

const ann = { id: "a", name: "Ann", createdAt: 1 };
const ben = { id: "b", name: "Ben", createdAt: 2 };

async function seed(athletes: (typeof ann)[]) {
  const storage = new MemoryResultStorage(true);
  for (const a of athletes) await storage.saveAthlete(a);
  useResults.setState({ loaded: false, athletes: [], sessions: [], reports: [], sets: {}, storage, durable: true });
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  await seed([ann, ben]);
});
afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("results on desktop (issue #107)", () => {
  beforeEach(() => setDesktop(true));

  it("shows the list and the first athlete on one page", async () => {
    window.location.hash = "#/results";
    render(<App />);
    expect(await screen.findByRole("heading", { level: 2, name: "Ann" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ben/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ann/ }).getAttribute("aria-current")).toBe("true");
  });

  it("the athlete in the query is selected, and a click on a row selects it without leaving the list", async () => {
    window.location.hash = "#/results?athlete=a";
    render(<App />);
    expect(await screen.findByRole("heading", { level: 2, name: "Ann" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: /Ben/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Ben" })).toBeTruthy();
    expect(window.location.hash).toBe("#/results?athlete=b");
    expect(screen.getByRole("link", { name: /Ben/ }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("link", { name: /Ann/ }).getAttribute("aria-current")).toBeNull();
  });

  it("an old athlete link redirects to the selection", async () => {
    window.location.hash = "#/results/athlete?id=b";
    render(<App />);
    expect(await screen.findByRole("heading", { level: 2, name: "Ben" })).toBeTruthy();
    expect(window.location.hash).toBe("#/results?athlete=b");
  });

  it("the back target of a session returns to the selection", () => {
    useResults.setState({ sessions: [{ id: "s1", athleteId: "b" } as never] });
    expect(backOf(SUBPAGES["/results/session"]!, "?id=s1")).toBe("/results?athlete=b");
  });

  it("picks the first athlete in the list when none (or an unknown one) is asked for", () => {
    expect(pickSelected(null, ["a", "b"], false)).toBe("a");
    expect(pickSelected("zzz", ["a", "b"], false)).toBe("a");
    expect(pickSelected("b", ["a", "b"], false)).toBe("b");
    expect(pickSelected(null, [], true)).toBe("none");
    expect(pickSelected(null, [], false)).toBeNull();
  });
});

describe("results on the phone (unchanged)", () => {
  beforeEach(() => setDesktop(false));

  it("a row links to the athlete page, and clicking it opens that page", async () => {
    window.location.hash = "#/results";
    render(<App />);
    const link = await screen.findByRole("link", { name: /Ben/ });
    expect(link.getAttribute("href")).toBe("#/results/athlete?id=b");
    expect(link.getAttribute("aria-current")).toBeNull();
    fireEvent.click(link);
    await waitFor(() => expect(window.location.hash).toBe("#/results/athlete?id=b"));
    expect(await screen.findByRole("heading", { level: 2, name: "Ben" })).toBeTruthy();
  });

  it("the back target of a session is the athlete page", () => {
    useResults.setState({ sessions: [{ id: "s1", athleteId: "b" } as never] });
    expect(backOf(SUBPAGES["/results/session"]!, "?id=s1")).toBe("/results/athlete?id=b");
  });
});
