// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { validateProgram, type Block } from "@reactpod/program-model";
import i18n from "../i18n";
import type { InspectorContext } from "./BlockInspector";
import { ownBlocks, type ProgramJson } from "./ops";
import { sentenceOptions } from "./sentence";
import { stepList } from "./structure";
import { RoundSheet, StepSheet } from "./StepSheet";

const program = (): ProgramJson => ({
  version: 1,
  name: "T",
  peripherals: 3,
  variables: { ROUNDS: 5, SELECTED_POD: 0 },
  start: "Rounds",
  blocks: [
    { name: "Rounds", type: "repeat", count: "ROUNDS", body: "Pause", done: "End" },
    { name: "Pause", type: "delay", ms: 1500, next: "Press" },
    { name: "Press", type: "button", pressed: "Pick" },
    { name: "Pick", type: "setVariable", var: "SELECTED_POD", op: "random", value: "REQUIRED_PERIPHERALS", next: "Pod" },
    { name: "Pod", type: "remotePress", pod: "SELECTED_POD", next: "Rounds" },
    { name: "End", type: "led", color: "blue" },
    { name: "Glow", type: "effect", effect: "pulse", color: "blue", next: "Pause" },
    { name: "Charge", type: "charge", maxMs: 2000, next: "End" },
    { name: "Let", type: "release", next: "End" },
  ],
});

let current: ProgramJson;

function Harness({ name, expert = false, round = false, format }: { name: string; expert?: boolean; round?: boolean; format?: number }) {
  const [doc, setDoc] = useState(program);
  current = doc;
  const resolved = validateProgram("/prog/t.json", (p) => (p === "/prog/t.json" ? JSON.stringify(doc) : undefined));
  const blocks = ownBlocks(doc);
  const ctx: InspectorContext = {
    json: doc,
    names: blocks.map((b) => b.name),
    variables: ["ROUNDS", "SELECTED_POD"],
    metrics: ["reaction"],
    lockedBy: new Map(),
    isProgram: true,
    apply: (next) => setDoc(next),
    select: () => {},
    addConnected: () => {},
    addAfter: () => {},
    remove: () => {},
    programFormat: format,
  };
  const steps = stepList(doc);
  if (round) {
    const loop = steps.find((s) => s.loop)!.loop!;
    return <RoundSheet loop={loop} blocks={new Map(blocks.map((b) => [b.name, b]))} own={new Set(blocks.map((b) => b.name))} issues={[]} expert={expert} ctx={ctx} onAddToRound={() => {}} />;
  }
  const block = blocks.find((b) => b.name === name) as Block;
  return (
    <StepSheet
      block={block}
      step={steps.find((s) => s.block === name)}
      issues={resolved.issues.filter((i) => i.block === name)}
      sentence={sentenceOptions(blocks, resolved.variables)}
      expert={expert}
      ctx={ctx}
    />
  );
}

const block = (name: string) => ownBlocks(current).find((b) => b.name === name)!;

