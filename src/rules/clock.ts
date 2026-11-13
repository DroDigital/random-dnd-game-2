/** The Round Clock: a 6-second ring per hero. When it fills, Action, Bonus Action and Reaction refresh. */
export const ROUND_TICKS = 360; // 6 s at 60 Hz

export interface RoundClock {
  ticks: number;
  action: boolean;
  bonus: boolean;
  reaction: boolean;
}

export const freshClock = (): RoundClock => ({ ticks: 0, action: true, bonus: true, reaction: true });

/** Advance the clock; returns the new clock and whether it filled (and refreshed) this step. */
export function advanceClock(c: RoundClock, ticks = 1): { clock: RoundClock; filled: boolean } {
  const t = c.ticks + ticks;
  if (t >= ROUND_TICKS) return { clock: { ticks: t % ROUND_TICKS, action: true, bonus: true, reaction: true }, filled: true };
  return { clock: { ...c, ticks: t }, filled: false };
}

export function spend(c: RoundClock, what: "action" | "bonus" | "reaction"): RoundClock | null {
  if (!c[what]) return null;
  return { ...c, [what]: false };
}

/** Fraction of the ring filled, 0..1 (for the HUD). */
export const clockFraction = (c: RoundClock): number => c.ticks / ROUND_TICKS;
