import type { Rng } from "./rng";

export interface InitiativeEntry {
  id: number;
  dexMod: number;
  /** Heroes win ties against monsters with equal totals and dex. */
  hero: boolean;
}

export interface InitiativeRoll extends InitiativeEntry {
  roll: number;
  total: number;
}

/** Roll d20 + Dex for everyone; sort by total, then Dex, then heroes first, then id. */
export function rollInitiative(rng: Rng, entries: readonly InitiativeEntry[]): InitiativeRoll[] {
  const out = entries.map((e) => {
    const roll = rng.die(20);
    return { ...e, roll, total: roll + e.dexMod };
  });
  out.sort((a, b) => b.total - a.total || b.dexMod - a.dexMod || Number(b.hero) - Number(a.hero) || a.id - b.id);
  return out;
}
