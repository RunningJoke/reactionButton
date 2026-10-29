/**
 * Battery of a pod (firmware ≥ 2.13, docs/firmware/config-api.md §5). The firmware reports the
 * percent itself; this curve is the same table as firmware/src/Battery/Battery.cpp, used by the
 * demo pod and for display of a bare voltage.
 */

/** Below this level the pod blinks amber while idle (firmware LOW_PERCENT). */
export const LOW_BATTERY_PERCENT = 15;

/** The central refuses to start a game below this level (firmware CRITICAL_PERCENT). */
export const CRITICAL_BATTERY_PERCENT = 5;

/** Cell voltage (mV) -> percent of a single Li-ion cell, piecewise linear. */
const CURVE: readonly [mv: number, percent: number][] = [
  [3300, 0],
  [3400, 3],
  [3500, 7],
  [3600, 15],
  [3700, 30],
  [3800, 45],
  [3900, 60],
  [4000, 75],
  [4100, 90],
  [4200, 100],
];

export function batteryPercent(cellMv: number): number {
  const first = CURVE[0]!;
  const last = CURVE[CURVE.length - 1]!;
  if (cellMv <= first[0]) return first[1];
  if (cellMv >= last[0]) return last[1];
  for (let i = 1; i < CURVE.length; i++) {
    const [mv, percent] = CURVE[i]!;
    if (cellMv <= mv) {
      const [prevMv, prevPercent] = CURVE[i - 1]!;
      return Math.floor(prevPercent + ((percent - prevPercent) * (cellMv - prevMv)) / (mv - prevMv));
    }
  }
  return last[1];
}
