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
    { name: "Game", type: "toggle", durationMs: 20000, next: "End" },
    { name: "Report", type: "communicate", next: "End" },
    { name: "Multi", type: "remoteMultiPress", next: "End" },
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
    metrics: ["reaction", "lap"],
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

/** "Add sprinkle" page, then the item; the new row opens in place on the main page. */
function addSprinkle(name: RegExp | string) {
  fireEvent.click(screen.getByRole("button", { name: /Add sprinkle/ }));
  fireEvent.click(screen.getByRole("button", { name }));
}

const remove = () => fireEvent.click(screen.getByRole("button", { name: "Remove" }));

describe("step sheet", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("press: Sprinkles add and remove their fields; no raw names", () => {
    render(<Harness name="Press" />);
    const sheet = screen.getByRole("complementary");
    expect(sheet.textContent).not.toMatch(/timeoutMs|record|pressed|SELECTED_POD|shortMs/);
    expect(screen.queryByText("Seconds")).toBeNull();
    addSprinkle(/Time limit/);
    expect(block("Press").timeoutMs).toBe(2000);
    expect(screen.getByText(/max 2 s/)).toBeTruthy(); // the step text follows
    // the time-out exit is edited with the picker
    fireEvent.click(screen.getByRole("button", { name: /^If too slow/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Count a miss, then continue/ }));
    expect(ownBlocks(current).some((b) => b.type === "setVariable" && b.var === "MISSES")).toBe(true);
    remove();
    expect(block("Press").timeoutMs).toBeUndefined();
    expect(ownBlocks(current).some((b) => b.var === "MISSES")).toBe(false);
    addSprinkle(/Record reaction/);
    expect(block("Press").record).toBe("reaction");
    // a Sprinkle without settings has no body: its row carries "Remove"
    expect(screen.queryByRole("region", { name: "Record reaction" })).toBeNull();
    remove();
    expect(block("Press").record).toBeUndefined();
  });

  it("rows open in place, one at a time", () => {
    render(<Harness name="Press" />);
    addSprinkle(/Time limit/);
    addSprinkle(/Long press/);
    const head = (name: RegExp) => screen.getByRole("button", { name });
    expect(head(/^Long press/).getAttribute("aria-expanded")).toBe("true");
    expect(head(/^Time limit/).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(head(/^Time limit/));
    expect(head(/^Time limit/).getAttribute("aria-expanded")).toBe("true");
    expect(head(/^Long press/).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
  });

  it("the add page is grouped, offers only what the step does not have and suggests two", () => {
    render(<Harness name="Press" />);
    const suggested = screen.getAllByRole("button", { name: /^\+ / });
    expect(suggested.map((b) => b.textContent)).toEqual(["+ Time limit", "+ Record reaction"]);
    fireEvent.click(screen.getByRole("button", { name: /Add sprinkle/ }));
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Rules", "Measure", "Flow"]);
    expect(screen.getByRole("button", { name: /Time limit/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Hold first/ })).toBeNull(); // not for a press
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("button", { name: /Add sprinkle/ })).toBeTruthy();
  });

  it("pause: Fixed | Random", () => {
    render(<Harness name="Pause" />);
    fireEvent.click(screen.getByRole("radio", { name: "Random between" }));
    expect(block("Pause")).toMatchObject({ minMs: 1500, maxMs: 3000 });
    expect(screen.getByText("Shortest")).toBeTruthy();
    addSprinkle(/Catch early presses/);
    expect(block("Pause").type).toBe("button");
  });

  it("domination: team colours, length, start, cooldown, results and countdown", () => {
    render(<Harness name="Game" />);
    const sheet = screen.getByRole("complementary");
    expect(sheet.textContent).not.toMatch(/durationMs|cooldownMs|storeA|colors|allA/);
    expect(screen.getByText(/Domination: red against blue for 20 s/)).toBeTruthy();
    const team = (which: "A" | "B") => within(screen.getByRole("radiogroup", { name: `Colour of team ${which}` }));
    // the other team's colour is not offered, off never
    expect(team("A").queryByRole("radio", { name: "blue" })).toBeNull();
    expect(team("A").queryByRole("radio", { name: "off" })).toBeNull();
    fireEvent.click(team("A").getByRole("radio", { name: "green" }));
    expect(block("Game").colors).toEqual(["green", "blue"]);
    fireEvent.click(team("B").getByRole("radio", { name: "red" }));
    expect(block("Game").colors).toEqual(["green", "red"]);
    fireEvent.click(team("B").getByRole("radio", { name: "blue" }));
    fireEvent.click(team("A").getByRole("radio", { name: "red" }));
    expect(block("Game").colors).toBeUndefined(); // the default pair is not written
    // start
    const start = () => within(screen.getByRole("group", { name: "Who starts with which colour" }));
    fireEvent.click(start().getByRole("button", { name: "All team B" }));
    expect(block("Game").start).toBe("b");
    fireEvent.click(start().getByRole("button", { name: "Take turns" }));
    expect(block("Game").start).toBeUndefined();
    // length: fixed | random
    fireEvent.click(screen.getByRole("radio", { name: "Random between" }));
    expect(block("Game")).toMatchObject({ minDurationMs: 20000, maxDurationMs: 40000 });
    expect(block("Game").durationMs).toBeUndefined();
    fireEvent.click(screen.getByRole("radio", { name: "Always the same" }));
    expect(block("Game")).toMatchObject({ durationMs: 20000 });
    expect(block("Game").minDurationMs).toBeUndefined();
    // cooldown (More options): steps of 0.1 s
    fireEvent.click(screen.getByRole("button", { name: /More.*Pause between two presses/ }));
    expect(block("Game").cooldownMs).toBe(400);
    // results: a Sprinkle with a switch per result
    addSprinkle(/Keep result/);
    expect(block("Game")).toMatchObject({ storeA: "TEAM_A_PODS", storeFlips: "FLIPS" }); // all five to start with
    fireEvent.click(screen.getByRole("switch", { name: /^Pods of team A/ }));
    expect(block("Game").storeA).toBeUndefined();
    fireEvent.click(screen.getByRole("switch", { name: /^Number of flips/ }));
    expect(block("Game").storeFlips).toBeUndefined();
    fireEvent.click(screen.getByRole("switch", { name: /^Pods of team A/ }));
    expect(block("Game").storeA).toBe("TEAM_A_PODS");
    // a countdown over the whole game is always possible
    addSprinkle(/^Countdown/);
    expect(block("Game").countdown).toBe("drain");
    // the central takes part is on by default: removing it writes false
    expect(screen.getByText("Central takes part")).toBeTruthy();
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

  it("light effect: effect, colour, where, how long, speed and wait", () => {
    render(<Harness name="Glow" />);
    expect(screen.getByText(/Pulse the central blue/)).toBeTruthy();
    const kinds = within(screen.getByRole("group", { name: "Effect" }));
    // speed of a periodic effect is an essential
    fireEvent.click(screen.getByRole("button", { name: "More: Cycle time" }));
    expect(block("Glow").periodMs).toBe(600);
    fireEvent.click(kinds.getByRole("button", { name: "Fill up" }));
    expect(block("Glow")).toMatchObject({ effect: "fill", durationMs: 2000 });
    expect(screen.queryByText("Cycle time")).toBeNull();
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

  it("hold to charge: essentials, style, mode and the Sprinkles of the mode", () => {
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
    // draining exists only while the charge adds up
    fireEvent.click(screen.getByRole("button", { name: /Add sprinkle/ }));
    expect(screen.queryByRole("button", { name: /Drains over time/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Letting go pauses it" }));
    expect(block("Charge").mode).toBe("accumulate");
    addSprinkle(/Drains over time/);
    expect(block("Charge").decayMs).toBe(2000);
    expect(screen.getByText("Charge drains in")).toBeTruthy();
    // hold first: the first part of every hold does not charge yet
    addSprinkle(/Hold first/);
    expect(block("Charge").onsetMs).toBe(500);
    // time limit with the countdown
    addSprinkle(/Time limit/);
    expect(block("Charge").timeoutMs).toBe(2000);
    fireEvent.click(screen.getByRole("switch", { name: /Show the time running out/ }));
    expect(block("Charge").countdown).toBe("drain");
    // back to "ends when let go": the drain time goes with the mode
    fireEvent.click(screen.getByRole("radio", { name: "Letting go ends it" }));
    expect(block("Charge").decayMs).toBeUndefined();
  });

  it("let go: the mode switch moves between trigger and signal", () => {
    render(<Harness name="Let" />);
    expect(screen.queryByText("Colour of the signal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add sprinkle/ }));
    expect(screen.queryByRole("button", { name: /Record reaction/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Let go at a signal" }));
    expect(block("Let")).toMatchObject({ mode: "signal", minGoMs: 1500, maxGoMs: 3000 });
    expect(screen.getByRole("group", { name: "Colour of the signal" })).toBeTruthy();
    addSprinkle(/Record reaction/);
    expect(block("Let").record).toBe("reaction");
    fireEvent.click(screen.getByRole("radio", { name: "Always the same" }));
    expect(block("Let").goMs).toBe(1500);
    fireEvent.click(screen.getByRole("radio", { name: "Letting go starts it" }));
    expect(block("Let").mode).toBeUndefined();
    expect(block("Let").goMs).toBeUndefined();
    expect(block("Let").record).toBeUndefined();
    addSprinkle(/Time limit/);
    expect(block("Let").maxHoldMs).toBe(5000);
    expect(screen.getByText("Longest hold")).toBeTruthy();
  });

  it("countdown: a pause has a row of its own, a press has it inside Time limit", () => {
    render(<Harness name="Pause" />);
    addSprinkle(/^Countdown/);
    expect(block("Pause").countdown).toBe("drain");
    fireEvent.click(screen.getByRole("button", { name: "Changes colour" }));
    expect(block("Pause").countdown).toBe("colorShift");
    remove();
    expect(block("Pause").countdown).toBeUndefined();
    cleanup();

    render(<Harness name="Press" />);
    expect(screen.queryByRole("switch", { name: /Show the time running out/ })).toBeNull(); // no time limit yet
    addSprinkle(/Time limit/);
    fireEvent.click(screen.getByRole("switch", { name: /Show the time running out/ }));
    expect(block("Press").countdown).toBe("drain");
    remove(); // the countdown goes with the limit
    expect(block("Press").countdown).toBeUndefined();
  });

  it("a pod with program format 2 greys out what it cannot run", () => {
    render(<Harness name="Pause" format={2} />);
    fireEvent.click(screen.getByRole("button", { name: /Add sprinkle/ }));
    const countdown = screen.getByRole("button", { name: /Countdown/ }) as HTMLButtonElement;
    expect(countdown.disabled).toBe(true);
    expect(countdown.textContent).toMatch(/newer pod/);
    expect((screen.getByRole("button", { name: /Stopwatch/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("report to phone: results as plain choices, settings the coach may change", () => {
    render(<Harness name="Report" />);
    expect(screen.getByText("Results")).toBeTruthy();
    const all = screen.getByRole("checkbox", { name: "All results" }) as HTMLInputElement;
    expect(all.checked).toBe(true);
    fireEvent.click(all);
    expect(block("Report").metrics).toEqual(["reaction", "lap"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "lap" }));
    expect(block("Report").metrics).toEqual(["reaction"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "All results" }));
    expect(block("Report").metrics).toBeUndefined();
    // time-out in seconds
    addSprinkle(/Time limit/);
    expect(block("Report").timeoutMs).toBe(30000);
    remove();
    expect(block("Report").timeoutMs).toBeUndefined();
    // the coach changes settings
    addSprinkle(/Phone can change settings/);
    expect(block("Report").vars).toEqual(["ROUNDS"]);
    const coach = within(screen.getByRole("group", { name: "Coach may change while it waits" }));
    fireEvent.click(coach.getByRole("checkbox", { name: /Rounds/ }));
    expect(block("Report").editable).toEqual({ ROUNDS: { min: 0, max: 10 } });
    expect(screen.getByLabelText("Minimum of ROUNDS")).toBeTruthy();
  });

  it("exit picker: steps by number and sentence, one list for every exit", () => {
    render(<Harness name="Game" />);
    // a block exit shows under the essentials, unconnected team exits mean "the game goes on"
    fireEvent.click(screen.getByRole("button", { name: /^When everyone is team A/ }));
    const radios = within(screen.getByRole("radiogroup", { name: /When everyone is team A/ }));
    expect(radios.getByRole("radio", { name: /Step \d+ · Light the central blue/ })).toBeTruthy();
    expect(radios.queryByRole("radio", { name: /Count a miss/ })).toBeNull(); // not a failure exit
    expect(radios.queryByRole("radio", { name: /Next round/ })).toBeNull(); // not inside a Repeat
    fireEvent.click(radios.getByRole("radio", { name: /Step \d+ · Light the central blue/ }));
    expect(block("Game").allA).toBe("End");
    // that is where the game goes on after it: "Next step"
    expect(screen.getByRole("button", { name: "When everyone is team A: Next step" })).toBeTruthy();
    // unset: the game goes on until the time is up
    fireEvent.click(screen.getByRole("button", { name: /^When everyone is team A/ }));
    fireEvent.click(screen.getByRole("radio", { name: /The game goes on/ }));
    expect(block("Game").allA).toBeUndefined();
    expect(screen.getByRole("button", { name: "When everyone is team A: The game goes on" })).toBeTruthy();
  });

  it("then go to…: the main exit of any step, chosen in the picker", () => {
    render(<Harness name="Press" />);
    addSprinkle(/Then go to/);
    // the add button opens the picker; nothing is written until a step is chosen
    expect(block("Press").pressed).toBe("Pick");
    expect(screen.getByRole("radiogroup", { name: "Then" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Light the central blue/ }));
    expect(block("Press").pressed).toBe("End");
  });

  it("loop exits only inside a Repeat: next round and leave the loop", () => {
    render(<Harness name="Press" />);
    addSprinkle(/Time limit/);
    fireEvent.click(screen.getByRole("button", { name: /^If too slow/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Next round/ }));
    expect(block("Press").timeout).toBe("Rounds");
    fireEvent.click(screen.getByRole("button", { name: /^If too slow/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Leave the loop/ }));
    expect(block("Press").timeout).toBe("End");
  });

  it("repeat bracket: rounds as a stepper", () => {
    render(<Harness name="" round />);
    fireEvent.click(screen.getByRole("button", { name: "More: Rounds" }));
    expect((current.variables as Record<string, number>).ROUNDS).toBe(6);
  });
});
