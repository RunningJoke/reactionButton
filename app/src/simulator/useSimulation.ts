/** A Simulator driven in real time (speed ×0.25 … ×4) for the Simulate page. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedProgram } from "@reactpod/program-model";
import { Simulator, type Snapshot, type StopReason } from "./engine";

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/** At most this much simulated time per frame, so a slow frame does not jump ahead. */
const MAX_FRAME_MS = 250;

export type SimulationControls = {
  snapshot: Snapshot;
  playing: boolean;
  /** why the last run / step stopped (shown as status) */
  stop: StopReason | null;
  speed: number;
  seed: number;
  breakpoints: ReadonlySet<string>;
  play: () => void;
  pause: () => void;
  step: () => void;
  skipWait: () => void;
  reset: (seed?: number) => void;
  setSpeed: (speed: number) => void;
  toggleBreakpoint: (block: string) => void;
  press: (pod: number) => void;
  release: (pod: number) => void;
  trace: () => string;
};

export function useSimulation(program: ResolvedProgram | null, initialSeed = 1): SimulationControls | null {
  const [seed, setSeed] = useState(initialSeed);
  // a new program makes a new simulator; a new seed only resets it (see reset)
  const sim = useMemo(() => (program ? new Simulator(program, { seed }) : null), [program]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => sim?.snapshot() ?? null);
  const [playing, setPlaying] = useState(false);
  const [stop, setStop] = useState<StopReason | null>(null);
  const [speed, setSpeed] = useState(1);
  const [breakpoints, setBreakpoints] = useState<ReadonlySet<string>>(new Set());
  const bpRef = useRef(breakpoints);
  bpRef.current = breakpoints;

  const refresh = useCallback(() => sim && setSnapshot(sim.snapshot()), [sim]);

  useEffect(() => {
    setPlaying(false);
    setStop(null);
    setBreakpoints(new Set());
    refresh();
  }, [sim, refresh]);

  // real-time loop
  useEffect(() => {
    if (!sim || !playing) return;
    let frame = 0;
    let last = performance.now();
    let carry = 0;
    const tick = (now: number) => {
      carry += Math.min(now - last, MAX_FRAME_MS) * speed;
      last = now;
      const whole = Math.floor(carry);
      carry -= whole;
      const reason = sim.advance(whole, { breakpoints: bpRef.current });
      setSnapshot(sim.snapshot());
      if (reason === "paused" || reason === "ended") {
        setPlaying(false);
        setStop(reason);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sim, playing, speed]);

  if (!sim || !snapshot) return null;

  return {
    snapshot,
    playing,
    stop,
    speed,
    seed,
    breakpoints,
    play: () => {
      if (!sim.isRunning) return;
      setStop(null);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    step: () => {
      setPlaying(false);
      setStop(sim.step());
      refresh();
    },
    skipWait: () => {
      setStop(sim.skipWait());
      refresh();
    },
    reset: (next = seed) => {
      setSeed(next);
      setPlaying(false);
      setStop(null);
      sim.reset(next);
      refresh();
    },
    setSpeed,
    toggleBreakpoint: (block) => {
      const next = new Set(breakpoints);
      if (next.has(block)) next.delete(block);
      else next.add(block);
      setBreakpoints(next);
    },
    // while paused, a press is handled at once (step mode: the waiting block reacts to it)
    press: (pod) => {
      sim.press(pod);
      if (!playing && sim.isRunning) setStop(sim.step());
      refresh();
    },
    release: (pod) => {
      sim.release(pod);
      if (!playing && sim.isRunning) setStop(sim.step());
      refresh();
    },
    trace: () => sim.traceText(),
  };
}
