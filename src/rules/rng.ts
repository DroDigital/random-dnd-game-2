/**
 * xoshiro128** — small, fast, seedable PRNG. All randomness in the game goes through this.
 * The state is four uint32s in a plain array so it serializes with the sim state.
 */
export type RngState = [number, number, number, number];

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

/** splitmix32 to expand a 32-bit seed into a full non-zero state. */
export function seedState(seed: number): RngState {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  return ensureNonZero([next(), next(), next(), next()]);
}

/** xoshiro must never run from an all-zero state. */
export function ensureNonZero(st: RngState): RngState {
  if ((st[0] | st[1] | st[2] | st[3]) === 0) st[0] = 1;
  return st;
}

/** Hash a string seed (e.g. "RUIN-1234") to a 32-bit number. */
export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

export class Rng {
  constructor(public s: RngState) {}

  static fromSeed(seed: number): Rng {
    return new Rng(seedState(seed));
  }

  /** Next uint32. */
  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t) >>> 0;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Float in [0, 1). */
  float(): number {
    return this.nextU32() / 4294967296;
  }

  /** Integer in [min, max] inclusive, unbiased (rejection sampling). */
  int(min: number, max: number): number {
    if (max < min) throw new RangeError(`int(${min}, ${max})`);
    const range = max - min + 1;
    const limit = Math.floor(4294967296 / range) * range;
    let v = this.nextU32();
    while (v >= limit) v = this.nextU32();
    return min + (v % range);
  }

  /** Roll one die with `sides` faces. */
  die(sides: number): number {
    return this.int(1, sides);
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new RangeError("pick from empty array");
    return arr[this.int(0, arr.length - 1)]!;
  }

  /** Weighted pick; weights must be >= 0 with a positive sum. */
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    const total = items.reduce((s, it) => s + Math.max(0, weight(it)), 0);
    if (!(total > 0)) throw new RangeError("weighted pick needs a positive total");
    let r = this.float() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r < 0) return it;
    }
    return items[items.length - 1]!;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }

  /** A child generator, so sub-systems don't perturb each other's sequences. */
  fork(): Rng {
    return Rng.fromSeed(this.nextU32() ^ 0x5bd1e995);
  }
}
