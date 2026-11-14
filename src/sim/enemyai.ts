import { BALANCE, ENEMIES, LEGENDARY, type EnemyAttack } from "../data";
import { parseDice, rollDice } from "../rules/dice";
import { resolveAttack } from "../rules/attack";
import { attackModeSources, canAct, has, speedMultiplier, type Condition } from "../rules/conditions";
import { abilityMod, proficiencyBonus } from "../rules/d20";
import { crToXp } from "../rules/encounter";
import { findPath, lineOfSight, nearestWalkable, walkLine } from "./nav";
import { inTelegraph } from "./abilities";
import { sec, type World } from "./world";
import type { Ability, Enemy, Hero, Telegraph } from "./types";

export function spawnEnemy(w: World, type: string, x: number, z: number, opts: { elite?: boolean; summoned?: boolean } = {}): Enemy {
  const d = ENEMIES[type];
  if (!d) throw new Error(`unknown enemy ${type}`);
  const run = w.s.run;
  const party = Math.max(1, w.s.heroes.filter((h) => !h.fallen).length);
  let hp = d.hp * (d.hpMult ?? 1) * BALANCE.realtime.enemyHpScale * (d.boss ? BALANCE.realtime.bossHpScale : 1);
  if (d.boss) hp *= BALANCE.enemy.bossHpByPartySize[Math.min(3, party - 1)]!;
  if (opts.elite) hp *= BALANCE.enemy.eliteHpMult;
  if (run.mode === "lone") hp *= BALANCE.enemy.solo.hpMult;
  const persona = w.persona;
  if (run.persona === "killer" && persona.tierHp) hp *= 1 + persona.tierHp * run.killerTier;
  hp = Math.max(1, Math.round(hp));
  if (w.s.room) ({ x, z } = nearestWalkable(w.s.room, x, z));
  const crv = d.cr.includes("/") ? Number(d.cr.split("/")[0]) / Number(d.cr.split("/")[1]) : Number(d.cr);
  const e: Enemy = {
    id: w.id(), kind: "enemy", team: "foe", model: d.model, name: (opts.elite ? "Elite " : "") + d.name, x, z, vx: 0, vz: 0, facing: Math.PI,
    radius: d.radius ?? BALANCE.enemy.radius * (opts.elite ? 1.1 : 1), hp, maxHp: hp, tempHp: 0, ac: d.ac + (opts.elite ? 1 : 0),
    speed: d.speed * BALANCE.feetToMetersPerSecond, scores: { str: d.scores.str, dex: d.scores.dex, con: d.scores.con, int: 10, wis: d.scores.wis, cha: 10 },
    prof: proficiencyBonus(Math.max(1, Math.ceil(crv))), conds: {}, state: "idle", stateT: 0, stateDur: 0, anim: "spawn", animSeq: 1, freeze: 0, buffs: {},
    helped: 0, tags: [...d.tags], attackCount: 0, strike: null, lastHitBy: 0, resist: [],
    type, elite: !!opts.elite, boss: !!d.boss, xp: opts.summoned ? 0 : (d.xpOverride ?? crToXp(d.cr)),
    ai: { mode: "idle", t: sec(0.6) + w.rng.int(0, 20), targetId: 0, path: [], repath: 0, cooldowns: d.attacks.map(() => 0) },
    telegraph: null, legendaryUsed: 0, damageBonus: (opts.elite ? BALANCE.enemy.eliteDamageBonus : 0) + (run.persona === "killer" ? (persona.tierDamage ?? 0) * run.killerTier : 0),
    fortitudeUsed: false,
  };
  if (d.tags.includes("flying")) e.tags.push("hover");
  w.s.enemies.push(e);
  w.vfx(opts.summoned ? "summon" : "dust", x, z, { scale: opts.summoned ? 0.8 : 0.7 });
  return e;
}

function attackRange(a: EnemyAttack): number {
  if (a.kind === "melee") return a.reach ?? 1.5;
  if (a.kind === "ranged") return a.range ?? 12;
  if (a.kind === "line") return (a.length ?? 8) * 0.8;
  return a.targeted ? 14 : (a.radius ?? 2) * 0.9;
}

/** Heroes this enemy can see and target (hidden rogues are ignored unless very close). */
function targets(w: World, e: Enemy): Hero[] {
  return w.heroesUp().filter((h) => !(h.buffs.hidden && w.dist(h, e) > 1.6));
}

