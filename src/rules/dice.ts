import type { Rng } from "./rng";

/** A dice expression like "2d6+3", "1d10", "4", "3d8-1". */
export interface DiceExpr {
  count: number;
  sides: number;
  mod: number;
}

const RE = /^\s*(?:(\d+)\s*d\s*(\d+))?\s*([+-]\s*\d+)?\s*$/i;

export function parseDice(text: string): DiceExpr {
  const m = RE.exec(text);
  if (!m || (!m[1] && !m[3])) {
    const n = Number(text);
    if (Number.isInteger(n)) return { count: 0, sides: 0, mod: n };
    throw new SyntaxError(`bad dice expression: ${text}`);
  }
  const count = m[1] ? Number(m[1]) : 0;
  const sides = m[2] ? Number(m[2]) : 0;
  const mod = m[3] ? Number(m[3].replace(/\s+/g, "")) : 0;
  if (count > 0 && sides < 1) throw new SyntaxError(`bad dice expression: ${text}`);
  return { count, sides, mod };
}

export function formatDice(d: DiceExpr): string {
  const base = d.count > 0 ? `${d.count}d${d.sides}` : "";
  if (d.mod === 0) return base || "0";
  return `${base}${d.mod > 0 && base ? "+" : ""}${d.mod}`;
}

export function addMod(d: DiceExpr, mod: number): DiceExpr {
  return { ...d, mod: d.mod + mod };
}

export interface DamageRoll {
  rolls: number[];
  total: number;
}

/** Roll damage. A critical doubles the number of dice (not the modifier). Totals floor at 0. */
export function rollDice(rng: Rng, d: DiceExpr, opts: { crit?: boolean; extraDice?: DiceExpr[] } = {}): DamageRoll {
  const mult = opts.crit ? 2 : 1;
  const rolls: number[] = [];
  const all = [d, ...(opts.extraDice ?? [])];
  let total = 0;
  for (const e of all) {
    for (let i = 0; i < e.count * mult; i++) {
      const r = rng.die(e.sides);
      rolls.push(r);
      total += r;
    }
    total += e === d ? e.mod : 0;
  }
  return { rolls, total: Math.max(0, total) };
}

/** Minimum possible damage (every die shows 1), at least 1 — used for a Graze. */
export function minDamage(d: DiceExpr, extra: DiceExpr[] = []): number {
  const dice = d.count + extra.reduce((s, e) => s + e.count, 0);
  return Math.max(1, dice + d.mod);
}

export function maxDamage(d: DiceExpr): number {
  return Math.max(0, d.count * d.sides + d.mod);
}

export function averageDamage(d: DiceExpr): number {
  return Math.max(0, (d.count * (d.sides + 1)) / 2 + d.mod);
}
