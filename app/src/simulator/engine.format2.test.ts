/** Program format 2 in the simulator: timers (programs.md §7.9) and `repeat` (§7.10), one test per bullet. */
import { describe, expect, it } from "vitest";
import { validateProgram } from "@reactpod/program-model";
import { MAX_STEPS_PER_PASS, Simulator } from "./engine";

function inline(program: Record<string, unknown>, seed = 1) {
  const text = JSON.stringify({ version: 1, name: "T", ...program });
  return new Simulator(validateProgram("/prog/t.json", (p) => (p === "/prog/t.json" ? text : undefined)), { seed });
}

const entered = (sim: Simulator) => sim.snapshot().log.filter((e) => e.kind === "enter").map((e) => e.text);
const measured = (sim: Simulator, metric?: string) =>
  sim
    .snapshot()
    .measurements.filter((m) => metric === undefined || m.metric === metric)
    .map((m) => m.ms);
const click = (sim: Simulator, pod: number, holdMs = 30) => {
  sim.press(pod);
  sim.advance(holdMs);
  sim.release(pod);
};

describe("timers (programs.md §7.9)", () => {
  it("starts when the block is entered and records when it is left, for the central's pod id", () => {
    const sim = inline({
      peripherals: 2,
      blocks: [
        { name: "A", type: "delay", ms: 100, timerStart: "lap", next: "B" },
        { name: "B", type: "delay", ms: 50, next: "C" },
        { name: "C", type: "led", color: "red", timerStop: "lap", next: "D" },
        { name: "D", type: "delay", ms: 1000 },
      ],
    });
    sim.advance(500);
    const { measurements, log } = sim.snapshot();
    expect(measurements).toEqual([{ t: 150, metric: "lap", pod: 2, ms: 150 }]);
    expect(log.some((e) => e.kind === "result" && e.text === "RESULT,150,lap,2,150")).toBe(true);
  });

  it("is recorded like `record`: statistics and summary", () => {
    const sim = inline({
      variables: { AVG: 0 },
      blocks: [
        { name: "A", type: "delay", ms: 40, timerStart: "t", timerStop: "t", next: "S" },
        { name: "S", type: "summary", metric: "t", storeAverage: "AVG", storeCount: "N" },
      ],
    });
    sim.advance(100);
    expect(sim.snapshot().variables).toMatchObject({ AVG: 40, N: 1 });
    expect(sim.snapshot().log.some((e) => e.text === "SUMMARY,t,1,40,40,40")).toBe(true);
  });

  it("a start on a running timer restarts it", () => {
    const sim = inline({
      blocks: [
        { name: "A", type: "delay", ms: 100, timerStart: "t", next: "B" },
        { name: "B", type: "delay", ms: 30, timerStart: "t", next: "C" },
        { name: "C", type: "led", color: "red", timerStop: "t" },
      ],
    });
    sim.advance(500);
    expect(measured(sim, "t")).toEqual([30]);
  });

  it("stops when the program ends in the block", () => {
    const sim = inline({
      blocks: [
        { name: "A", type: "delay", ms: 70, timerStart: "t", next: "B" },
        { name: "B", type: "delay", ms: 20, timerStop: "t" },
      ],
    });
    expect(sim.advance(500)).toBe("ended");
    expect(measured(sim, "t")).toEqual([90]);
  });

  it("a stop on a timer that is not running is ignored and counted", () => {
    const sim = inline({
      blocks: [
        { name: "A", type: "delay", ms: 10, timerStop: "t", next: "B" },
        { name: "B", type: "delay", ms: 10, timerStart: "t", timerStop: "t", next: "C" },
        { name: "C", type: "delay", ms: 10, timerStop: "t", next: "D" },
        { name: "D", type: "delay", ms: 10, timerStop: "other" },
      ],
    });
    sim.advance(100);
    expect(measured(sim)).toEqual([10]); // only B
    expect(sim.snapshot().timers).toEqual({ orphanStops: 3 }); // A, C, D
  });

  it("stops the old block's timer before the new block's start", () => {
    // B stops "t" and C restarts it: C's own start is not undone by B's stop
    const sim = inline({
      blocks: [
        { name: "A", type: "delay", ms: 10, timerStart: "t", next: "B" },
        { name: "B", type: "delay", ms: 20, timerStop: "t", next: "C" },
        { name: "C", type: "delay", ms: 40, timerStart: "t", next: "D" },
        { name: "D", type: "led", color: "red", timerStop: "t" },
      ],
    });
    sim.advance(200);
    expect(measured(sim, "t")).toEqual([30, 40]);
    expect(sim.snapshot().timers.orphanStops).toBe(0);
  });

  it("a block that links to itself with both fields records each pass", () => {
    const sim = inline({ blocks: [{ name: "Tap", type: "button", timerStart: "tap", timerStop: "tap", pressed: "Tap" }] });
    sim.advance(100);
    click(sim, 0); // press at 100, seen in the pass at 101 (accurate to one loop pass)
    sim.advance(200);
    click(sim, 0); // press at 330, seen at 331
    sim.advance(5);
    expect(measured(sim, "tap")).toEqual([101, 230]);
  });

  it("an instant block's own duration is 0 ms", () => {
    const sim = inline({
      blocks: [
        { name: "A", type: "led", color: "red", timerStart: "t", timerStop: "t", next: "B" },
        { name: "B", type: "setVariable", var: "X", value: 1, timerStart: "u", next: "C" },
        { name: "C", type: "if", left: 1, right: 1, timerStop: "u", true: "D" },
        { name: "D", type: "delay", ms: 1000 },
      ],
    });
    sim.advance(5);
    expect(measured(sim)).toEqual([0, 0]);
  });

  it("on a waiting block the stop time is the press (central and peripheral)", () => {
    const sim = inline({
      peripherals: 1,
      blocks: [
        { name: "Go", type: "led", color: "green", timerStart: "lap", next: "Wait" },
        { name: "Wait", type: "button", timerStop: "lap", next: "Pod" },
        { name: "Pod", type: "remotePress", pod: 0, timerStart: "pod", timerStop: "pod", next: "End" },
        { name: "End", type: "delay", ms: 10000 },
      ],
    });
    sim.advance(120);
    sim.press(1); // central, still held: the block leaves on the release (short)
    sim.advance(300);
    sim.release(1); // at 420, seen in the pass at 421: the block is left on the release
    sim.advance(1);
    expect(measured(sim, "lap")).toEqual([421]);
    sim.advance(250);
    click(sim, 0); // the pod's press at 671, received in the pass at 672
    sim.advance(1);
    expect(measured(sim, "pod")).toEqual([251]);
  });

  it("a pause does not leave the block: timers keep running and are neither started nor stopped", () => {
    const sim = inline({
      blocks: [
        { name: "A", type: "delay", ms: 10, timerStart: "t", next: "B" },
        { name: "B", type: "delay", ms: 100, timerStart: "u", timerStop: "t", next: "C" },
        { name: "C", type: "led", color: "red", timerStop: "u" },
      ],
    });
    sim.advance(50);
    expect(sim.currentBlock).toBe("B");
    sim.restartCurrentBlock(); // at 50: B starts its 100 ms again, "u" is not restarted
    expect(measured(sim)).toEqual([]);
    sim.advance(200);
    expect(entered(sim)).toEqual(["A", "B", "B", "C"]);
    // t: 0 → 150 (the pause counts), u: 10 → 150
    expect(sim.snapshot().measurements.map((m) => [m.metric, m.ms])).toEqual([
      ["t", 150],
      ["u", 140],
    ]);
  });

  it("all timers are stopped and the orphan count is 0 when the program starts", () => {
    const sim = inline({
      blocks: [
        { name: "A", type: "delay", ms: 10, timerStop: "x", next: "B" },
        { name: "B", type: "delay", ms: 10, timerStart: "t", next: "C" },
        { name: "C", type: "button", timerStop: "t", next: "D" },
        { name: "D", type: "delay", ms: 10, timerStop: "t" },
      ],
    });
    sim.advance(50);
    expect(sim.snapshot().timers.orphanStops).toBe(1);
    sim.reset(1); // "t" was running in C
    expect(sim.snapshot().timers.orphanStops).toBe(0);
    sim.advance(50);
    click(sim, 0);
    sim.advance(50);
    expect(measured(sim, "t")).toEqual([71]); // started anew in B at 10, stopped on the release (80, seen at 81)
    expect(sim.snapshot().timers.orphanStops).toBe(2); // A and D
  });

  it("the start block's timer starts at the program start", () => {
    const sim = inline({ blocks: [{ name: "A", type: "delay", ms: 25, timerStart: "t", timerStop: "t" }] });
    sim.advance(100);
    expect(measured(sim, "t")).toEqual([25]);
  });
});