function chooseTarget(w: World, e: Enemy): Hero | null {
  const list = targets(w, e);
  if (!list.length) return null;
  const cur = list.find((h) => h.id === e.ai.targetId);
  if (cur && w.dist(cur, e) < 9) return cur;
  // Bosses spread pressure; others go for the nearest, with a bias to whoever hit them last.
  let best: Hero | null = null, bs = Infinity;
  for (const h of list) {
    let s = w.dist(h, e);
    if (h.id === e.lastHitBy) s -= 2;
    if (e.boss) s += w.rng.float() * 4;
    if (s < bs) { bs = s; best = h; }
  }
  return best;
}

function dir(a: { x: number; z: number }, b: { x: number; z: number }): { x: number; z: number; d: number } {
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1e-6;
  return { x: dx / d, z: dz / d, d };
}

function moveToward(w: World, e: Enemy, goal: { x: number; z: number }, speedMul = 1): void {
  const room = w.s.room!;
  e.ai.repath--;
  const direct = walkLine(room, e.x, e.z, goal.x, goal.z, e.radius * 0.9);
  let wp = goal;
  if (!direct) {
    if (e.ai.repath <= 0 || e.ai.path.length === 0) {
      e.ai.path = findPath(room, e.x, e.z, goal.x, goal.z);
      e.ai.repath = BALANCE.enemy.repathTicks;
    }
    while (e.ai.path.length && Math.hypot(e.ai.path[0]!.x - e.x, e.ai.path[0]!.z - e.z) < 0.4) e.ai.path.shift();
    wp = e.ai.path[0] ?? goal;
  } else {
    e.ai.path = [];
  }
  const v = dir(e, wp);
  const sp = e.speed * speedMul * speedMultiplier(e.conds);
  e.vx = v.x * sp;
  e.vz = v.z * sp;
  if (sp > 0) e.facing = Math.atan2(v.x, v.z);
}

function pickAttack(w: World, e: Enemy, t: Hero): number {
  const d = ENEMIES[e.type]!;
  const dist = w.dist(e, t) - t.radius - e.radius;
  let best = -1;
  for (let i = 0; i < d.attacks.length; i++) {
    const a = d.attacks[i]!;
    if (e.ai.cooldowns[i]! > 0) continue;
    if (dist > attackRange(a)) continue;
    if (a.kind === "ranged" && !lineOfSight(w.s.room!, e.x, e.z, t.x, t.z)) continue;
    // Prefer special attacks (later in the list) when off cooldown.
    best = i;
  }
  return best;
}

function startTelegraph(w: World, e: Enemy, idx: number, t: Hero): void {
  const a = ENEMIES[e.type]!.attacks[idx]!;
  const v = dir(e, t);
  e.facing = Math.atan2(v.x, v.z);
  const shape: Telegraph["shape"] = a.kind === "melee" ? "melee" : a.kind === "ranged" ? "ranged" : a.kind === "line" ? "line" : "circle";
  const tg: Telegraph = {
    attackIdx: idx, targetId: t.id, shape, x: a.kind === "area" && a.targeted ? t.x : e.x, z: a.kind === "area" && a.targeted ? t.z : e.z,
    radius: a.radius ?? 0, dirX: v.x, dirZ: v.z, length: a.length ?? 0, width: a.width ?? 0, start: w.s.tick, end: w.s.tick + sec(a.telegraph),
    cancelled: false, shieldAc: 0, halve: false, cut: 0, disadvantage: false, thorns: 0,
  };
  e.telegraph = tg;
  e.ai.mode = "telegraph";
  e.ai.t = sec(a.telegraph);
  e.vx = 0;
  e.vz = 0;
  w.setState(e, "windup", e.ai.t, a.anim);
  if (a.kind !== "melee") w.emit({ t: "sfx", id: "telegraph", x: e.x, z: e.z });
}

