// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({ needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} }),
}));

import i18n from "../i18n";
import { App } from "../app/App";
import { MemoryStorage } from "../store/programStore";
import { useWorkspace } from "../store/workspace";
import { useWizard } from "./wizardStore";

describe("Quick game", () => {
  beforeEach(async () => {
    useWorkspace.setState({ loaded: true, programs: [], menu: undefined, sync: null, storage: new MemoryStorage() });
    useWizard.getState().start();
    window.location.hash = "#/games/new/quick";
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("builds a game from one screen and opens its page", async () => {
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Game"), { target: { value: "multi" } });
    fireEvent.click(screen.getByRole("button", { name: "More: Rounds" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My drill" } });
    fireEvent.click(screen.getByRole("button", { name: "Create game" }));
    await waitFor(() => expect(useWorkspace.getState().programs).toHaveLength(1));
    const [doc] = useWorkspace.getState().programs;
    expect(doc!.json.name).toBe("My drill");
    await waitFor(() => expect(window.location.hash).toContain(`id=${doc!.id}&mode=about`));
  });

  it("a game that needs more pods raises the pods; Create and adjust opens the settings panel", async () => {
    useWizard.getState().update((a) => ({ ...a, pods: 0 }));
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Game"), { target: { value: "multi" } });
    expect(screen.getByRole("group", { name: "Pods besides the main pod" }).textContent).toContain("2");
    fireEvent.click(screen.getByRole("button", { name: "Create and adjust" }));
    await waitFor(() => expect(window.location.hash).toContain("mode=edit&panel=settings"));
    expect(await screen.findByText("Game settings")).toBeTruthy();
  });
});
