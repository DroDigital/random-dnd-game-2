import { BALANCE, CLASSES, ENEMIES, abilityParam } from "../data";
import { parseDice, rollDice } from "../rules/dice";
import { abilityMod } from "../rules/d20";
import { crToXp } from "../rules/encounter";
import { castAbility, spellDC } from "./hero";
import type { World } from "./world";
import type { AnyActor, Enemy, Hero, Summon, Telegraph } from "./types";

type Slot = "action" | "bonus" | "reaction";

const dirOf = (a: number): { x: number; z: number } => ({ x: Math.sin(a), z: Math.cos(a) });

/** Auto-aim: the best enemy within range, favouring those in front of the hero. */
export function aimTarget(w: World, h: Hero, range: number, cone = 75): Enemy | null {
  const f = dirOf(h.facing);
  let best: Enemy | null = null, bs = Infinity;
  for (const e of w.enemiesAlive()) {
    const dx = e.x - h.x, dz = e.z - h.z, d = Math.hypot(dx, dz);
    if (d > range + e.radius) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * f.x + dz * f.z) / (d || 1)))) * (180 / Math.PI);
    const score = d + (ang > cone ? 8 + ang / 10 : ang / 30);
    if (score < bs) { bs = score; best = e; }
  }
  return best;
}

/** Aim point for area spells: the enemy with the most neighbours inside the radius. */
export function aimCluster(w: World, h: Hero, range: number, radius: number): { x: number; z: number } {
  const foes = w.enemiesAlive().filter((e) => w.dist(e, h) <= range);
  let best: { x: number; z: number } | null = null, bn = -1;
  for (const e of foes) {
    const n = foes.filter((o) => w.dist(o, e) <= radius).length;
    if (n > bn || (n === bn && best && w.dist(e, h) < w.dist(best, h))) { bn = n; best = { x: e.x, z: e.z }; }
  }
  if (best) return best;
  const f = dirOf(h.facing);
  return { x: h.x + f.x * Math.min(range, 6), z: h.z + f.z * Math.min(range, 6) };
}

function face(h: Hero, p: { x: number; z: number }): void {
  const dx = p.x - h.x, dz = p.z - h.z;
  if (dx * dx + dz * dz > 0.0001) h.facing = Math.atan2(dx, dz);
}

/** The telegraph currently aimed at `target` (or at any party member within `range` of `from`). */
export function activeTelegraph(w: World, targetIds: number[]): { e: Enemy; t: Telegraph } | null {
  for (const e of w.enemiesAlive()) {
    const t = e.telegraph;
    if (!t || t.cancelled) continue;
    if (targetIds.includes(t.targetId)) return { e, t };
    if (t.shape === "circle" || t.shape === "line") {
      for (const id of targetIds) {
        const a = w.byId(id);
        if (a && inTelegraph(t, a)) return { e, t };
      }
    }
  }
  return null;
}

export function inTelegraph(t: Telegraph, a: { x: number; z: number; radius: number }): boolean {
  if (t.shape === "circle") return Math.hypot(a.x - t.x, a.z - t.z) <= t.radius + a.radius;
  if (t.shape === "line") {
    const rx = a.x - t.x, rz = a.z - t.z;
    const along = rx * t.dirX + rz * t.dirZ;
    const across = Math.abs(rx * t.dirZ - rz * t.dirX);
    return along >= -a.radius && along <= t.length + a.radius && across <= t.width / 2 + a.radius;
  }
  return false;
}

function partyIdsNear(w: World, h: Hero, range: number): number[] {
  return w.actorsOf("party").filter((a) => w.dist(a, h) <= range).map((a) => a.id);
}

