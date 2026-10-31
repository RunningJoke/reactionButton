// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Block } from "@reactpod/program-model";
import i18n from "../i18n";
import { advancedCount } from "./behaviours";
import { linkMissCounter } from "./switches";
import { ownBlocks, type ProgramJson } from "./ops";
import { stepList } from "./structure";
import { StepListView } from "./StepListView";

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

function view(doc: ProgramJson) {
  const blocks = new Map(ownBlocks(doc).map((b) => [b.name, b as Block]));
  render(<StepListView steps={stepList(doc)} blocks={blocks} own={new Set(blocks.keys())} issues={[]} values={{}} selected={null} onSelect={() => {}} />);
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
});
