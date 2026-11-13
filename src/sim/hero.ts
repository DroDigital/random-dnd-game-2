import { BALANCE, CARDS, CLASSES, ITEMS, META, SUBCLASSES, abilityParam } from "../data";
import { abilityMod, proficiencyBonus } from "../rules/d20";
import { freshClock } from "../rules/clock";
import type { Ability, Hero, Mods } from "./types";

export const INJURIES: Record<string, { name: string; mods: Partial<Record<keyof Mods, number>> }> = {
  wounded_leg: { name: "Wounded Leg", mods: { speed: -0.6 } },
  cracked_ribs: { name: "Cracked Ribs", mods: { maxHp: -5 } },
  shaken: { name: "Shaken", mods: { saves: -1 } },
  scarred_hand: { name: "Scarred Hand", mods: { toHit: -1 } },
};

export function emptyMods(): Mods {
  return {
    ac: 0, toHit: 0, damage: 0, maxHp: 0, speed: 0, critOn: 0, saves: 0, checks: 0, healBonus: 0, spellDc: 0, spellToHit: 0,
    spellDamage: 0, slotBonus: 0, dodgeCooldown: 0, hpRegen: 0, deathSave: 0, goldFind: 0, initiative: 0, clockSpeed: 0, aoeDice: 0,
    inspirationOnRest: 0, inspirationOnCrit: 0, critDamage: 0, reactionAc: 0, reactionShove: 0, stabilizeFast: 0, hitDiceBonus: 0,
    restHeal: 0, maxHpPerLevel: 0, stealth: 0, hideTicks: 0, potionSlots: 0, evasion: 0, firstHitDisadvantage: 0, fireDamage: 0,
    rageBonus: 0, onHit: [], resist: [], resistCondition: [], sub: {},
  };
}

const NUMERIC_KEYS = new Set(Object.keys(emptyMods()).filter((k) => typeof (emptyMods() as unknown as Record<string, unknown>)[k] === "number"));

function addNumeric(m: Mods, src: Record<string, unknown>): void {
  const mm = m as unknown as Record<string, number>;
  for (const [k, v] of Object.entries(src)) if (typeof v === "number" && NUMERIC_KEYS.has(k)) mm[k] = (mm[k] ?? 0) + v;
}

/** Fold every modifier source (items, cards, subclass, background, injuries, permanent unlocks) into one Mods. */
export function computeMods(h: Pick<Hero, "items" | "attuned" | "cards" | "subclass" | "background" | "injuries" | "cls">, perm: Record<string, number> = {}): Mods {
  const m = emptyMods();
  for (const id of h.items) {
    const it = ITEMS.items[id];
    if (!it) continue;
    if (it.attune && !h.attuned.includes(id)) continue;
    const e = it.effects as Record<string, unknown>;
    addNumeric(m, e);
    if (typeof e.onHit === "string") m.onHit.push({ dice: e.onHit, type: String(e.onHitType ?? "force"), undeadOnly: false, ignites: !!e.ignites });
    if (typeof e.onHitUndead === "string") m.onHit.push({ dice: e.onHitUndead, type: String(e.onHitType ?? "radiant"), undeadOnly: true, ignites: false });
    if (Array.isArray(e.resist)) m.resist.push(...(e.resist as string[]));
    if (Array.isArray(e.resistCondition)) m.resistCondition.push(...(e.resistCondition as string[]));
  }
  for (const cid of h.cards) {
    const c = CARDS.cards.find((x) => x.id === cid);
    if (c) addNumeric(m, c.mods);
  }
  if (h.subclass) {
    const s = SUBCLASSES[h.subclass];
    if (s) {
      m.sub = { ...s.mods };
      if (s.mods.ac) m.ac += s.mods.ac;
      if (s.mods.speed) m.speed += s.mods.speed;
      if (s.mods.critOn) m.critOn -= 20 - s.mods.critOn;
    }
  }
  const bg = META.backgrounds[h.background];
  if (bg) addNumeric(m, bg.mods);
  for (const inj of h.injuries) addNumeric(m, INJURIES[inj]?.mods ?? {});
  if (perm.maxHp) m.maxHp += perm.maxHp;
  return m;
}

export function abilityModOf(h: { scores: Record<Ability, number> }, a: Ability): number {
  return abilityMod(h.scores[a]);
}

export function primaryAbility(cls: string): Ability {
  return CLASSES[cls]!.attack.ability as Ability;
}

/** Spellcasting ability (for save DCs / healing). */
export function castAbility(cls: string): Ability {
  switch (cls) {
    case "wizard": return "int";
    case "cleric": case "druid": case "ranger": return "wis";
    case "bard": case "paladin": case "warlock": return "cha";
    default: return primaryAbility(cls);
  }
}

export function maxSlots(h: Hero): number {
  if (h.cls !== "wizard") return 0;
  return abilityParam("arcane_recovery", "slotsBase", 2) + Math.floor(h.level / 2) * abilityParam("arcane_recovery", "slotsPerTwoLevels", 1) + h.mods.slotBonus;
}

export function hitDiceMax(h: Hero): number {
  return h.level + h.mods.hitDiceBonus;
}

