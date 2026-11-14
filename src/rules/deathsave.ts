export interface DeathSaveState {
  successes: number;
  failures: number;
  stable: boolean;
  dead: boolean;
  /** Natural 20: back on your feet with 1 HP. */
  revived: boolean;
}

export const freshDeathSaves = (): DeathSaveState => ({ successes: 0, failures: 0, stable: false, dead: false, revived: false });

/**
 * Apply one death save roll (natural d20). 10+ succeeds; a natural 1 counts as two failures;
 * a natural 20 revives with 1 HP. `failLimit` is 3 normally (4 for a Lone Hero's extra save).
 */
export function applyDeathSave(s: DeathSaveState, natural: number, failLimit = 3, successLimit = 3): DeathSaveState {
  if (s.dead || s.stable || s.revived) return s;
  if (natural === 20) return { ...s, revived: true };
  const n = { ...s };
  if (natural === 1) n.failures += 2;
  else if (natural >= 10) n.successes += 1;
  else n.failures += 1;
  if (n.failures >= failLimit) {
    n.failures = failLimit;
    n.dead = true;
  } else if (n.successes >= successLimit) {
    n.stable = true;
  }
  return n;
}

/** Taking damage while at 0 HP: one failure, two on a critical hit. */
export function damageWhileDowned(s: DeathSaveState, crit: boolean, failLimit = 3): DeathSaveState {
  if (s.dead) return s;
  const failures = Math.min(failLimit, s.failures + (crit ? 2 : 1));
  return { ...s, stable: false, failures, dead: failures >= failLimit };
}