/** Enemy melee/ranged attack roll against a hero, honouring reactions applied to the telegraph. */
export function enemyAttackRoll(w: World, e: Enemy, a: EnemyAttack, h: Hero, tg: Telegraph | null): void {
  if (h.iframes > 0) {
    w.popup("Dodged!", "#4f9be5", h.x, h.z);
    w.emit({ t: "sfx", id: "whiff", x: h.x, z: h.z });
    return;
  }
  const ms = attackModeSources({
    attacker: e.conds, target: h.conds, melee: a.kind === "melee",
    allyNearTarget: ENEMIES[e.type]!.traits?.includes("pack_tactics") ? w.allyNear(h, "foe", e.id) : false,
  });
  let adv = ms.advantages.length + (h.buffs.reckless ? 1 : 0);
  let dis = ms.disadvantages.length + (tg?.disadvantage ? 1 : 0) + (h.buffs.hidden ? 1 : 0);
  if (h.mods.firstHitDisadvantage && !h.buffs.displaced) { dis++; h.buffs.displaced = sec(6); }
  if (adv < 0) adv = 0;
  const ac = h.ac + (tg?.shieldAc ?? 0) + (h.buffs.shield && !tg?.shieldAc ? 5 : 0) + (h.clock.reaction ? h.mods.reactionAc : 0);
  const dmg = parseDice(a.damage);
  const r = resolveAttack(w.rng, { bonus: (a.toHit ?? 4) - (tg?.cut ?? 0), ac, damage: { ...dmg, mod: dmg.mod + e.damageBonus }, advantages: adv, disadvantages: dis, extraDice: a.extra ? [parseDice(a.extra)] : [] });
  w.emit({ t: "roll", who: e.name, what: a.name, d20: r.d20.rolls, kept: r.d20.natural, total: r.total, vs: ac, vsLabel: "AC", result: r.outcome, mode: r.d20.mode, damage: r.damage, x: h.x, z: h.z, slot: -1 });
  let damage = r.outcome === "graze" && w.persona.noGraze ? 0 : r.damage;
  if (tg?.halve) damage = Math.floor(damage / 2);
  if (tg?.thorns) damage = Math.max(0, damage - tg.thorns);
  if (r.crit) {
    w.s.hitstop = Math.max(w.s.hitstop, BALANCE.hero.critFreezeTicks);
    w.emit({ t: "crit" });
    w.emit({ t: "shake", amount: 3 });
  }
  if (r.stagger) w.setState(e, "stagger", BALANCE.hero.staggerTicks, "hit");
  const dealt = w.damage(h, damage, a.type, e, { crit: r.crit, graze: r.outcome === "graze" });
  if (r.hit) {
    w.vfx(a.vfx, h.x, h.z, { y: 1 });
    w.emit({ t: "shake", amount: 1 });
    if (a.drain) {
      e.hp = Math.min(e.maxHp, e.hp + dealt);
      h.maxHp = Math.max(1, h.maxHp - Math.floor(dealt / 3));
    }
    if (a.onHit && h.hp > 0 && !h.down) {
      if (!w.saveFor(h, a.onHit.save as Ability, a.onHit.dc)) w.addCondition(h, a.onHit.condition as Condition, sec(a.onHit.seconds));
    }
  }
}

function resolveEnemyAttack(w: World, e: Enemy): void {
  const tg = e.telegraph;
  e.telegraph = null;
  if (!tg) return;
  const a = ENEMIES[e.type]!.attacks[tg.attackIdx]!;
  e.ai.cooldowns[tg.attackIdx] = sec(a.cooldown * BALANCE.realtime.enemyCooldownScale);
  if (tg.cancelled) {
    w.popup("…", "#a49eb6", e.x, e.z);
    return;
  }
  const target = w.byId(tg.targetId) as Hero | undefined;
  if (a.kind === "melee") {
    if (!target || target.down || target.fallen || target.hp <= 0) return;
    const reach = (a.reach ?? 1.5) + e.radius + target.radius + 0.5;
    if (w.dist(e, target) > reach) {
      w.vfx("dust", e.x + tg.dirX, e.z + tg.dirZ, { scale: 0.4 });
      return;
    }
    w.vfx(a.vfx, e.x + tg.dirX * 0.8, e.z + tg.dirZ * 0.8, { y: 0.9 });
    enemyAttackRoll(w, e, a, target, tg);
  } else if (a.kind === "ranged") {
    if (!target) return;
    const v = dir(e, target);
    const speed = a.projectileSpeed ?? 14;
    w.s.projectiles.push({
      id: w.id(), owner: e.id, team: "foe", x: e.x + v.x * 0.6, z: e.z + v.z * 0.6, vx: v.x * speed, vz: v.z * speed, life: Math.ceil(((a.range ?? 14) * 1.3 / speed) * 60),
      radius: 0.3, vfx: a.vfx, kind: "enemy", damage: a.damage, type: a.type, toHit: a.toHit ?? 4, fire: a.type === "fire", push: 0, targetX: target.x, targetZ: target.z, mode: null, enemyAttackIdx: tg.attackIdx,
    });
  } else {
    // Area / line: everyone inside the telegraph saves, dodgers avoid it entirely.
    w.vfx(a.vfx, tg.x + (a.kind === "line" ? tg.dirX * (a.length ?? 8) * 0.5 : 0), tg.z + (a.kind === "line" ? tg.dirZ * (a.length ?? 8) * 0.5 : 0), { scale: a.kind === "line" ? 1 : (a.radius ?? 2) / 2 });
    w.emit({ t: "shake", amount: 3 });
    const full = rollDice(w.rng, parseDice(a.damage)).total + e.damageBonus;
    for (const h of w.s.heroes) {
      if (h.fallen || !inTelegraph(tg, h)) continue;
      if (h.iframes > 0) {
        w.popup("Dodged!", "#4f9be5", h.x, h.z);
        continue;
      }
      const saved = w.saveFor(h, (a.save ?? "dex") as Ability, a.dc ?? 12);
      let dmg = saved ? Math.floor(full / 2) : full;
      if (saved && h.mods.evasion) dmg = 0;
      if (tg.halve && tg.targetId === h.id) dmg = Math.floor(dmg / 2);
      w.damage(h, dmg, a.type, e);
      if (!saved && a.onFail && !h.down) w.addCondition(h, a.onFail.condition as Condition, sec(a.onFail.seconds));
    }
    if (a.type === "fire") w.igniteAt(tg.x, tg.z, a.radius ?? 2, e);
  }
}

