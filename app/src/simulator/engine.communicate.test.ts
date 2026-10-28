/** Program format 5 in the simulator: the `communicate` block (programs.md §7.16, config-api.md §5). */
import { describe, expect, it } from "vitest";
import { colorToRgb, validateProgram } from "@reactpod/program-model";
import { Simulator } from "./engine";

const BLOCKS = [
  { name: "Hit", type: "button", record: "reaction", next: "Rep" },
  {
    name: "Rep",
    type: "communicate",
    timeoutMs: 3000,
    metrics: ["reaction"],
    vars: ["RUNS"],
    editable: { MAX_LOOPS: { min: 1, max: 50 } },
    next: "Next",
    pressed: "Hit",
    timeout: "End",
    repeat: "Hit",
    stop: "End",
  },
  { name: "Next", type: "delay", ms: 5, next: "End" },
  { name: "End", type: "delay", ms: 5000 },
];

function sim(blocks: unknown[] = BLOCKS, options: { program?: string; setId?: string; athlete?: string } = {}) {
  const text = JSON.stringify({ version: 1, name: "T", peripherals: 0, variables: { RUNS: 0, MAX_LOOPS: 12 }, blocks });
  return new Simulator(validateProgram("/prog/t.json", (p) => (p === "/prog/t.json" ? text : undefined)), {
    seed: 1,
    program: "/prog/t.json",
    setId: "S1",
    ...options,
  });
}

/** Starts at the first button (the start block), presses it at t = 200 so that the reaction is 200 ms. */
function reach(s: Simulator) {
  s.advance(200);
  s.press(0);
  s.release(0);
  s.advance(1);
  expect(s.currentBlock).toBe("Rep");
}

const current = (s: Simulator) => s.currentBlock;