describe("repeat (programs.md §7.10)", () => {
  const counted = (count: unknown, more: Record<string, unknown> = {}) =>
    inline({
      variables: { N: 3, I: 0, BODY: 0, DONE: 0 },
      ...more,
      blocks: [
        { name: "R", type: "repeat", count, storeIndex: "I", body: "Body", done: "Done" },
        { name: "Body", type: "setVariable", var: "BODY", op: "+", value: 1, next: "Wait" },
        { name: "Wait", type: "delay", ms: 10, next: "R" },
        { name: "Done", type: "setVariable", var: "DONE", op: "+", value: 1, next: "Pause" },
        { name: "Pause", type: "delay", ms: 100, next: "R" },
      ],
    });

  it("count 3 gives body, body, body, done; the next entry starts again with pass 1", () => {
    const sim = counted(3);
    sim.advance(40); // three passes of 10 ms
    expect(entered(sim).filter((n) => n === "Body" || n === "Done")).toEqual(["Body", "Body", "Body", "Done"]);
    sim.advance(100); // Done at 30 → Pause until 130 → R: pass 1 again
    const v = sim.snapshot().variables;
    expect(v.DONE).toBe(1);
    expect(v.BODY).toBeGreaterThanOrEqual(4);
    expect(entered(sim).filter((n) => n === "Body" || n === "Done").slice(0, 5)).toEqual(["Body", "Body", "Body", "Done", "Body"]);
  });

  it("stores the pass 1 … count in storeIndex; done keeps the last value", () => {
    const sim = counted(3);
    const seen: number[] = [];
    while (seen.length < 4) {
      sim.advance(1000, { breakpoints: new Set(["Body", "Done"]) });
      seen.push(sim.snapshot().variables.I!);
    }
    expect(seen).toEqual([1, 2, 3, 3]);
  });

  it("reads count on execute: a variable, changed during the loop", () => {
    const sim = counted("N");
    sim.advance(1000, { breakpoints: new Set(["Done"]) });
    expect(sim.snapshot().variables.BODY).toBe(3);

    // lowered below the passes already made (3 → 2 in pass 3): the loop ends at the next entry
    const self = inline({
      variables: { N: 5, I: 0 },
      blocks: [
        { name: "R", type: "repeat", count: "N", storeIndex: "I", body: "Check", done: "Done" },
        { name: "Check", type: "if", left: "I", op: "==", right: 3, true: "Lower", false: "R" },
        { name: "Lower", type: "setVariable", var: "N", value: 2, next: "R" },
        { name: "Done", type: "delay", ms: 1000 },
      ],
    });
    self.advance(1);
    expect(self.currentBlock).toBe("Done");
    expect(self.snapshot().variables.I).toBe(3);
    expect(entered(self).filter((n) => n === "Check")).toHaveLength(3);
  });

  it("count <= 0 leaves through done on every entry and never sets storeIndex", () => {
    for (const count of [0, -2]) {
      const sim = counted(count);
      sim.advance(500);
      const v = sim.snapshot().variables;
      expect(v.BODY).toBe(0);
      expect(v.DONE).toBeGreaterThanOrEqual(3);
      expect(v.I).toBe(0);
    }
  });

  it("unconnected body or done fall back to next; with neither the program ends", () => {
    const fallback = inline({
      variables: { HITS: 0 },
      blocks: [
        { name: "R", type: "repeat", count: 2, next: "Hit", done: "End" },
        { name: "Hit", type: "setVariable", var: "HITS", op: "+", value: 1, next: "R" },
        { name: "End", type: "delay", ms: 1000 },
      ],
    });
    fallback.advance(1);
    expect(fallback.currentBlock).toBe("End");
    expect(fallback.snapshot().variables.HITS).toBe(2);

    const doneFallback = inline({
      blocks: [
        { name: "R", type: "repeat", count: 1, body: "Body", next: "End" },
        { name: "Body", type: "led", color: "red", next: "R" },
        { name: "End", type: "delay", ms: 1000 },
      ],
    });
    doneFallback.advance(1);
    expect(entered(doneFallback)).toEqual(["R", "Body", "R", "End"]);

    const neither = inline({ blocks: [{ name: "R", type: "repeat", count: 3 }] });
    expect(neither.advance(5)).toBe("ended");
    expect(neither.snapshot().log.at(-1)?.text).toBe("program ended in block 'R' (body)");
  });

  it("nested repeats count independently: outer 2 around inner 3 runs the inner body 6 times", () => {
    const sim = inline({
      variables: { INNER: 0, OUTER_DONE: 0 },
      blocks: [
        { name: "Outer", type: "repeat", count: 2, body: "Inner", done: "End" },
        { name: "Inner", type: "repeat", count: 3, body: "Body", done: "Outer" },
        { name: "Body", type: "setVariable", var: "INNER", op: "+", value: 1, next: "Inner" },
        { name: "End", type: "delay", ms: 1000 },
      ],
    });
    sim.advance(1);
    expect(sim.currentBlock).toBe("End");
    expect(sim.snapshot().variables.INNER).toBe(6);
  });

  it("is an instant block and follows the step limit", () => {
    const sim = inline({
      variables: { K: 0 },
      blocks: [
        { name: "R", type: "repeat", count: 1000, storeIndex: "K", body: "R" },
      ],
    });
    sim.advance(1); // t = 0 and t = 1: two passes
    expect(sim.snapshot().variables.K).toBe(2 * MAX_STEPS_PER_PASS);
  });

  it("a pause does not change the counter", () => {
    const sim = counted(3);
    sim.advance(1000, { breakpoints: new Set(["R"]) }); // after pass 1: R entered for pass 2, not executed yet
    expect(sim.currentBlock).toBe("R");
    expect(sim.snapshot().variables.I).toBe(1);
    sim.restartCurrentBlock();
    sim.restartCurrentBlock();
    sim.advance(1000, { breakpoints: new Set(["Done"]) });
    expect(sim.snapshot().variables.BODY).toBe(3);
  });

  it("the counter is 0 when the program starts", () => {
    const sim = counted(3);
    sim.advance(15); // pass 2 running
    expect(sim.snapshot().variables.I).toBe(2);
    sim.reset(1);
    sim.advance(1000, { breakpoints: new Set(["Done"]) });
    expect(sim.snapshot().variables.BODY).toBe(3);
  });

  it("a counter left in the body keeps its value until the block next reaches done", () => {
    const sim = inline({
      variables: { BODY: 0, OUT: 0 },
      blocks: [
        { name: "R", type: "repeat", count: 3, storeIndex: "I", body: "Body", done: "Done" },
        { name: "Body", type: "setVariable", var: "BODY", op: "+", value: 1, next: "Leave" },
        { name: "Leave", type: "if", left: "BODY", op: "==", right: 2, true: "Out", false: "R" },
        { name: "Out", type: "setVariable", var: "OUT", op: "+", value: 1, next: "R" },
        { name: "Done", type: "delay", ms: 1000 },
      ],
    });
    // passes 1, 2 → left the body after pass 2 (through Out), comes back for pass 3 → done
    sim.advance(1);
    expect(sim.currentBlock).toBe("Done");
    expect(sim.snapshot().variables).toMatchObject({ BODY: 3, OUT: 1, I: 3 });
  });

  it("repeat with timers: a lap per round", () => {
    const sim = inline({
      blocks: [
        { name: "R", type: "repeat", count: 2, body: "Go", done: "S" },
        { name: "Go", type: "led", color: "green", timerStart: "lap", next: "Wait" },
        { name: "Wait", type: "button", timerStop: "lap", pressed: "R" },
        { name: "S", type: "summary", metric: "lap", storeCount: "N" },
      ],
    });
    sim.advance(100);
    click(sim, 0);
    sim.advance(200);
    click(sim, 0);
    sim.advance(5);
    expect(measured(sim, "lap")).toEqual([101, 230]);
    expect(sim.isRunning).toBe(false);
    expect(sim.snapshot().variables.N).toBe(2);
  });
});
