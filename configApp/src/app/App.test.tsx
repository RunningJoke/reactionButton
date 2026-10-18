// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

import i18n from "../i18n";
import { App } from "./App";

describe("App shell", () => {
  beforeEach(async () => {
    window.location.hash = "";
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("opens the programs tab by default", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Programs" })).toBeTruthy();
  });

  it("shows the navigation and the connection state", () => {
    render(<App />);
    expect(screen.getAllByRole("navigation", { name: "Main navigation" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("status").textContent).toContain("Not connected");
  });

  it("switches to German", async () => {
    await i18n.changeLanguage("de");
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Programme" })).toBeTruthy();
  });
});