/** Legendary action: fires at HP thresholds. Returns the action id when a break should start. */
export function checkLegendary(w: World, e: Enemy): string | null {
  const d = ENEMIES[e.type]!;
  if (!d.legendary || e.state === "dead") return null;
  const frac = e.hp / e.maxHp;
  const max = BALANCE.initiativeBreak.maxPerBoss;
  if (e.legendaryUsed >= Math.min(max, d.legendary.thresholds.length)) return null;
  const th = d.legendary.thresholds[e.legendaryUsed]!;
  if (frac > th) return null;
  const act = d.legendary.actions[e.legendaryUsed % d.legendary.actions.length]!;
  e.legendaryUsed++;
  return act;
}

/** Execute a legendary action (during an Initiative Break turn). */
export function runLegendary(w: World, e: Enemy, id: string): void {
  const L = LEGENDARY[id];
  if (!L) return;
  w.popup(L.name.toUpperCase(), "#8f2a35", e.x, e.z, true);
  w.emit({ t: "shake", amount: 4 });
  if (L.summon) {
    for (let i = 0; i < L.summon.count; i++) {
      const ang = (i / L.summon.count) * Math.PI * 2;
      const x = e.x + Math.sin(ang) * 2, z = e.z + Math.cos(ang) * 2;
      if (w.standable(x, z)) spawnEnemy(w, L.summon.id, x, z, { summoned: true });
    }
  }
  if (L.aoe) {
    const a = L.aoe;
    w.vfx(a.type === "necrotic" ? "curse" : a.type === "psychic" ? "frightened" : "shove", e.x, e.z, { scale: a.radius / 2 });
    const before = w.s.heroes.reduce((s, h) => s + h.hp, 0);
    w.areaDamage(e.x, e.z, a.radius, parseDice(a.damage), a.type, a.save as Ability, a.dc, e, { hitTeam: "party", onFail: a.condition ? { c: a.condition as Condition, ticks: sec(a.seconds ?? 2) } : undefined, push: a.push });
    if (a.healSelf) e.hp = Math.min(e.maxHp, e.hp + Math.max(0, before - w.s.heroes.reduce((s, h) => s + h.hp, 0)));
  }
  if (L.dash) {
    const t = chooseTarget(w, e);
    if (t) {
      const v = dir(e, t);
      w.push(e, v.x * Math.min(L.dash.distance, v.d - 1), v.z * Math.min(L.dash.distance, v.d - 1));
      w.vfx("dust", e.x, e.z);
      if (w.dist(e, t) < 2.5) {
        const saved = w.saveFor(t, L.dash.save as Ability, L.dash.dc);
        w.damage(t, (saved ? 0.5 : 1) * rollDice(w.rng, parseDice(L.dash.damage)).total, L.dash.type, e);
        if (!saved && L.dash.condition) w.addCondition(t, L.dash.condition as Condition, sec(1.2));
      }
    }
  }
  if (L.buff) e.buffs.frenzy = sec(L.buff.seconds);
  if (L.zone) w.addZone(L.zone.kind as "acid", e.x, e.z, L.zone.radius, sec(L.zone.seconds), e, L.zone.damage, 13);
}

