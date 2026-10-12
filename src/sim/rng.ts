// Seeded, so a test can replay a match.
export function rand(s: { seed: number }): number {
  let t = (s.seed = (s.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function gauss(s: { seed: number }): number {
  const u = 1 - rand(s);
  const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand(s));
  return Math.max(-2.5, Math.min(2.5, g));
}

export function pick<T>(s: { seed: number }, xs: readonly T[]): T {
  return xs[Math.floor(rand(s) * xs.length)];
}
