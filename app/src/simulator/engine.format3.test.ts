/** Program format 3 in the simulator: `effect` block and `countdown` on the timed blocks (programs.md §2, §7). */
import { describe, expect, it } from "vitest";
import { validateProgram } from "@reactpod/program-model";
import { Simulator, type Rgb } from "./engine";

function inline(program: Record<string, unknown>, seed = 1) {
  const text = JSON.stringify({ version: 1, name: "T", ...program });
  return new Simulator(validateProgram("/prog/t.json", (p) => (p === "/prog/t.json" ? text : undefined)), { seed });
}

const entered = (sim: Simulator) => sim.snapshot().log.filter((e) => e.kind === "enter").map((e) => e.text);
const central = (sim: Simulator) => sim.snapshot().pods.find((p) => p.central)!;
const pod = (sim: Simulator, id: number) => sim.snapshot().pods[id]!;
const lit = (leds: Rgb[]) => leds.filter((c) => c[0] + c[1] + c[2] > 0).length;
const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 255, 0];
const OFF: Rgb = [0, 0, 0];

describe("effect block", () => {
  it("wait:false is an instant block: the effect starts after syncStartMs, the program goes on at once", () => {
    const sim = inline({
      blocks: [
        { name: "E", type: "effect", effect: "solid", color: "blue", next: "D" },
        { name: "D", type: "delay", ms: 1000 },
      ],
    });
    expect(entered(sim)).toEqual(["E"]);
    sim.advance(0);
    expect(entered(sim)).toEqual(["E", "D"]);
    expect(sim.snapshot().time).toBe(0);
    expect(central(sim).leds[0]).toEqual(OFF); // before the sync start
    sim.advance(19);
    expect(central(sim).leds[0]).toEqual(OFF);
    sim.advance(1);
    expect(central(sim).leds[0]).toEqual([0, 0, 255]);
  });

  it("wait:true finishes at start + syncStartMs + durationMs (default sync 20)", () => {
    const sim = inline({
      blocks: [
        { name: "E", type: "effect", effect: "blink", color: "red", durationMs: 300, wait: true, next: "Next" },
        { name: "Next", type: "led", color: "green", next: "End" },
        { name: "End", type: "delay", ms: 5000 },
      ],
    });
    sim.advance(319);
    expect(entered(sim)).toEqual(["E"]);
    sim.advance(1);
    expect(entered(sim)).toEqual(["E", "Next", "End"]);
    expect(sim.snapshot().log.find((e) => e.block === "Next")!.t).toBe(320);
  });

  it("syncStartMs is a value and moves the end", () => {
    const sim = inline({
      variables: { S: 100 },
      blocks: [
        { name: "E", type: "effect", effect: "pulse", durationMs: 200, syncStartMs: "S", wait: true, next: "Next" },
        { name: "Next", type: "delay", ms: 5000 },
      ],
    });
    sim.advance(299);
    expect(entered(sim)).toEqual(["E"]);
    sim.advance(1);
    expect(entered(sim)).toEqual(["E", "Next"]);
  });

  it("a later led replaces the effect", () => {
    const sim = inline({
      blocks: [
        { name: "E", type: "effect", effect: "blink", color: "red", periodMs: 200, next: "W" },
        { name: "W", type: "delay", ms: 500, next: "L" },
        { name: "L", type: "led", color: "green", next: "End" },
        { name: "End", type: "delay", ms: 5000 },
      ],
    });
    sim.advance(520);
    expect(central(sim).leds.every((c) => c[1] === 255 && c[0] === 0)).toBe(true);
    sim.advance(70); // a blink would be off or red by now
    expect(central(sim).leds[3]).toEqual(GREEN);
  });

  it("an endless blink alternates colour and colour2 by periodMs", () => {
    const sim = inline({
      blocks: [
        { name: "E", type: "effect", effect: "blink", color: "red", periodMs: 200, next: "W" },
        { name: "W", type: "delay", ms: 5000 },
      ],
    });
    sim.advance(21);
    expect(central(sim).leds[0]).toEqual(RED); // 1 ms into the first half
    sim.advance(100);
    expect(central(sim).leds[0]).toEqual(OFF);
    sim.advance(100);
    expect(central(sim).leds[0]).toEqual(RED);
  });

  it("leds limits the central effect, brightness scales it", () => {
    const sim = inline({
      blocks: [
        { name: "E", type: "effect", effect: "solid", color: "white", brightness: 100, leds: [0, 1], next: "W" },
        { name: "W", type: "delay", ms: 5000 },
      ],
    });
    sim.advance(25);
    const { leds } = central(sim);
    expect(lit(leds)).toBe(2);
    expect(leds[0]![0]).toBe(100);
  });

  it("target all / peripherals / pod id reach the peripherals", () => {
    const run = (target: unknown) => {
      const sim = inline({
        peripherals: 3,
        blocks: [
          { name: "E", type: "effect", effect: "solid", color: "blue", target, next: "W" },
          { name: "W", type: "delay", ms: 5000 },
        ],
      });
      sim.advance(30);
      return [0, 1, 2, 3].map((id) => lit(pod(sim, id).leds) > 0);
    };
    expect(run("all")).toEqual([true, true, true, true]);
    expect(run("peripherals")).toEqual([true, true, true, false]);
    expect(run(1)).toEqual([false, true, false, false]);
    expect(run("central")).toEqual([false, false, false, true]);
    expect(run(7)).toEqual([false, false, false, false]); // a pod that does not exist is ignored
  });

  it("an ARM on a pod replaces its effect", () => {
    const sim = inline({
      peripherals: 1,
      blocks: [
        { name: "E", type: "effect", effect: "blink", color: "blue", target: 0, next: "P" },
        { name: "P", type: "remotePress", pod: 0, color: "green" },
      ],
    });
    sim.advance(30);
    expect(pod(sim, 0).leds[0]).toEqual(GREEN);
    sim.advance(400);
    expect(pod(sim, 0).leds[0]).toEqual(GREEN);
  });

  it("skip wait jumps to the end of a waiting effect", () => {
    const sim = inline({
      blocks: [
        { name: "E", type: "effect", effect: "fill", color: "red", durationMs: 4000, wait: true, next: "N" },
        { name: "N", type: "delay", ms: 10 },
      ],
    });
    expect(sim.deadline()).toBe(4020);
    sim.skipWait();
    expect(sim.snapshot().current).toBe("N");
  });
});

