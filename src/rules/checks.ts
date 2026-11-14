import { combineMode, rollD20, type D20Roll } from "./d20";
import type { Rng } from "./rng";

export interface CheckResult {
  d20: D20Roll;
  total: number;
  success: boolean;
  rerolled?: D20Roll;
}

export interface CheckInput {
  mod: number;
  dc: number;
  advantages?: number;
  disadvantages?: number;
  /** Auto-fail (e.g. Stunned on STR/DEX saves). */
  autoFail?: boolean;
  inspiration?: boolean;
}

/** d20 + modifier vs DC: used for saving throws and skill checks. Meets-it-beats-it. */
export function rollCheck(rng: Rng, c: CheckInput): CheckResult {
  const mode = combineMode(c.advantages ?? 0, c.disadvantages ?? 0);
  let d20 = rollD20(rng, mode);
  let rerolled: D20Roll | undefined;
  if (c.autoFail) return { d20, total: d20.natural + c.mod, success: false };
  if (c.inspiration && d20.natural + c.mod < c.dc) {
    rerolled = d20;
    d20 = rollD20(rng, mode);
  }
  const total = d20.natural + c.mod;
  return { d20, total, success: total >= c.dc, rerolled };
}

/** Area damage after a save: half (rounded down) on a success. */
export function saveDamage(full: number, saved: boolean): number {
  return saved ? Math.floor(full / 2) : full;
}

/** Spell save DC: 8 + proficiency + ability modifier. */
export function saveDC(prof: number, abilityMod: number): number {
  return 8 + prof + abilityMod;
}
