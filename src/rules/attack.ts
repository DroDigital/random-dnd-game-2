import { combineMode, rollD20, type D20Roll, type RollMode } from "./d20";
import { minDamage, rollDice, type DiceExpr } from "./dice";
import type { Rng } from "./rng";

export interface AttackInput {
  bonus: number;
  ac: number;
  damage: DiceExpr;
  /** Extra damage dice that crit-double too (e.g. Sneak Attack). */
  extraDice?: DiceExpr[];
  advantages?: number;
  disadvantages?: number;
  /** Lowest natural roll that crits (20 normally, 19 for a Champion). */
  critOn?: number;
  /** Spend Inspiration to reroll a natural miss. */
  inspiration?: boolean;
  /** Target auto-crits when hit (e.g. paralysed/unconscious within reach). */
  autoCrit?: boolean;
}

export type AttackOutcome = "crit" | "hit" | "graze" | "fumble";

export interface AttackResult {
  d20: D20Roll;
  /** First roll, if Inspiration replaced it. */
  rerolled?: D20Roll;
  total: number;
  outcome: AttackOutcome;
  hit: boolean;
  crit: boolean;
  /** Natural 1: the attacker staggers. */
  stagger: boolean;
  damage: number;
  damageRolls: number[];
  usedInspiration: boolean;
}

/**
 * d20 + bonus vs AC. Natural 20 always hits and doubles the damage dice. A natural 1 always
 * misses and staggers the attacker. Any other miss is a Graze for minimum damage (at least 1).
 */
export function resolveAttack(rng: Rng, a: AttackInput): AttackResult {
  const mode: RollMode = combineMode(a.advantages ?? 0, a.disadvantages ?? 0);
  let d20 = rollD20(rng, mode);
  let rerolled: D20Roll | undefined;
  const critOn = a.critOn ?? 20;
  const wouldHit = (r: D20Roll): boolean => r.natural !== 1 && (r.natural >= critOn || r.natural + a.bonus >= a.ac);
  let usedInspiration = false;
  if (a.inspiration && !wouldHit(d20)) {
    rerolled = d20;
    d20 = rollD20(rng, mode);
    usedInspiration = true;
  }
  const nat = d20.natural;
  const total = nat + a.bonus;
  const crit = nat >= critOn || (a.autoCrit === true && wouldHit(d20));
  const hit = nat !== 1 && (crit || total >= a.ac);
  let outcome: AttackOutcome;
  let damage: number;
  let damageRolls: number[] = [];
  if (hit) {
    const r = rollDice(rng, a.damage, { crit, extraDice: a.extraDice });
    damage = Math.max(1, r.total);
    damageRolls = r.rolls;
    outcome = crit ? "crit" : "hit";
  } else if (nat === 1) {
    damage = 0;
    outcome = "fumble";
  } else {
    damage = minDamage(a.damage);
    outcome = "graze";
  }
  return { d20, rerolled, total, outcome, hit, crit: hit && crit, stagger: nat === 1, damage, damageRolls, usedInspiration };
}
