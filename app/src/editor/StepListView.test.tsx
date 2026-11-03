// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Block, Issue } from "@reactpod/program-model";
import i18n from "../i18n";
import { advancedCount } from "./behaviours";
import { linkMissCounter } from "./switches";
import { ownBlocks, type ProgramJson } from "./ops";
import { stepList } from "./structure";
import { StepListView } from "./StepListView";

// jsdom has no CSS.escape (the list scrolls to the selected and the added step)
(globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s };

const program = (): ProgramJson => ({
  version: 1,
  name: "T",
  start: "Wait",
  blocks: [
    { name: "Wait", type: "delay", ms: 1000, next: "Press" },
    { name: "Press", type: "button", timeoutMs: 2000, record: "reaction", storeAs: "LAST", shortMs: 800, short: "Done", long: "Wait", timeout: "Late", countdown: "drain" },
    { name: "Late", type: "led", color: "red", next: "Done" },
    { name: "Done", type: "led", color: "green", next: "Wait" },
  ],
});

function view(doc: ProgramJson, extra: { issues?: Issue[]; onSelect?: (name: string | null) => void; onShowAll?: () => void; fresh?: { block: string; at: number } | null } = {}) {
  const blocks = new Map(ownBlocks(doc).map((b) => [b.name, b as Block]));
  const props = { steps: stepList(doc), blocks, own: new Set(blocks.keys()), issues: extra.issues ?? [], values: {}, selected: null, onSelect: extra.onSelect ?? (() => {}), onShowAll: extra.onShowAll ?? (() => {}), fresh: extra.fresh };
  return render(<StepListView {...props} />);
}

describe("step list", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("counts only advanced Sprinkles: long press, keep result, countdown (time limit and record are plain facts)", () => {
    const press = ownBlocks(program()).find((b) => b.name === "Press")!;
    expect(advancedCount(press)).toBe(3);
    expect(advancedCount({ name: "P", type: "button", timeoutMs: 2000, record: "reaction" })).toBe(0);
    expect(advancedCount({ name: "S", type: "summary", metric: "reaction", show: true, targetMs: 300 })).toBe(1);
    const jump = { branches: [{ port: "next", role: "then" }] };
    expect(advancedCount({ name: "L", type: "led", color: "red", next: "X" }, jump)).toBe(1);
  });

  it("one line per step: the sentence says what it records, a badge counts the advanced settings", () => {
    view(program());
    expect(screen.getByRole("img", { name: "3 advanced settings" }).textContent?.trim()).toBe("3");
    expect(screen.getAllByText(/records time/)).toHaveLength(1); // part of the sentence, not a chip of its own
    // the last step goes back to the first: "then go to" counts as one; the plain wait has no badge
    expect(screen.getAllByRole("img", { name: /advanced/ }).map((b) => b.textContent?.trim())).toEqual(["3", "1"]);
  });

  it("exits that leave the normal flow are lines under the step, in the words of the picker", () => {
    view(linkMissCounter(program(), "Press", "timeout"));
    expect(screen.getByText("If too slow").closest("span")!.textContent).toBe("If too slow · Count a miss");
    expect(screen.getByText("After a long press").closest("span")!.textContent).toMatch(/^After a long press · /);
    // "after a short press" goes where the step goes on: not a line
    expect(screen.queryByText("After a short press")).toBeNull();
  });

  it("the last step that goes back to the first one says it starts the next round, not step 1", () => {
    view(program());
    expect(screen.getByText("Then start the next round")).toBeTruthy();
    // the long press of "Press" still jumps to step 1: that line keeps its words
    expect(screen.getByText("After a long press").closest("span")!.textContent).toMatch(/^After a long press · step 1/);
  });

  it("a problem banner on top names the first problem and offers Fix (the step) and Show all", () => {
    const onSelect = vi.fn();
    const onShowAll = vi.fn();
    const issues = [
      { severity: "warning", code: "unreachable", file: "/prog/x.json", block: "Done" },
      { severity: "error", code: "invalidColor", file: "/prog/x.json", block: "Late" },
    ] as Issue[];
    view(program(), { issues, onSelect, onShowAll });
    expect(screen.getByText("2 problems: Invalid colour")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fix" }));
    expect(onSelect).toHaveBeenLastCalledWith("Late");
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it("one problem: no Show all; no banner without problems", () => {
    const { unmount } = view(program(), { issues: [{ severity: "error", code: "invalidColor", file: "/prog/x.json", block: "Late" }] as Issue[] });
    expect(screen.getByText("1 problem: Invalid colour")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
    unmount();
    view(program());
    expect(screen.queryByRole("button", { name: "Fix" })).toBeNull();
  });

  it("a step just added is marked, so it can be highlighted (and scrolled to the middle)", () => {
    const { rerender } = view(program());
    expect(document.querySelector('[data-step="Press"][data-fresh]')).toBeNull();
    const blocks = new Map(ownBlocks(program()).map((b) => [b.name, b as Block]));
    rerender(<StepListView steps={stepList(program())} blocks={blocks} own={new Set(blocks.keys())} issues={[]} values={{}} selected={null} onSelect={() => {}} onShowAll={() => {}} fresh={{ block: "Press", at: 1 }} />);
    expect(document.querySelector('[data-step="Press"][data-fresh]')).toBeTruthy();
  });
});