/** One AI tick: idle → chase → telegraph → attack → recover, with A* pathing and flee on fear. */
export function updateEnemy(w: World, e: Enemy): void {
  if (e.state === "dead") {
    e.vx = e.vz = 0;
    return;
  }
  for (let i = 0; i < e.ai.cooldowns.length; i++) if (e.ai.cooldowns[i]! > 0) e.ai.cooldowns[i]!--;
  if (e.freeze > 0) {
    e.freeze--;
    e.vx = e.vz = 0;
    return;
  }
  if (!canAct(e.conds) || e.state === "stagger") {
    e.vx = e.vz = 0;
    if (e.telegraph && !canAct(e.conds)) e.telegraph = null;
    if (e.state === "stagger" && e.stateT >= e.stateDur) w.setState(e, "idle", 0, "idle");
    return;
  }
  const speedMul = e.buffs.frenzy ? 1.3 : 1;
  const ai = e.ai;
  // Fear: run away from the scariest hero.
  if (has(e.conds, "frightened") && ai.mode !== "telegraph") {
    const scary = w.nearest(e, w.heroesUp());
    if (scary) {
      const v = dir(scary, e);
      moveToward(w, e, { x: e.x + v.x * 3, z: e.z + v.z * 3 }, 1);
      e.anim = "run";
      return;
    }
  }
  const t = chooseTarget(w, e);
  switch (ai.mode) {
    case "idle": {
      e.vx = e.vz = 0;
      if (--ai.t <= 0) {
        const def = ENEMIES[e.type]!;
        const near = t && w.dist(t, e) < (def.ai === "ambusher" ? 5 : BALANCE.enemy.aggroRange);
        if (near || (w.s.room?.fight && def.ai !== "ambusher")) ai.mode = "chase";
        else ai.t = 20;
      }
      if (e.anim !== "idle" && e.stateT > 30) { e.anim = "idle"; }
      return;
    }
    case "chase": {
      if (!t) {
        e.vx = e.vz = 0;
        e.anim = "idle";
        return;
      }
      ai.targetId = t.id;
      const idx = pickAttack(w, e, t);
      if (idx >= 0) {
        startTelegraph(w, e, idx, t);
        return;
      }
      const def = ENEMIES[e.type]!;
      const d = w.dist(e, t);
      if ((def.ai === "ranged" || def.ai === "caster") && d < 5) {
        const v = dir(t, e);
        moveToward(w, e, { x: e.x + v.x * 2, z: e.z + v.z * 2 }, speedMul);
      } else if ((def.ai === "ranged" || def.ai === "caster") && d < 10 && lineOfSight(w.s.room!, e.x, e.z, t.x, t.z)) {
        e.vx = e.vz = 0;
        e.facing = Math.atan2(t.x - e.x, t.z - e.z);
      } else {
        // Swarmers jitter around the target to surround it.
        let gx = t.x, gz = t.z;
        if (def.ai === "swarm" || def.ai === "melee") {
          const ang = (e.id * 2.39996) % (Math.PI * 2);
          gx += Math.sin(ang) * 0.9;
          gz += Math.cos(ang) * 0.9;
        }
        moveToward(w, e, { x: gx, z: gz }, speedMul);
      }
      if (e.anim !== "run") { e.anim = "run"; }
      return;
    }
    case "telegraph": {
      e.vx = e.vz = 0;
      // Track the target a little during the wind-up (not during area attacks).
      const tg = e.telegraph;
      if (tg && tg.shape === "melee" && t && t.id === tg.targetId) {
        const v = dir(e, t);
        e.facing = Math.atan2(v.x, v.z);
        tg.dirX = v.x;
        tg.dirZ = v.z;
      }
      if (--ai.t <= 0) {
        const a = ENEMIES[e.type]!.attacks[e.telegraph?.attackIdx ?? 0]!;
        resolveEnemyAttack(w, e);
        ai.mode = "recover";
        ai.t = Math.round(sec(a.recover) / (e.buffs.frenzy ? 1.6 : 1));
        w.setState(e, "recover", ai.t);
      }
      return;
    }
    case "recover":
    case "attack":
    default: {
      e.vx = e.vz = 0;
      const def = ENEMIES[e.type]!;
      if (def.ai === "skirmisher" && t && ai.t > 10) {
        const v = dir(t, e);
        moveToward(w, e, { x: e.x + v.x * 2, z: e.z + v.z * 2 }, 1.1);
      }
      if (--ai.t <= 0) {
        ai.mode = "chase";
        w.setState(e, "idle", 0);
      }
      return;
    }
  }
}

export function enemySaveBonus(e: Enemy, a: Ability): number {
  return abilityMod(e.scores[a]) + (e.boss ? 2 : 0);
}