function summonWeapon(w: World, h: Hero): void {
  const existing = w.s.summons.find((m) => m.owner === h.id && m.summonType === "spiritual_weapon");
  const life = abilityParam("spiritual_weapon", "ticks", 1800);
  if (existing) {
    existing.life = life;
    return;
  }
  const f = dirOf(h.facing);
  const m: Summon = {
    id: w.id(), kind: "summon", team: "party", model: "spiritual_weapon", name: "Spiritual Weapon", x: h.x + f.x, z: h.z + f.z, vx: 0, vz: 0,
    facing: h.facing, radius: 0.3, hp: 1, maxHp: 1, tempHp: 0, ac: 99, speed: abilityParam("spiritual_weapon", "speed", 5.5),
    scores: { ...h.scores }, prof: h.prof, conds: {}, state: "idle", stateT: 0, stateDur: 0, anim: "idle", animSeq: 0, freeze: 0, buffs: {},
    helped: 0, tags: ["construct"], attackCount: 0, strike: null, lastHitBy: 0, resist: [], owner: h.id, life, attackT: 0, summonType: "spiritual_weapon",
  };
  w.s.summons.push(m);
  w.vfx("summon", m.x, m.z, { scale: 0.6, ally: true });
}

/** Execute a class ability. Returns false (and spends nothing) when it can't be used right now. */
export function useAbility(w: World, h: Hero, id: string, slot: Slot): boolean {
  const dc = spellDC(h);
  const castMod = abilityMod(h.scores[castAbility(h.cls)]);
  const f = dirOf(h.facing);
  const friendly = w.persona.friendlyFire ? "both" as const : "foe" as const;
  switch (id) {
    // ---------------- Fighter
    case "action_surge":
      h.buffs.surge = abilityParam("action_surge", "ticks", 240);
      h.clock.bonus = true;
      w.vfx("level_up", h.x, h.z, { follow: h.id, scale: 0.6, ally: true });
      w.popup("ACTION SURGE", "#e5584f", h.x, h.z, true);
      return true;
    case "second_wind": {
      const amt = rollDice(w.rng, parseDice(abilityParam("second_wind", "heal", "1d10"))).total + h.level;
      w.heal(h, amt, null);
      return true;
    }
    // ---------------- Wizard
    case "fireball": {
      if (h.slots <= 0) return useAbility(w, h, "grease", slot);
      const range = abilityParam("fireball", "range", 10);
      const p = aimCluster(w, h, range, abilityParam("fireball", "radius", 3.2));
      face(h, p);
      h.slots--;
      const speed = abilityParam("fireball", "speed", 12);
      const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz) || 1;
      w.s.projectiles.push({
        id: w.id(), owner: h.id, team: "party", x: h.x + f.x * 0.6, z: h.z + f.z * 0.6, vx: (dx / d) * speed, vz: (dz / d) * speed,
        life: Math.ceil((d / speed) * 60), radius: 0.3, vfx: "fireball_bolt", kind: "fireball", damage: "0", type: "fire", toHit: 0, fire: true, push: 0,
        targetX: p.x, targetZ: p.z, mode: null, enemyAttackIdx: -1,
      });
      w.setState(h, "cast", 18, "cast");
      w.emit({ t: "sfx", id: "fireball_cast", x: h.x, z: h.z });
      return true;
    }
    case "grease": {
      const p = aimCluster(w, h, abilityParam("grease", "range", 8), 2);
      face(h, p);
      const r = abilityParam("grease", "radius", 2.6);
      w.addZone("grease", p.x, p.z, r, abilityParam("grease", "ticks", 900), h, "0", dc);
      w.vfx("grease", p.x, p.z, { life: 2, scale: 0.5, ally: true });
      for (const e of w.enemiesAlive()) if (w.dist(e, p) <= r && !w.saveFor(e, "dex", dc)) w.addCondition(e, "prone", BALANCE.hero.proneTicks);
      w.setState(h, "cast", 16, "castRaise");
      w.emit({ t: "sfx", id: "grease", x: p.x, z: p.z });
      return true;
    }
    case "misty_step": {
      const dist = abilityParam("misty_step", "distance", 7);
      const dir = Math.hypot(h.vx, h.vz) > 0.1 ? { x: h.vx / Math.hypot(h.vx, h.vz), z: h.vz / Math.hypot(h.vx, h.vz) } : f;
      for (let d = dist; d > 0.5; d -= 0.5) {
        const nx = h.x + dir.x * d, nz = h.z + dir.z * d;
        if (w.standable(nx, nz)) {
          w.vfx("misty_out", h.x, h.z, { ally: true });
          h.x = nx;
          h.z = nz;
          w.vfx("misty_in", h.x, h.z, { ally: true });
          h.iframes = Math.max(h.iframes, 8);
          w.emit({ t: "sfx", id: "blink", x: h.x, z: h.z });
          return true;
        }
      }
      return false;
    }
    case "shield": {
      const tg = activeTelegraph(w, [h.id]);
      if (!tg) return false;
      tg.t.shieldAc = abilityParam("shield", "ac", 5);
      h.buffs.shield = abilityParam("shield", "ticks", 90);
      w.vfx("shield", h.x, h.z, { follow: h.id, ally: true });
      w.popup("SHIELD +5 AC", "#4f9be5", h.x, h.z);
      return true;
    }
    // ---------------- Rogue
    case "sneak_strike": {
      const t = aimTarget(w, h, 4, 80);
      if (t) face(h, t);
      const lunge = abilityParam("sneak_strike", "lunge", 2.4);
      const fd = dirOf(h.facing);
      const reach = t ? Math.max(0, w.dist(h, t) - (h.radius + t.radius + 0.6)) : lunge;
      w.push(h, fd.x * Math.min(lunge, reach), fd.z * Math.min(lunge, reach));
      h.strike = { kind: "sneak", at: 6, targetId: t?.id };
      w.setState(h, "windup", 6 + 14, "stab");
      w.vfx("dagger", h.x + fd.x, h.z + fd.z, { ally: true });
      return true;
    }
    case "cunning_dash":
      h.buffs.dash = BALANCE.hero.dashTicks;
      w.vfx("dust", h.x, h.z, { ally: true, scale: 0.6 });
      return true;
    case "cunning_hide": {
      const near = w.enemiesAlive().some((e) => w.dist(e, h) < abilityParam("cunning_hide", "requiresNoAdjacent", 2.5));
      if (near) {
        w.popup("Too close to hide", "#a49eb6", h.x, h.z);
        return false;
      }
      h.buffs.hidden = BALANCE.hero.hideTicks + h.mods.hideTicks;
      w.vfx("smoke", h.x, h.z, { ally: true, scale: 0.6 });
      for (const e of w.enemiesAlive()) if (e.ai.targetId === h.id) e.ai.targetId = 0;
      return true;
    }
    case "uncanny_dodge": {
      const tg = activeTelegraph(w, [h.id]);
      if (!tg) return false;
      tg.t.halve = true;
      w.popup("UNCANNY DODGE", "#5fc77a", h.x, h.z);
      return true;
    }
    // ---------------- Cleric
    case "turn_undead": {
      const r = abilityParam("turn_undead", "radius", 9);
      let n = 0;
      for (const e of w.enemiesAlive()) {
        if (!w.isUndead(e) || w.dist(e, h) > r) continue;
        n++;
        const crv = ENEMIES[e.type]!.cr;
        const crNum = crv.includes("/") ? Number(crv.split("/")[0]) / Number(crv.split("/")[1]) : Number(crv);
        if (!e.boss && h.level >= abilityParam("turn_undead", "destroyAtLevel", 5) && crNum <= abilityParam("turn_undead", "destroyCr", 0.25)) {
          w.popup("DESTROYED", "#e8cf4a", e.x, e.z);
          w.damage(e, e.hp, "radiant", h);
          continue;
        }
        if (h.mods.sub.turnDamage) w.damage(e, rollDice(w.rng, parseDice("2d8")).total, "radiant", h);
        if (e.state !== "dead" && !w.saveFor(e, "wis", dc)) {
          w.addCondition(e, "frightened", abilityParam("turn_undead", "ticks", 600));
          e.ai.targetId = h.id;
        }
      }
      w.vfx("turn_undead", h.x, h.z, { ally: true });
      w.setState(h, "cast", 24, "castLong");
      w.emit({ t: "sfx", id: "holy", x: h.x, z: h.z });
      if (n === 0) w.popup("No undead near", "#a49eb6", h.x, h.z);
      return true;
    }
    case "healing_word": {
      const range = abilityParam("healing_word", "range", 18);
      const cands = w.s.heroes.filter((o) => !o.fallen && w.dist(o, h) <= range && (o.down || o.hp < o.maxHp));
      if (!cands.length) return false;
      cands.sort((a, b) => (a.down ? -1000 : a.hp / a.maxHp) - (b.down ? -1000 : b.hp / b.maxHp) || a.id - b.id);
      const t = cands[0]!;
      const per = abilityParam<{ every: number; dice: string }>("healing_word", "perLevel", { every: 2, dice: "1d4" });
      const dice = 1 + Math.floor((h.level - 1) / per.every);
      const amt = rollDice(w.rng, { count: dice, sides: 4, mod: castMod }).total;
      w.heal(t, Math.max(1, amt), h);
      return true;
    }
    case "spiritual_weapon":
      summonWeapon(w, h);
      w.setState(h, "cast", 14, "castRaise");
      return true;
    case "sanctuary": {
      const ids = partyIdsNear(w, h, abilityParam("sanctuary", "range", 9));
      const tg = activeTelegraph(w, ids);
      if (!tg) return false;
      const target = w.byId(tg.t.targetId);
      if (!w.saveFor(tg.e, "wis", dc)) {
        tg.t.cancelled = true;
        tg.e.ai.targetId = 0;
        w.popup("SANCTUARY", "#e9e4d6", target?.x ?? h.x, target?.z ?? h.z, true);
        if (target) w.vfx("sanctuary", target.x, target.z, { follow: target.id, ally: target.id !== h.id });
      }
      return true;
    }
    // ---------------- Barbarian
    case "reckless_strike": {
      const t = aimTarget(w, h, 3, 90);
      if (t) face(h, t);
      h.buffs.reckless = abilityParam("reckless_strike", "ticks", 240);
      h.strike = { kind: "reckless", at: 9, targetId: t?.id };
      w.setState(h, "windup", 9 + 16, "attackHeavy");
      return true;
    }
    case "rage":
      h.buffs.rage = abilityParam("rage", "ticks", 600);
      w.vfx("burning", h.x, h.z, { follow: h.id, life: 10, ally: true, scale: 0.8 });
      w.popup("RAGE!", "#e5584f", h.x, h.z, true);
      return true;
    case "retaliation": {
      const tg = activeTelegraph(w, [h.id]);
      if (!tg || w.dist(tg.e, h) > 3) return false;
      face(h, tg.e);
      w.heroAttack(h, tg.e, { melee: true, label: "Retaliation" });
      w.setState(h, "recover", 14, "attackHeavy");
      return true;
    }
    // ---------------- Ranger
    case "volley": {
      const p = aimCluster(w, h, abilityParam("volley", "range", 14), 3);
      face(h, p);
      w.areaDamage(p.x, p.z, abilityParam("volley", "radius", 3), parseDice(abilityParam("volley", "damage", "2d8")), "piercing", "dex", dc, h, { hitTeam: friendly, exclude: h.id });
      w.vfx("arrow", p.x, p.z, { scale: 1, ally: true });
      w.setState(h, "cast", 18, "shoot");
      return true;
    }
    case "hunters_mark":
    case "hex": {
      const t = aimTarget(w, h, 18, 120);
      if (!t) return false;
      h.markId = t.id;
      h.buffs.mark = abilityParam(id, "ticks", 1800);
      w.vfx("curse", t.x, t.z, { follow: t.id, life: 2, ally: true });
      w.popup(id === "hex" ? "HEXED" : "MARKED", "#8f2a35", t.x, t.z);
      return true;
    }
    case "evasive_step": {
      const tg = activeTelegraph(w, [h.id]);
      if (!tg) return false;
      const dx = h.x - tg.e.x, dz = h.z - tg.e.z, d = Math.hypot(dx, dz) || 1;
      w.push(h, (dx / d) * abilityParam("evasive_step", "distance", 4), (dz / d) * abilityParam("evasive_step", "distance", 4));
      h.iframes = Math.max(h.iframes, 12);
      w.vfx("dust", h.x, h.z, { ally: true });
      return true;
    }
    // ---------------- Bard
    case "thunderwave":
      w.areaDamage(h.x, h.z, abilityParam("thunderwave", "radius", 3.2), parseDice(abilityParam("thunderwave", "damage", "2d8")), "thunder", "con", dc, h, { hitTeam: friendly, exclude: h.id, push: abilityParam("thunderwave", "push", 3) });
      w.vfx("shove", h.x, h.z, { ally: true });
      w.setState(h, "cast", 16, "cast");
      w.emit({ t: "shake", amount: 2 });
      return true;
    case "bardic_inspiration": {
      const ally = w.nearest(h, w.heroesUp(), (o) => o.id !== h.id) ?? h;
      ally.inspiration = Math.min(3, ally.inspiration + 1);
      w.popup("INSPIRED", "#e8cf4a", ally.x, ally.z);
      w.vfx("level_up", ally.x, ally.z, { follow: ally.id, scale: 0.5, ally: true });
      return true;
    }
    case "cutting_words": {
      const tg = activeTelegraph(w, partyIdsNear(w, h, 18));
      if (!tg) return false;
      tg.t.cut += rollDice(w.rng, parseDice(abilityParam("cutting_words", "dice", "1d8"))).total;
      w.popup("CUTTING WORDS", "#8f2a35", tg.e.x, tg.e.z);
      return true;
    }
    // ---------------- Paladin
    case "divine_smite": {
      const t = aimTarget(w, h, 3, 90);
      if (t) face(h, t);
      h.strike = { kind: "smite", at: 8, targetId: t?.id };
      w.setState(h, "windup", 8 + 16, "attackHeavy");
      return true;
    }
    case "lay_on_hands": {
      if (h.layOnHands <= 0) return false;
      const t = w.nearest(h, w.s.heroes, (o) => !o.fallen && (o.down !== null || o.hp < o.maxHp) && w.dist(o, h) <= 2.5) ?? (h.hp < h.maxHp ? h : undefined);
      if (!t) return false;
      const amt = Math.min(h.layOnHands, abilityParam("lay_on_hands", "heal", 10));
      h.layOnHands -= amt;
      w.heal(t, amt, h);
      return true;
    }
    case "protection": {
      const tg = activeTelegraph(w, partyIdsNear(w, h, abilityParam("protection", "range", 2.5)).filter((i) => i !== h.id));
      if (!tg) return false;
      tg.t.disadvantage = true;
      w.popup("PROTECTED", "#f2b45a", h.x, h.z);
      return true;
    }
    // ---------------- Warlock
    case "hunger_of_hadar": {
      const p = aimCluster(w, h, abilityParam("hunger_of_hadar", "range", 10), 3);
      face(h, p);
      w.addZone("darkness", p.x, p.z, abilityParam("hunger_of_hadar", "radius", 3), abilityParam("hunger_of_hadar", "ticks", 360), h, abilityParam("hunger_of_hadar", "damage", "2d6"), dc);
      w.vfx("curse", p.x, p.z, { scale: 1, life: 6, ally: true });
      w.setState(h, "cast", 18, "castLong");
      return true;
    }
    case "hellish_rebuke": {
      const tg = activeTelegraph(w, [h.id]);
      if (!tg) return false;
      const full = rollDice(w.rng, parseDice(abilityParam("hellish_rebuke", "damage", "2d10"))).total;
      const saved = w.saveFor(tg.e, "dex", dc);
      w.damage(tg.e, saved ? Math.floor(full / 2) : full, "fire", h);
      w.vfx("burning", tg.e.x, tg.e.z, { follow: tg.e.id, ally: true });
      return true;
    }
    // ---------------- Druid
    case "entangle": {
      const p = aimCluster(w, h, abilityParam("entangle", "range", 10), 3);
      face(h, p);
      w.addZone("entangle", p.x, p.z, abilityParam("entangle", "radius", 3), abilityParam("entangle", "ticks", 600), h, "0", dc);
      for (const e of w.enemiesAlive()) if (w.dist(e, p) <= abilityParam("entangle", "radius", 3) && !w.saveFor(e, "str", dc)) w.addCondition(e, "restrained", abilityParam("entangle", "restrainTicks", 180));
      w.vfx("summon", p.x, p.z, { scale: 1, ally: true });
      w.setState(h, "cast", 18, "castRaise");
      return true;
    }
    case "thorn_ward": {
      const tg = activeTelegraph(w, [h.id]);
      if (!tg) return false;
      tg.t.thorns += rollDice(w.rng, parseDice(abilityParam("thorn_ward", "dice", "1d10"))).total + castMod;
      w.popup("THORN WARD", "#5fc77a", h.x, h.z);
      return true;
    }
    case "parry": {
      const tg = activeTelegraph(w, [h.id]);
      if (!tg || tg.t.shape !== "melee") return false;
      tg.t.cancelled = true;
      w.setState(tg.e, "stagger", abilityParam("parry", "staggerTicks", 36), "hit");
      tg.e.telegraph = null;
      tg.e.ai.mode = "recover";
      tg.e.ai.t = abilityParam("parry", "staggerTicks", 36);
      w.vfx("parry", h.x + Math.sin(h.facing) * 0.6, h.z + Math.cos(h.facing) * 0.6, { y: 1, ally: true });
      w.popup("PARRY!", "#e9e4d6", h.x, h.z, true);
      w.emit({ t: "sfx", id: "parry", x: h.x, z: h.z });
      if (h.mods.sub.parryShoves || h.mods.reactionShove) w.shove(h, tg.e);
      return true;
    }
    default:
      return false;
  }
  void slot;
}

