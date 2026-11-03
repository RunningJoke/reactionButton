// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({ needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} }),
}));

import i18n from "../i18n";
import { App } from "../app/App";

beforeEach(async () => {
  window.location.hash = "#/games";
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

it("the games list shows the shipped games", async () => {
  render(<App />);
  expect(await screen.findByRole("link", { name: /Duo/ })).toBeTruthy();
});