describe("countdown", () => {
  const press = (sim: Simulator, id: number) => {
    sim.press(id);
    sim.advance(30);
    sim.release(id);
    sim.advance(1);
  };

  it("without countdown (or secret) nothing animates and format 1/2 programs run as before", () => {
    for (const countdown of [undefined, "secret"]) {
      const sim = inline({
        blocks: [
          { name: "L", type: "led", color: "green", next: "B" },
          { name: "B", type: "button", timeoutMs: 1000, countdown, next: "Ok", timeout: "T" },
          { name: "Ok", type: "led", color: "blue" },
          { name: "T", type: "led", color: "red" },
        ],
      });
      sim.advance(500);
      expect(central(sim).leds.every((c) => c[1] === 255)).toBe(true);
      sim.advance(500);
      expect(sim.snapshot().current).toBe("T");
    }
  });

  it("button: drain runs over the timeout in the ring's colour and is empty when the timeout port is taken", () => {
    const sim = inline({
      blocks: [
        { name: "L", type: "led", color: "green", next: "B" },
        { name: "B", type: "button", timeoutMs: 1800, countdown: "drain", next: "Ok", timeout: "T" },
        { name: "Ok", type: "led", color: "blue" },
        { name: "T", type: "delay", ms: 5000 },
      ],
    });
    sim.advance(1);
    expect(lit(central(sim).leds)).toBe(18);
    sim.advance(899);
    expect(lit(central(sim).leds)).toBe(9); // half way
    expect(central(sim).leds[0]).toEqual(GREEN);
    sim.advance(899);
    expect(sim.snapshot().current).toBe("B");
    expect(lit(central(sim).leds)).toBe(1);
    sim.advance(1);
    expect(sim.snapshot().current).toBe("T");
    expect(lit(central(sim).leds)).toBe(0);
  });

  it("button: a press stops the countdown", () => {
    const sim = inline({
      blocks: [
        { name: "L", type: "led", color: "green", next: "B" },
        { name: "B", type: "button", timeoutMs: 1000, countdown: "drain", next: "Ok", timeout: "T" },
        { name: "Ok", type: "delay", ms: 5000 },
        { name: "T", type: "led", color: "red" },
      ],
    });
    sim.advance(300);
    press(sim, 0);
    expect(sim.snapshot().current).toBe("Ok");
    const frozen = lit(central(sim).leds);
    expect(frozen).toBeGreaterThan(8); // the ring keeps the last frame of the countdown (programs.md §7.12)
    expect(frozen).toBeLessThan(18);
    sim.advance(1000);
    expect(lit(central(sim).leds)).toBe(frozen);
  });

  it("remotePress: the pod counts down from its lit colour and is dark when the timeout is taken", () => {
    const sim = inline({
      peripherals: 1,
      blocks: [
        { name: "P", type: "remotePress", pod: 0, color: "green", timeoutMs: 1200, countdown: "dim", next: "Ok", timeout: "To" },
        { name: "Ok", type: "delay", ms: 9000 },
        { name: "To", type: "delay", ms: 9000 },
      ],
    });
    sim.advance(1);
    expect(pod(sim, 0).leds[0]).toEqual(GREEN);
    sim.advance(599);
    expect(pod(sim, 0).leds[0]![1]).toBe(128);
    sim.advance(600);
    expect(sim.snapshot().current).toBe("To");
    expect(pod(sim, 0).leds[0]).toEqual(OFF);
  });

  it("remotePress: a press stops the countdown, the ring shows colorAfter", () => {
    const sim = inline({
      peripherals: 1,
      blocks: [
        { name: "P", type: "remotePress", pod: 0, color: "green", colorAfter: "blue", timeoutMs: 1200, countdown: "drain", next: "Ok", timeout: "To" },
        { name: "Ok", type: "delay", ms: 9000 },
        { name: "To", type: "delay", ms: 9000 },
      ],
    });
    sim.advance(300);
    press(sim, 0);
    expect(sim.snapshot().current).toBe("Ok");
    expect(lit(pod(sim, 0).leds)).toBe(0); // the block resets the pod after the press: no countdown frame is left
    sim.advance(500);
    expect(lit(pod(sim, 0).leds)).toBe(0);
  });

  it("remoteMultiPress: the central and the pods count down together to the timeout", () => {
    const sim = inline({
      peripherals: 2,
      blocks: [{ name: "M", type: "remoteMultiPress", timeoutMs: 2000, countdown: "fill", next: "Ok", timeout: "To" }, { name: "Ok", type: "delay", ms: 9000 }, { name: "To", type: "delay", ms: 9000 }],
    });
    sim.advance(21);
    const early = [0, 1, 2].map((id) => lit(pod(sim, id).leds));
    expect(early[0]).toBeLessThan(2);
    expect(early[0]).toBe(early[2]);
    sim.advance(989); // t = 1010: half of 20…2000
    expect(lit(pod(sim, 0).leds)).toBe(9);
    expect(lit(central(sim).leds)).toBe(9);
    sim.advance(989);
    expect(sim.snapshot().current).toBe("M");
    sim.advance(1);
    expect(sim.snapshot().current).toBe("To");
    expect(lit(pod(sim, 1).leds)).toBe(18);
  });

  it("delay: counts down from countdownFrom (default green) on the central", () => {
    const sim = inline({
      blocks: [
        { name: "D", type: "delay", ms: 1000, countdown: "colorShift", countdownColor: "red", next: "End" },
        { name: "End", type: "delay", ms: 9000 },
      ],
    });
    sim.advance(500);
    expect(central(sim).leds[0]).toEqual([128, 128, 0]);
    const blue = inline({
      blocks: [
        { name: "D", type: "delay", ms: 1000, countdown: "drain", countdownFrom: "blue", next: "End" },
        { name: "End", type: "delay", ms: 9000 },
      ],
    });
    blue.advance(1);
    expect(central(blue).leds[0]).toEqual([0, 0, 255]);
  });

  it("delay: with pods the countdown starts 20 ms after the entry on all targets and ends with the delay", () => {
    const sim = inline({
      peripherals: 1,
      blocks: [
        { name: "D", type: "delay", ms: 1020, countdown: "fill", countdownTarget: "all", next: "End" },
        { name: "End", type: "delay", ms: 9000 },
      ],
    });
    sim.advance(19);
    expect(lit(central(sim).leds) + lit(pod(sim, 0).leds)).toBe(0);
    sim.advance(501); // t = 520: half of 20 … 1020
    expect(lit(central(sim).leds)).toBe(9);
    expect(lit(pod(sim, 0).leds)).toBe(9);
    sim.advance(500);
    expect(sim.snapshot().current).toBe("End");
    expect(lit(central(sim).leds)).toBe(18); // the ring keeps the end frame
  });

  it("delay: target peripherals leaves the central alone, a pod id aims at one pod", () => {
    const run = (countdownTarget: unknown) => {
      const sim = inline({
        peripherals: 2,
        blocks: [
          { name: "D", type: "delay", ms: 1020, countdown: "dim", countdownTarget, next: "End" },
          { name: "End", type: "delay", ms: 9000 },
        ],
      });
      sim.advance(100);
      return [0, 1, 2].map((id) => lit(pod(sim, id).leds) > 0);
    };
    expect(run("peripherals")).toEqual([true, true, false]);
    expect(run(1)).toEqual([false, true, false]);
    expect(run(2)).toEqual([false, false, true]); // the central's own id is the central
  });

  it("trafficLight counts down green, yellow, red", () => {
    const sim = inline({
      blocks: [
        { name: "D", type: "delay", ms: 900, countdown: "trafficLight", next: "End" },
        { name: "End", type: "delay", ms: 9000 },
      ],
    });
    const at = (t: number) => {
      sim.advance(t - sim.snapshot().time);
      return central(sim).leds[0];
    };
    expect([at(100), at(450), at(850)]).toEqual([GREEN, [255, 255, 0], RED]);
  });

  it("remoteMultiPress: a pressed central switches off and the other pods keep counting after a timeout", () => {
    const sim = inline({
      peripherals: 1,
      blocks: [
        { name: "M", type: "remoteMultiPress", timeoutMs: 1000, countdown: "drain", next: "Ok", timeout: "To" },
        { name: "Ok", type: "delay", ms: 9000 },
        { name: "To", type: "delay", ms: 9000 },
      ],
    });
    sim.advance(100);
    press(sim, 1); // the central
    expect(lit(central(sim).leds)).toBe(0);
    sim.advance(950);
    expect(sim.snapshot().current).toBe("To");
    expect(lit(pod(sim, 0).leds)).toBe(0); // counted down to the end together with the timeout
  });
});

