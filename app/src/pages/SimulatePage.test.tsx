// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import i18n from "../i18n";
import { SimulatePage } from "./SimulatePage";

// jsdom has no CSS.escape (the simulator graph scrolls to the active block)
(globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s };

const show = (path: string) =>
  render(
    <MemoryRouter>
      <SimulatePage target={{ source: "shipped", path }} />
    </MemoryRouter>,
  );

const press = (name: RegExp) => {
  const button = screen.getAllByRole("button", { name })[0]!;
  fireEvent.pointerDown(button);
  fireEvent.pointerUp(button);
};
const skip = () => fireEvent.click(screen.getByRole("button", { name: "Skip pause" }));
// jsdom does not toggle <details> on a click of its summary
const openDetails = (open = true) => {
  const details = document.querySelector("details")!;
  details.open = open;
  fireEvent(details, new Event("toggle"));
};
const step = () => fireEvent.click(screen.getByRole("button", { name: "Step" }));
const now = () => document.querySelector("[aria-live='polite'] p")?.textContent;

describe("Try mode", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("says in plain words what happens now, from the step list", () => {
    show("/prog/solo.json");
    expect(now()).toMatch(/Press Run/);
    openDetails();
    step();
    expect(now()).toBe("Step 2 of 6: Wait 0.8–5 s (random), pressing now is a false start");
    skip();
    expect(now()).toBe("Step 3 of 6: Light the main pod green");
  });

  it("a press after the signal shows the reaction time on the pod and counts in So far", () => {
    show("/prog/solo.json");
    openDetails();
    step();
    skip();
    step();
    expect(now()).toMatch(/wait for a press/i);
    act(() => press(/Press Main pod/));
    expect(screen.queryByText("Too early")).toBeNull();
    expect(document.querySelector("span[class*=chip]")?.textContent).toMatch(/^\d[.,]\d\d s$/);
    expect(screen.getByText("So far")).toBeTruthy();
  });

  it("a press before the signal says Too early and counts a false start", () => {
    show("/prog/solo.json");
    openDetails();
    step();
    act(() => press(/Press Main pod/));
    expect(screen.getByText("Too early")).toBeTruthy();
    expect(screen.getByText("False starts").previousElementSibling?.textContent).toBe("1");
  });

  it("Details are collapsed by default and hold the controls for experts", () => {
    show("/prog/solo.json");
    const details = document.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(screen.queryByRole("button", { name: "Step" })).toBeNull();
    openDetails();
    expect(details.open).toBe(true);
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
  });

  it("the report card names its buttons by outcome", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      show("/prog/dreieck.json");
      fireEvent.click(screen.getByRole("button", { name: "Run" }));
      // play in real time: press the lit pod, until the round result waits for the app
      for (let i = 0; i < 3000 && !screen.queryByRole("button", { name: "Finish" }); i++) {
        const lit = screen.queryByText("press now")?.closest("button") ?? (/press on the main pod/.test(now() ?? "") ? screen.getByRole("button", { name: /Press Main pod/ }) : null);
        if (lit) act(() => void (fireEvent.pointerDown(lit), fireEvent.pointerUp(lit)));
        act(() => void vi.advanceTimersByTime(250));
      }
      for (const name of ["Next round", "Play again", "Finish"]) expect(screen.getByRole("button", { name })).toBeTruthy();
      expect(screen.getByText("Round result")).toBeTruthy();
      expect(document.body.textContent).toMatch(/Reaction time\s*Best/);
    } finally {
      vi.useRealTimers();
    }
  }, 120000);
});