describe("communicate block", () => {
  it("on enter builds the report from the period's values, stats and listed variables, then waits", () => {
    const s = sim();
    reach(s);
    const waiting = s.snapshot().waiting!;
    expect(waiting.block).toBe("Rep");
    expect(waiting.report).toMatchObject({
      id: 1,
      program: "/prog/t.json",
      setId: "S1",
      cycle: 1,
      startMs: 0,
      endMs: 201,
      values: [{ metric: "reaction", pod: 0, ms: 200 }],
      stats: { reaction: { count: 1, average: 200, best: 200, worst: 200 } },
      vars: { RUNS: 0 },
    });
    expect(waiting.report).not.toHaveProperty("valuesDropped");
    expect(waiting.report).not.toHaveProperty("athlete");
    expect(waiting.editable).toEqual({ MAX_LOOPS: { min: 1, max: 50, value: 12 } });
    // the central's LEDs show the block's colour while it waits
    expect(s.snapshot().pods.at(-1)!.leds[0]).toEqual(colorToRgb("cyan"));
  });

  it("a press leads to the pressed port, a client command to its port, the timeout to timeout", () => {
    const pressed = sim();
    reach(pressed);
    pressed.advance(100); // past the button's debounce
    pressed.press(0);
    pressed.release(0);
    pressed.advance(1);
    expect(current(pressed)).toBe("Hit"); // the pressed port goes back to the button

    const next = sim();
    reach(next);
    expect(next.command("continue")).toBe(true);
    next.advance(1);
    expect(current(next)).toBe("Next");

    const repeat = sim();
    reach(repeat);
    repeat.command("repeat");
    repeat.advance(1);
    expect(current(repeat)).toBe("Hit");

    const stop = sim();
    reach(stop);
    stop.command("stop");
    stop.advance(1);
    expect(current(stop)).toBe("End");

    const timedOut = sim();
    reach(timedOut);
    timedOut.advance(2999);
    expect(current(timedOut)).toBe("Rep");
    timedOut.advance(1);
    expect(current(timedOut)).toBe("End");
  });

  it("the client command wins over a press in the same pass", () => {
    const s = sim();
    reach(s);
    s.press(0);
    s.release(0);
    s.command("continue");
    s.advance(1);
    expect(current(s)).toBe("Next");
  });

  it("command answers not_ready (false) when nothing waits", () => {
    const s = sim();
    expect(s.command("continue")).toBe(false); // the button waits, not the communicate block
    expect(s.snapshot().waiting).toBeNull();
  });

  it("setVariables only while waiting, only editable variables within min … max, all or nothing", () => {
    const s = sim();
    expect(s.setVariables({ MAX_LOOPS: 5 })).toBe("not_ready");
    reach(s);
    expect(s.setVariables({ RUNS: 3 })).toBe("not_editable");
    expect(s.setVariables({ MAX_LOOPS: 0 })).toBe("out_of_range");
    expect(s.setVariables({ MAX_LOOPS: 51 })).toBe("out_of_range");
    expect(s.setVariables({ MAX_LOOPS: 2.5 })).toBe("out_of_range");
    expect(s.setVariables({ MAX_LOOPS: 5, RUNS: 3 })).toBe("not_editable");
    expect(s.snapshot().variables.MAX_LOOPS).toBe(12); // nothing was written
    expect(s.setVariables({ MAX_LOOPS: 5 })).toBe("ok");
    expect(s.snapshot().variables.MAX_LOOPS).toBe(5);
    expect(s.snapshot().waiting!.editable.MAX_LOOPS!.value).toBe(5);
    s.command("continue");
    s.advance(1);
    expect(s.setVariables({ MAX_LOOPS: 6 })).toBe("not_ready");
  });

  it("keeps 8 reports in the buffer, drops the oldest and counts it; ack removes reports up to an id", () => {
    const loop = [
      { name: "Rep", type: "communicate", next: "Rep", repeat: "Rep", stop: "End" },
      { name: "End", type: "delay", ms: 5000 },
    ];
    const s = sim(loop);
    expect(s.snapshot().waiting!.report.id).toBe(1);
    for (let i = 0; i < 9; i++) {
      s.advance(10);
      s.command("continue");
      s.advance(1);
    }
    const buffer = s.reportBuffer();
    expect(buffer.pending.map((r) => r.id)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(buffer.dropped).toBe(2);
    expect(buffer.pending.at(-1)!.cycle).toBe(10);
    // each report starts where the previous one ended
    expect(buffer.pending[1]!.startMs).toBe(buffer.pending[0]!.endMs);
    s.command("stop");
    s.advance(1);
    s.ack(5);
    expect(s.reportBuffer().pending.map((r) => r.id)).toEqual([6, 7, 8, 9, 10]);
  });

  it("a program start restarts cycles and the first start, not the ids or the buffer", () => {
    const s = sim(BLOCKS.slice(1));
    expect(s.snapshot().waiting!.report).toMatchObject({ id: 1, cycle: 1 });
    s.reset(2);
    expect(s.snapshot().waiting!.report).toMatchObject({ id: 2, cycle: 1, startMs: 0 });
    expect(s.reportBuffer().pending).toHaveLength(2);
  });

  it("lists at most 48 values, counts the rest in valuesDropped, and the stats cover all of them", () => {
    const loop = [
      { name: "Hit", type: "button", record: "reaction", pressed: "Hit", timeoutMs: 100000, timeout: "Rep" },
      { name: "Rep", type: "communicate", metrics: [], next: "End" },
      { name: "End", type: "delay", ms: 5000 },
    ];
    const s = sim(loop);
    for (let i = 0; i < 50; i++) {
      s.advance(30);
      s.press(0);
      s.release(0);
    }
    s.advance(200000); // the last press re-enters the button, its timeout (100 s) then leads to Rep
    expect(current(s)).toBe("Rep");
    const report = s.snapshot().waiting!.report;
    expect(report.values).toHaveLength(48);
    expect(report.valuesDropped).toBe(2);
    expect(report.stats.reaction!.count).toBe(50);
  });

  it("metrics [] lists all metrics", () => {
    const s = sim(BLOCKS.map((b) => (b.name === "Rep" ? { ...b, metrics: [] } : b)));
    reach(s);
    expect(s.snapshot().waiting!.report.values).toHaveLength(1);
  });

  it("the athlete of the session is copied into every report", () => {
    const s = sim(BLOCKS, { athlete: "ath_42" });
    reach(s);
    expect(s.snapshot().waiting!.report.athlete).toBe("ath_42");
  });

  it("paused: the block does not wait; resuming builds no second report and restarts the timeout", () => {
    const s = sim();
    reach(s);
    s.advance(500);
    s.pause();
    expect(s.snapshot().waiting).toBeNull();
    expect(s.command("continue")).toBe(false);
    expect(s.setVariables({ MAX_LOOPS: 5 })).toBe("not_ready");
    s.advance(2000); // nothing runs while paused, the timeout does not come
    expect(current(s)).toBe("Rep");
    s.restartCurrentBlock(); // at t = 2701: the timeout starts again
    expect(s.reportBuffer().pending).toHaveLength(1);
    expect(s.snapshot().waiting!.report.id).toBe(1);
    s.advance(2999);
    expect(current(s)).toBe("Rep");
    s.advance(1);
    expect(current(s)).toBe("End");
  });
});