/** Resolve the strike frame of a hero's windup. */
export function resolveStrike(w: World, h: Hero): void {
  const st = h.strike;
  if (!st) return;
  h.strike = null;
  const c = CLASSES[h.cls]!;
  const reach = (c.attack.reach ?? 1.6) + 0.4;
  const pickTarget = (): Enemy | null => {
    if (st.targetId) {
      const t = w.byId(st.targetId);
      if (t && t.state !== "dead" && w.isEnemy(t) && w.dist(t, h) <= reach + t.radius + 0.8) return t;
    }
    return aimTarget(w, h, reach + 0.5, 70);
  };
  if (st.kind === "basic") {
    if (c.attack.kind === "projectile") {
      const t = aimTarget(w, h, c.attack.range ?? 12, 40);
      if (t) face(h, t);
      const d = dirOf(h.facing);
      const speed = c.attack.speed ?? 14;
      w.s.projectiles.push({
        id: w.id(), owner: h.id, team: "party", x: h.x + d.x * 0.6, z: h.z + d.z * 0.6, vx: d.x * speed, vz: d.z * speed,
        life: Math.ceil(((c.attack.range ?? 12) / speed) * 60), radius: 0.25, vfx: c.attack.vfx, kind: "attack", damage: c.attack.damage, type: c.attack.type,
        toHit: 0, fire: !!c.attack.fire || !!h.mods.sub.boltIgnites, push: c.attack.push ?? 0, targetX: 0, targetZ: 0, mode: null, enemyAttackIdx: -1,
      });
      w.emit({ t: "sfx", id: "bolt", x: h.x, z: h.z });
      return;
    }
    const arc = ((c.attack.arc ?? 100) * Math.PI) / 360;
    const f = dirOf(h.facing);
    const maxTargets = h.cls === "barbarian" ? 3 : 2;
    const hits = w.enemiesAlive()
      .filter((e) => {
        const dx = e.x - h.x, dz = e.z - h.z, d = Math.hypot(dx, dz);
        if (d > reach + e.radius) return false;
        return d < 0.6 || Math.acos(Math.max(-1, Math.min(1, (dx * f.x + dz * f.z) / d))) <= arc;
      })
      .sort((a, b) => w.dist(a, h) - w.dist(b, h))
      .slice(0, maxTargets);
    w.vfx(c.attack.vfx, h.x + f.x * 0.9, h.z + f.z * 0.9, { y: 0.9, ally: true, dirX: f.x, dirZ: f.z });
    w.emit({ t: "sfx", id: hits.length ? "swing_hit" : "swing", x: h.x, z: h.z });
    for (const e of hits) w.heroAttack(h, e, { melee: true });
    return;
  }
  const t = pickTarget();
  const f = dirOf(h.facing);
  if (st.kind === "sneak") {
    w.vfx("dagger", h.x + f.x * 0.8, h.z + f.z * 0.8, { y: 0.9, ally: true });
    if (t) w.heroAttack(h, t, { melee: true, sneak: true });
  } else if (st.kind === "reckless") {
    w.vfx("cleave", h.x + f.x, h.z + f.z, { y: 0.9, ally: true });
    if (t) w.heroAttack(h, t, { melee: true, adv: 1, bonusDamage: abilityParam("reckless_strike", "damageBonus", 4), label: "Reckless Strike" });
  } else if (st.kind === "smite") {
    w.vfx("turn_undead", h.x + f.x, h.z + f.z, { scale: 0.4, ally: true });
    if (t) {
      const extra = [parseDice(abilityParam("divine_smite", "dice", "2d8"))];
      if (w.isUndead(t)) extra.push(parseDice(abilityParam("divine_smite", "undeadDice", "1d8")));
      w.heroAttack(h, t, { melee: true, extraDice: extra, label: "Divine Smite" });
      if (h.mods.sub.vow) h.markId = t.id;
    }
  }
}

