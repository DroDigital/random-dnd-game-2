import type { Rng } from "./rng";

export type RollMode = "normal" | "advantage" | "disadvantage";

export interface D20Roll {
  rolls: number[];
  /** The kept die. */
  natural: number;
  mode: RollMode;
}

/** Any number of advantage and disadvantage sources: one of each cancels to normal. */
export function combineMode(advantages: number, disadvantages: number): RollMode {
  if (advantages > 0 && disadvantages === 0) return "advantage";
  if (disadvantages > 0 && advantages === 0) return "disadvantage";
  return "normal";
}

/** Roll a d20, 2d20 keep highest (advantage) or keep lowest (disadvantage). */
export function rollD20(rng: Rng, mode: RollMode = "normal"): D20Roll {
  const a = rng.die(20);
  if (mode === "normal") return { rolls: [a], natural: a, mode };
  const b = rng.die(20);
  const natural = mode === "advantage" ? Math.max(a, b) : Math.min(a, b);
  return { rolls: [a, b], natural, mode };
}

/** Inspiration: reroll the d20 test, keeping the new result (same mode). */
export function rerollD20(rng: Rng, prev: D20Roll): D20Roll {
  return rollD20(rng, prev.mode);
}

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Proficiency bonus by character level (or CR for monsters). */
export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}
