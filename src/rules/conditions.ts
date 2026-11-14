export const CONDITIONS = ["prone", "frightened", "poisoned", "restrained", "grappled", "stunned", "blinded"] as const;
export type Condition = (typeof CONDITIONS)[number];
export type ConditionSet = Partial<Record<Condition, number>>;

export const has = (c: ConditionSet, k: Condition): boolean => (c[k] ?? 0) > 0;

export interface AttackContext {
  attacker: ConditionSet;
  target: ConditionSet;
  /** Melee attacks against prone targets have advantage; ranged have disadvantage. */
  melee: boolean;
  attackerHidden?: boolean;
  /** An ally of the attacker (incl. summons like Spiritual Weapon) within 1.5 m of the target. */
  allyNearTarget?: boolean;
  /** Target was the subject of the Help action. */
  helped?: boolean;
  /** Target is invisible/hidden from the attacker. */
  targetHidden?: boolean;
}

export interface ModeSources {
  advantages: string[];
  disadvantages: string[];
}

/** Every advantage/disadvantage source for one attack, by name (shown in the roll log). */
export function attackModeSources(ctx: AttackContext): ModeSources {
  const adv: string[] = [];
  const dis: string[] = [];
  const t = ctx.target, a = ctx.attacker;
  if (has(t, "prone")) (ctx.melee ? adv : dis).push("prone target");
  if (ctx.attackerHidden) adv.push("hidden");
  if (ctx.allyNearTarget) adv.push("flanked");
  if (ctx.helped) adv.push("help");
  if (has(t, "restrained")) adv.push("restrained target");
  if (has(t, "stunned")) adv.push("stunned target");
  if (has(t, "blinded")) adv.push("blinded target");
  if (has(a, "prone")) dis.push("attacker prone");
  if (has(a, "frightened")) dis.push("frightened");
  if (has(a, "poisoned")) dis.push("poisoned");
  if (has(a, "restrained")) dis.push("restrained");
  if (has(a, "blinded")) dis.push("blinded");
  if (ctx.targetHidden) dis.push("target unseen");
  return { advantages: adv, disadvantages: dis };
}

/** Movement multiplier from conditions. */
export function speedMultiplier(c: ConditionSet): number {
  if (has(c, "stunned") || has(c, "restrained") || has(c, "grappled")) return 0;
  if (has(c, "prone")) return 0.35;
  return 1;
}

export function canAct(c: ConditionSet): boolean {
  return !has(c, "stunned");
}

/** Stunned creatures automatically fail Strength and Dexterity saves; restrained have disadvantage on Dex. */
export function saveModifiers(c: ConditionSet, ability: string): { autoFail: boolean; disadvantages: number } {
  const physical = ability === "str" || ability === "dex";
  return {
    autoFail: physical && has(c, "stunned"),
    disadvantages: ability === "dex" && has(c, "restrained") ? 1 : 0,
  };
}

/** Ability checks: Poisoned and Frightened impose disadvantage. */
export function checkDisadvantages(c: ConditionSet): number {
  return (has(c, "poisoned") ? 1 : 0) + (has(c, "frightened") ? 1 : 0);
}

/** Tick every condition down by `ticks`, removing expired ones. Returns a new set. */
export function tickConditions(c: ConditionSet, ticks = 1): ConditionSet {
  const out: ConditionSet = {};
  for (const k of CONDITIONS) {
    const v = (c[k] ?? 0) - ticks;
    if (v > 0) out[k] = v;
  }
  return out;
}