describe("step sheet", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("press: switches add and remove their fields; no raw names", () => {
    render(<Harness name="Press" />);
    const sheet = screen.getByRole("complementary");
    expect(sheet.textContent).not.toMatch(/timeoutMs|record|pressed|SELECTED_POD|shortMs/);
    expect(screen.queryByText("Seconds")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: /Time limit/ }));
    expect(block("Press").timeoutMs).toBe(2000);
    expect(screen.getByText(/max 2 s/)).toBeTruthy(); // the step text follows
    fireEvent.click(screen.getByRole("radio", { name: "Count a miss" }));
    expect(ownBlocks(current).some((b) => b.type === "setVariable" && b.var === "MISSES")).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: /Time limit/ }));
    expect(block("Press").timeoutMs).toBeUndefined();
    expect(ownBlocks(current).some((b) => b.var === "MISSES")).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: /Record reaction time/ }));
    expect(block("Press").record).toBe("reaction");
  });

  it("pause: Fixed | Random", () => {
    render(<Harness name="Pause" />);
    fireEvent.click(screen.getByRole("radio", { name: "Random between" }));
    expect(block("Pause")).toMatchObject({ minMs: 1500, maxMs: 3000 });
    expect(screen.getByText("Shortest")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /Catch early presses/ }));
    expect(block("Pause").type).toBe("button");
  });

  it("pod: chips choose the pod", () => {
    render(<Harness name="Pod" />);
    const chips = within(screen.getByRole("group", { name: "Which pod" }));
    expect(chips.getByRole("button", { name: "Random pod" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chips.getByRole("button", { name: "Pod 3" }));
    expect(block("Pod").pod).toBe(2);
    expect(ownBlocks(current).some((b) => b.name === "Pick")).toBe(false);
  });

  it("expert section only in expert mode", () => {
    render(<Harness name="Press" />);
    expect(screen.queryByRole("region", { name: "Expert" })).toBeNull();
    cleanup();
    render(<Harness name="Press" expert />);
    expect(screen.getByRole("region", { name: "Expert" })).toBeTruthy();
    expect(screen.getByLabelText("Block name")).toBeTruthy();
  });

  it("light effect: effect, colour, where, how long and wait", () => {
    render(<Harness name="Glow" />);
    expect(screen.getByText(/Pulse the central blue/)).toBeTruthy();
    const kinds = within(screen.getByRole("group", { name: "Effect" }));
    fireEvent.click(kinds.getByRole("button", { name: "Fill up" }));
    expect(block("Glow")).toMatchObject({ effect: "fill", durationMs: 2000 });
    const where = within(screen.getByRole("group", { name: "Where" }));
    fireEvent.click(where.getByRole("button", { name: "Pod 2" }));
    expect(block("Glow").target).toBe(1);
    fireEvent.click(where.getByRole("button", { name: "Everything" }));
    expect(block("Glow").target).toBe("all");
    fireEvent.click(screen.getByRole("switch", { name: /Wait until it is over/ }));
    expect(block("Glow").wait).toBe(true);
    // a periodic effect is endless by default and cannot be waited for
    fireEvent.click(kinds.getByRole("button", { name: "Blink" }));
    expect(block("Glow").durationMs).toBe(2000);
    fireEvent.click(screen.getByRole("radio", { name: "Until the next light change" }));
    expect(block("Glow").durationMs).toBeUndefined();
    expect(block("Glow").wait).toBeUndefined();
    expect((screen.getByRole("switch", { name: /Wait until it is over/ }) as HTMLInputElement).disabled).toBe(true);
    // steady and off have no length
    fireEvent.click(kinds.getByRole("button", { name: "Steady" }));
    expect(screen.queryByRole("switch", { name: /Wait until it is over/ })).toBeNull();
    expect(screen.getByRole("heading", { name: /Light effect/ })).toBeTruthy();
  });

  it("hold to charge: essentials, style, mode and the options of the mode", () => {
    render(<Harness name="Charge" />);
    const sheet = screen.getByRole("complementary");
    expect(sheet.textContent).not.toMatch(/maxMs|onsetMs|storePercent|accumulate\b/);
    fireEvent.click(screen.getByRole("button", { name: "Pod 2" }));
    expect(block("Charge").pod).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Central" }));
    expect(block("Charge").pod).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Change colour" }));
    expect(block("Charge").style).toBe("colorShift");
    expect(screen.getByRole("group", { name: "Second colour" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Traffic light" }));
    expect(screen.queryByRole("group", { name: "Second colour" })).toBeNull();
    // the drain time exists only while the charge adds up
    expect(screen.queryByText("Charge drains in")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Charge adds up" }));
    expect(block("Charge").mode).toBe("accumulate");
    expect(screen.getByText("Charge drains in")).toBeTruthy();
    // time limit with the countdown
    fireEvent.click(screen.getByRole("switch", { name: /Time limit/ }));
    expect(block("Charge").timeoutMs).toBe(2000);
    fireEvent.click(screen.getByRole("switch", { name: /Show the time running out/ }));
    expect(block("Charge").countdown).toBe("drain");
  });

  it("let go: the mode switch moves between trigger and signal", () => {
    render(<Harness name="Let" />);
    expect(screen.queryByText("Colour of the signal")).toBeNull();
    expect(screen.getByRole("switch", { name: /Longest hold/ })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /Record reaction time/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Let go at a signal" }));
    expect(block("Let")).toMatchObject({ mode: "signal", minGoMs: 1500, maxGoMs: 3000 });
    expect(screen.getByRole("group", { name: "Colour of the signal" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Record reaction time/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Always the same" }));
    expect(block("Let").goMs).toBe(1500);
    fireEvent.click(screen.getByRole("radio", { name: "Letting go starts it" }));
    expect(block("Let").mode).toBeUndefined();
    expect(block("Let").goMs).toBeUndefined();
  });

  it("countdown: a pause has one at once, a press once the time limit is on", () => {
    render(<Harness name="Pause" />);
    fireEvent.click(screen.getByRole("switch", { name: /Show the time running out/ }));
    expect(block("Pause").countdown).toBe("drain");
    expect(screen.getByText(/the ring counts down/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Changes colour" }));
    expect(block("Pause").countdown).toBe("colorShift");
    fireEvent.click(screen.getByRole("switch", { name: /Show the time running out/ }));
    expect(block("Pause").countdown).toBeUndefined();
    cleanup();

    render(<Harness name="Press" />);
    const row = screen.getByRole("switch", { name: /Show the time running out/ }) as HTMLInputElement;
    expect(row.disabled).toBe(true); // no time limit yet
    fireEvent.click(screen.getByRole("switch", { name: /Time limit/ }));
    fireEvent.click(screen.getByRole("switch", { name: /Show the time running out/ }));
    expect(block("Press").countdown).toBe("drain");
    fireEvent.click(screen.getByRole("switch", { name: /Time limit/ })); // the countdown goes with the limit
    expect(block("Press").countdown).toBeUndefined();
  });

  it("a pod with program format 2 gets no countdown row", () => {
    render(<Harness name="Pause" format={2} />);
    expect(screen.queryByRole("switch", { name: /Show the time running out/ })).toBeNull();
  });

  it("repeat bracket: rounds as a stepper", () => {
    render(<Harness name="" round />);
    fireEvent.click(screen.getByRole("button", { name: "More: Rounds" }));
    expect((current.variables as Record<string, number>).ROUNDS).toBe(6);
  });
});