/** Spiritual Weapon / companion summons: drift to the nearest foe and swing on a timer. */
export function updateSummon(w: World, m: Summon): void {
  m.life--;
  const owner = w.byId(m.owner) as Hero | undefined;
  if (m.life <= 0 || !owner || owner.fallen) {
    m.life = 0;
    return;
  }
  const target = w.nearest(m, w.enemiesAlive());
  const goal = target ?? owner;
  const dx = goal.x - m.x, dz = goal.z - m.z, d = Math.hypot(dx, dz);
  const stop = target ? 1.0 : 1.6;
  if (d > stop) {
    m.vx = (dx / d) * m.speed;
    m.vz = (dz / d) * m.speed;
    m.facing = Math.atan2(dx, dz);
  } else {
    m.vx = 0;
    m.vz = 0;
  }
  m.attackT++;
  const every = abilityParam("spiritual_weapon", "attackEvery", 72);
  if (target && d <= abilityParam("spiritual_weapon", "reach", 1.6) + target.radius && m.attackT >= every) {
    m.attackT = 0;
    const mod = abilityMod(owner.scores[castAbility(owner.cls)]);
    w.heroAttack(owner, target, { melee: true, dice: { ...parseDice(abilityParam("spiritual_weapon", "damage", "1d8")), mod: mod - (owner.scores.str !== undefined ? abilityMod(owner.scores.str) : 0) }, type: "force", label: "Spiritual Weapon" });
    w.vfx("slash", target.x, target.z, { y: 1, ally: true });
  }
  void xpOf;
}

function xpOf(e: Enemy): number {
  const d = ENEMIES[e.type]!;
  return d.xpOverride ?? crToXp(d.cr);
}

export type { AnyActor };
