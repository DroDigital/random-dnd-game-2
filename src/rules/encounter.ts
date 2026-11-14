import type { Rng } from "./rng";

export type Difficulty = "low" | "moderate" | "high";

/** SRD 5.2 XP budget per character by level (Low / Moderate / High). */
export const XP_BUDGET: Record<number, [number, number, number]> = {
  1: [50, 75, 100], 2: [100, 150, 200], 3: [150, 225, 400], 4: [250, 375, 500], 5: [500, 750, 1100],
  6: [600, 1000, 1400], 7: [750, 1300, 1700], 8: [1000, 1700, 2100], 9: [1300, 2000, 2600], 10: [1600, 2300, 3100],
  11: [1900, 2900, 4100], 12: [2200, 3700, 4700], 13: [2600, 4200, 5400], 14: [2900, 4900, 6200], 15: [3300, 5400, 7800],
  16: [3800, 6100, 9800], 17: [4500, 7200, 11700], 18: [5000, 8700, 14200], 19: [5500, 10700, 17200], 20: [6400, 13200, 22000],
};

/** SRD challenge rating → XP. */
export const CR_XP: Record<string, number> = {
  "0": 10, "1/8": 25, "1/4": 50, "1/2": 100, "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800, "6": 2300,
  "7": 2900, "8": 3900, "9": 5000, "10": 5900, "11": 7200, "12": 8400, "13": 10000, "14": 11500, "15": 13000,
  "16": 15000, "17": 18000, "18": 20000, "19": 22000, "20": 25000, "21": 33000, "22": 41000, "23": 50000,
};

export function crToXp(cr: string): number {
  const v = CR_XP[cr];
  if (v === undefined) throw new RangeError(`unknown CR ${cr}`);
  return v;
}

/** Party budget: sum of each hero's per-character budget, times a tuning multiplier. */
export function partyBudget(levels: readonly number[], difficulty: Difficulty, multiplier = 1): number {
  const idx = difficulty === "low" ? 0 : difficulty === "moderate" ? 1 : 2;
  let sum = 0;
  for (const l of levels) {
    const row = XP_BUDGET[Math.min(20, Math.max(1, Math.floor(l)))]!;
    sum += row[idx];
  }
  return Math.round(sum * multiplier);
}

export interface MonsterOption {
  id: string;
  xp: number;
  /** Relative weight in the pool. */
  weight?: number;
}

/**
 * Fill a budget with monsters from a pool: repeatedly pick an affordable monster (weighted)
 * until nothing fits or `maxCount` is reached. Always returns at least one monster if the pool
 * is non-empty (the cheapest), so no room is ever empty.
 */
export function buildEncounter(rng: Rng, budget: number, pool: readonly MonsterOption[], maxCount = 12): string[] {
  if (pool.length === 0) return [];
  const out: string[] = [];
  let left = budget;
  while (out.length < maxCount) {
    const affordable = pool.filter((m) => m.xp <= left);
    if (affordable.length === 0) break;
    const m = rng.weighted(affordable, (x) => x.weight ?? 1);
    out.push(m.id);
    left -= m.xp;
  }
  if (out.length === 0) {
    const cheapest = [...pool].sort((a, b) => a.xp - b.xp)[0]!;
    out.push(cheapest.id);
  }
  return out;
}

export function encounterXp(ids: readonly string[], xpOf: (id: string) => number): number {
  return ids.reduce((s, id) => s + xpOf(id), 0);
}
