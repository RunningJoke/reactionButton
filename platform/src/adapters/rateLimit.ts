export type RateLimiter = {
  /** counts one hit for `key`; false when more than `limit` hits fell into the current window */
  hit(key: string, limit: number, windowMs: number): boolean;
};

/** Fixed windows in memory. Enough for one API instance (spec §9); a shared store comes with scaling out. */
export function memoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key, limit, windowMs) {
      const t = now();
      let w = windows.get(key);
      if (!w || t - w.start >= windowMs) {
        w = { start: t, count: 0 };
        windows.set(key, w);
        if (windows.size > 10_000) for (const [k, v] of windows) if (t - v.start >= windowMs) windows.delete(k);
      }
      w.count++;
      return w.count <= limit;
    },
  };
}
