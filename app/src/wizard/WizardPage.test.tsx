// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({ needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} }),
}));

import i18n from "../i18n";
import { App } from "../app/App";
import { useWizard } from "./wizardStore";

describe("New program chooser and game wizard", () => {
  beforeEach(async () => {
    // jsdom has no modal dialogs
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
    window.location.hash = "#/programs";
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("offers three ways to start, the game first", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "New program" }));
    const game = screen.getByRole("button", { name: /Start from a game/ });
    expect(game.textContent).toContain("Recommended");
    expect(screen.getByRole("button", { name: /Copy one of my programs/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Start empty/ }).textContent).toContain("For people who know blocks");
    fireEvent.click(screen.getByRole("button", { name: /Copy one of my programs/ }));
    expect(await screen.findByRole("button", { name: /Solo/ })).toBeTruthy(); // shipped programs to copy
  });

  it("walks through the five questions to the Ready screen", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "New program" }));
    fireEvent.click(screen.getByRole("button", { name: /Start from a game/ }));
    expect(await screen.findByText("Step 1 of 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /All at once/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));

    // pods: a game that needs more pods is explained and Next is off
    expect(screen.getByText("Step 2 of 5")).toBeTruthy();
    useWizard.getState().update((a) => ({ ...a, pods: 1 }));
    expect((await screen.findByRole("alert")).textContent).toContain("All at once needs at least 2 pods");
    expect((screen.getByRole("button", { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /More: Pods besides the central/ }));
    expect((screen.getByRole("button", { name: /Next/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));

    expect(screen.getByText("Rounds and timing")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /Time limit/ }));
    expect(screen.getByRole("radio", { name: "Count a miss and go on" })).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("Colour of the light to hit")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByRole("switch", { name: /Count misses/ })).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("button", { name: /Build my game/ }));

    expect(await screen.findByText("Your game is ready")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("All at once");
    expect(screen.getByText("12 rounds, each one:")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try it/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Change steps/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Save and add to menu/ })).toBeTruthy();
  });
});
