/** Seeded random numbers (mulberry32), so a simulator run can be repeated exactly (README §8.2). */
export type Random = {
  /** uniform in [0, n − 1]; n ≤ 1 gives 0, like RandomUtil::below */
  below: (n: number) => number;
};

export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    below: (n) => (n <= 1 ? 0 : Math.floor(next() * Math.trunc(n))),
  };
}