describe("effect block, firmware semantics", () => {
  it("blink without duration is endless, with a duration it ends in a steady colour", () => {
    const sim = inline({
      blocks: [
        { name: "E", type: "effect", effect: "blink", color: "red", periodMs: 200, durationMs: 400, wait: true, next: "W" },
        { name: "W", type: "delay", ms: 9000 },
      ],
    });
    sim.advance(430);
    expect(central(sim).leds[0]).toEqual(RED);
    sim.advance(100);
    expect(central(sim).leds.every((c) => c[0] === 255)).toBe(true);
  });

  it("the central's own pod id as target is the central", () => {
    const sim = inline({
      peripherals: 2,
      blocks: [
        { name: "E", type: "effect", effect: "solid", color: "blue", target: 2, next: "W" },
        { name: "W", type: "delay", ms: 9000 },
      ],
    });
    sim.advance(30);
    expect(lit(central(sim).leds)).toBe(18);
    expect(lit(pod(sim, 0).leds)).toBe(0);
  });

  it("a wait:false effect keeps running while the next blocks execute", () => {
    const sim = inline({
      blocks: [
        { name: "E", type: "effect", effect: "fill", color: "red", durationMs: 1000, next: "W" },
        { name: "W", type: "delay", ms: 9000 },
      ],
    });
    sim.advance(520);
    expect(lit(central(sim).leds)).toBe(9);
  });
});