/** Recompute derived stats after a level, item or card change. Keeps current HP proportionally sane. */
export function recalc(h: Hero, perm: Record<string, number> = {}): void {
  const c = CLASSES[h.cls]!;
  const scores = { ...c.scores } as Record<Ability, number>;
  for (const [k, v] of Object.entries(h.upgrades)) scores[k as Ability] = Math.min(20, scores[k as Ability] + (v ?? 0));
  h.scores = scores;
  h.mods = computeMods(h, perm);
  const con = abilityMod(scores.con), dex = abilityMod(scores.dex);
  const perLevel = c.hitDie / 2 + 1 + con;
  const oldMax = h.maxHp;
  h.maxHp = Math.max(1, c.hitDie + con + (h.level - 1) * perLevel + h.mods.maxHp + h.mods.maxHpPerLevel * h.level);
  if (oldMax > 0) h.hp = Math.min(h.maxHp, Math.max(h.hp + (h.maxHp - oldMax), h.hp > 0 ? 1 : 0));
  else h.hp = h.maxHp;
  h.ac = c.armorAc + Math.min(dex, c.dexCap) + h.mods.ac;
  h.prof = proficiencyBonus(h.level);
  h.speed = Math.max(1.5, BALANCE.hero.speed + h.mods.speed);
  h.resist = [...h.mods.resist];
}

export function makeHero(id: number, slot: number, cls: string, opts: { level?: number; ctrl?: "human" | "ai"; background?: string; perm?: Record<string, number>; items?: string[] } = {}): Hero {
  const c = CLASSES[cls];
  if (!c) throw new Error(`unknown class ${cls}`);
  const h: Hero = {
    id, kind: "hero", team: "party", model: c.model, name: c.name, x: 0, z: 0, vx: 0, vz: 0, facing: 0, radius: BALANCE.hero.radius,
    hp: 0, maxHp: 0, tempHp: 0, ac: 10, speed: BALANCE.hero.speed, scores: { ...c.scores } as Record<Ability, number>, prof: 2,
    conds: {}, state: "idle", stateT: 0, stateDur: 0, anim: "idle", animSeq: 0, freeze: 0, buffs: {}, helped: 0, tags: ["humanoid"],
    attackCount: 0, strike: null, lastHitBy: 0, resist: [],
    slot, ctrl: opts.ctrl ?? "human", cls, subclass: null, level: opts.level ?? 1, clock: freshClock(), inspiration: 1, hitDice: 0,
    slots: 0, dodgeCd: 0, iframes: 0, down: null, stable: false, fallen: false, injuries: [], items: [...(opts.items ?? [])], attuned: [],
    potions: 1, cards: [], background: opts.background ?? "none", upgrades: {}, order: "follow", layOnHands: 0,
    holdT: { action: 0, bonus: 0, interact: 0 }, markId: 0, stats: { kills: 0, damage: 0, crits: 0, downs: 0, heals: 0 }, mods: emptyMods(),
    aiMem: { hold: null, holdT: 0, holdX: 0, holdZ: 0, prevDown: 0 },
  };
  h.attuned = h.items.filter((i) => ITEMS.items[i]?.attune).slice(0, ITEMS.attunementSlots);
  recalc(h, opts.perm);
  h.hp = h.maxHp;
  h.hitDice = hitDiceMax(h);
  h.slots = maxSlots(h);
  h.layOnHands = h.level * abilityParam("lay_on_hands", "poolPerLevel", 5);
  return h;
}

export function attackBonus(h: Hero): number {
  const a = primaryAbility(h.cls);
  const spell = CLASSES[h.cls]!.attack.kind === "projectile" ? h.mods.spellToHit : 0;
  const cha = h.mods.sub.toHitCha ? Math.max(0, abilityMod(h.scores.cha)) : 0;
  return h.prof + abilityMod(h.scores[a]) + h.mods.toHit + spell + cha;
}

export function damageMod(h: Hero): number {
  return abilityMod(h.scores[primaryAbility(h.cls)]) + h.mods.damage + (h.buffs.rage ? abilityParam("rage", "damage", 2) + h.mods.rageBonus : 0);
}

export function spellDC(h: Hero): number {
  return 8 + h.prof + abilityMod(h.scores[castAbility(h.cls)]) + h.mods.spellDc;
}

export function saveBonus(h: Hero, a: Ability): number {
  const prof = CLASSES[h.cls]!.saves.includes(a) ? h.prof : 0;
  return abilityMod(h.scores[a]) + prof + h.mods.saves;
}

/** Skill modifier: ability + proficiency if the class has the skill. */
export function skillBonus(h: Hero, skill: string, ability: Ability): number {
  const prof = CLASSES[h.cls]!.skills.includes(skill) ? h.prof : 0;
  return abilityMod(h.scores[ability]) + prof + h.mods.checks + (skill === "stealth" ? h.mods.stealth : 0);
}

export function canAttune(h: Hero): boolean {
  return h.attuned.length < ITEMS.attunementSlots;
}

/** Give an item, auto-attuning if a slot is free. */
export function giveItem(h: Hero, itemId: string, perm: Record<string, number> = {}): void {
  h.items.push(itemId);
  if (ITEMS.items[itemId]?.attune && canAttune(h)) h.attuned.push(itemId);
  recalc(h, perm);
}

export function levelTo(h: Hero, level: number, perm: Record<string, number> = {}): void {
  h.level = Math.max(1, level);
  recalc(h, perm);
  h.hitDice = Math.min(hitDiceMax(h), h.hitDice + 1);
  h.slots = Math.min(maxSlots(h), h.slots + 1);
  h.layOnHands = h.level * abilityParam("lay_on_hands", "poolPerLevel", 5);
}

export function longRest(h: Hero, perm: Record<string, number> = {}): void {
  if (h.injuries.length) h.injuries.shift();
  recalc(h, perm);
  h.hp = h.maxHp;
  h.hitDice = hitDiceMax(h);
  h.slots = maxSlots(h);
  h.layOnHands = h.level * abilityParam("lay_on_hands", "poolPerLevel", 5);
  h.conds = {};
  h.down = null;
  h.stable = false;
  h.state = "idle";
  h.inspiration = Math.max(h.inspiration, 1);
}
