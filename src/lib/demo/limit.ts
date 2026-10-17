const hits = new Map<string, number[]>();
/** Tiny per-key limiter so a shared demo link cannot burn API quota. */
export function limited(key: string, perMinute: number) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  arr.push(now); hits.set(key, arr);
  return arr.length > perMinute;
}
