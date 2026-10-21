// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "../i18n";
import { DEFAULT_FILES } from "../defaults";
import { AddStepSheet } from "./AddStepSheet";
import { useExpertModeStore } from "./expertMode";
import type { ProgramJson } from "./ops";

const solo = JSON.parse(DEFAULT_FILES["/prog/solo.json"]!) as ProgramJson;

describe("Add a step sheet", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useExpertModeStore.setState({ on: false });
  });
  afterEach(cleanup);

  it("adds a step by intent after the selected one", () => {
    const onAdd = vi.fn();
    render(<AddStepSheet doc={solo} after="Hit" onAdd={onAdd} onClose={() => {}} />);
    expect(screen.getByText("Inserted after step 4")).toBeTruthy();
    expect(screen.getByText("Colour and which LEDs")).toBeTruthy();
    // solo.json uses no pods and already catches early presses
    expect((screen.getByRole("button", { name: /Light a pod/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Flash red on a false start/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Light up the central/ }));
    const [doc, focus] = onAdd.mock.calls[0]!;
    expect(focus).toBe("Led1");
    expect((doc as ProgramJson).blocks).toContainEqual({ name: "Led1", type: "led", color: "green", next: "HitLED" });
  });

  it("marks the repeat tile for a format 1 pod", () => {
    render(<AddStepSheet doc={solo} programFormat={1} onAdd={() => {}} onClose={() => {}} />);
    const repeat = screen.getByRole("button", { name: /Repeat/ }) as HTMLButtonElement;
    expect(repeat.disabled).toBe(true);
    expect(repeat.textContent).toContain("needs newer firmware");
  });

  it("shows block types and library parts in expert mode", () => {
    useExpertModeStore.setState({ on: true });
    const onAdd = vi.fn();
    const library = { paths: ["/prog/lib/loop.json"], read: (p: string) => DEFAULT_FILES[p] };
    render(<AddStepSheet doc={solo} library={library} onAdd={onAdd} onClose={() => {}} />);
    expect(screen.getByText("remoteMultiPress")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "loop" }));
    expect(onAdd).toHaveBeenCalledOnce();
  });
});
