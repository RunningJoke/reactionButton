// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

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
    window.location.hash = "#/games";
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("offers three ways to start, the new game first", async () => {
    render(<App />);
    fireEvent.click((await screen.findAllByRole("button", { name: "New game" }))[0]!);
    const game = screen.getByRole("button", { name: /Quick game/ });
    expect(game.textContent).toContain("Recommended");
    expect(screen.getByRole("button", { name: /Copy a game/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Start empty/ }).textContent).toContain("For people who know blocks");
    fireEvent.click(screen.getByRole("button", { name: /Copy a game/ }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("button", { name: /Solo/ })).toBeTruthy(); // shipped programs to copy
  });

  it("one new-game flow: the Quick screen, then More options through the questions to the Ready screen (#147 A2)", async () => {
    render(<App />);
    fireEvent.click((await screen.findAllByRole("button", { name: "New game" }))[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Quick game/ }));
    fireEvent.click(await screen.findByRole("radio", { name: /All at once/ }));

    // pods: a game that needs more pods is explained and More options is off
    useWizard.getState().update((a) => ({ ...a, pods: 1 }));
    expect((await screen.findByRole("alert")).textContent).toContain("All at once needs at least 2 pods");
    expect((screen.getByRole("button", { name: /More options/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /More: Pods besides the main pod/ }));
    expect((screen.getByRole("button", { name: /More options/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /More options/ }));

    expect(screen.getByText("Rounds and timing")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /Time limit/ }));
    expect(screen.getByRole("radio", { name: "Count a miss and go on" })).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("Colour of the light to hit")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByRole("switch", { name: /Count misses/ })).toHaveProperty("checked", true);
    // without a time limit "Count misses" turns one on instead of being greyed out (#147 A5)
    useWizard.getState().update((a) => ({ ...a, redPods: 0, timeLimit: null, measure: { ...a.measure, countMisses: false } }));
    fireEvent.click(await screen.findByRole("switch", { name: /Count misses/ }));
    expect(useWizard.getState().answers.timeLimit?.ms).toBe(2000);
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
