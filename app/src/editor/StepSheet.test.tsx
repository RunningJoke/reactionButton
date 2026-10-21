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
  ],
});

let current: ProgramJson;

function Harness({ name, expert = false, round = false }: { name: string; expert?: boolean; round?: boolean }) {
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

  it("repeat bracket: rounds as a stepper", () => {
    render(<Harness name="" round />);
    fireEvent.click(screen.getByRole("button", { name: "More: Rounds" }));
    expect((current.variables as Record<string, number>).ROUNDS).toBe(6);
  });
});
