import { BALANCE, CLASSES, ENEMIES, abilityParam } from "../data";
import { advanceClock } from "../rules/clock";
import { applyDeathSave } from "../rules/deathsave";
import { parseDice, rollDice } from "../rules/dice";
import { resolveAttack } from "../rules/attack";
import { canAct, speedMultiplier, tickConditions } from "../rules/conditions";
import { rollInitiative } from "../rules/initiative";
import { abilityMod } from "../rules/d20";
import { isBlocked } from "./nav";
import { activeTelegraph, aimTarget, resolveStrike, updateSummon, useAbility } from "./abilities";
import { checkLegendary, enemyAttackRoll, runLegendary, updateEnemy } from "./enemyai";
import { sec, type World } from "./world";
import { BTN, type AnyActor, type Hero, type InputFrame, type Projectile } from "./types";

const HOLD_TICKS = 24; // hold Action/Bonus this long for the alternate ability

function tickTimers(w: World, a: AnyActor): void {
  a.stateT++;
  if (a.helped > 0) a.helped--;
  a.conds = tickConditions(a.conds);
  for (const k of Object.keys(a.buffs)) {
    if (--a.buffs[k]! <= 0) delete a.buffs[k];
  }
  void w;
}

function fightActive(w: World): boolean {
  return !!w.s.room && w.s.room.fight && !w.s.room.cleared;
}

/** Hero input → state machine. Free attacks and dodges; Action/Bonus/Reaction gated by the Round Clock. */
export function updateHero(w: World, h: Hero, inp: InputFrame): void {
  if (h.fallen) {
    h.vx = h.vz = 0;
    return;
  }
  tickTimers(w, h);
  if (h.dodgeCd > 0) h.dodgeCd--;
  if (h.iframes > 0) h.iframes--;
  // Round Clock: only runs while a fight is on; out of combat everything is ready.
  if (fightActive(w) && !h.down) {
    const step = 1 + h.mods.clockSpeed;
    const { clock, filled } = advanceClock(h.clock, step);
    h.clock = clock;
    if (filled) {
      w.emit({ t: "sfx", id: "clock", x: h.x, z: h.z });
      if (h.mods.hpRegen) h.hp = Math.min(h.maxHp, h.hp + h.mods.hpRegen);
    }
  } else if (!fightActive(w)) {
    h.clock = { ticks: 0, action: true, bonus: true, reaction: true };
  }
  // Downed: death saves on a timer.
  if (h.down) {
    h.vx = h.vz = 0;
    if (h.stable || !fightActive(w)) return;
    if (--h.down.timer <= 0) {
      h.down.timer = BALANCE.hero.deathSaveTicks;
      const nat = w.rng.die(20);
      const eff = nat === 1 || nat === 20 ? nat : Math.min(19, nat + h.mods.deathSave);
      h.down.saves = applyDeathSave(h.down.saves, eff, w.failLimit());
      w.emit({ t: "deathsave", id: h.id, roll: nat, successes: h.down.saves.successes, failures: h.down.saves.failures });
      w.emit({ t: "roll", who: h.name, what: "Death save", d20: [nat], kept: nat, total: eff, vs: 10, vsLabel: "DC", result: eff >= 10 ? "success" : "failure", mode: "normal", x: h.x, z: h.z, slot: h.slot });
      if (h.down.saves.revived) w.revive(h, 1);
      else if (h.down.saves.dead) w.fall(h);
      else if (h.down.saves.stable) {
        h.stable = true;
        w.popup("STABLE", "#5fc77a", h.x, h.z);
      }
    }
    return;
  }
  if (h.freeze > 0) {
    h.freeze--;
    h.vx = h.vz = 0;
    return;
  }
  const p = inp.pressed, d = inp.down;
  // Hold timers for alternate abilities.
  for (const [k, bit] of [["action", BTN.action], ["bonus", BTN.bonus], ["interact", BTN.interact]] as const) {
    if (d & bit) h.holdT[k]++;
  }
  const busy = h.state === "windup" || h.state === "recover" || h.state === "cast" || h.state === "dodge" || h.state === "stagger";
  const acting = canAct(h.conds);
  const surge = h.buffs.surge ? abilityParam("action_surge", "attackSpeed", 2) : 1;
  const frenzy = h.buffs.rage && h.mods.sub.rageAttackSpeed ? h.mods.sub.rageAttackSpeed : 1;
  const atkSpeed = surge * frenzy;

  // Reaction can be used at any time (even mid-swing) if a telegraph is live.
  if (p & BTN.reaction) {
    if (!h.clock.reaction) w.popup("No reaction", "#6b6185", h.x, h.z);
    else if (useAbility(w, h, CLASSES[h.cls]!.reaction, "reaction")) {
      h.clock.reaction = false;
      w.emit({ t: "sfx", id: "reaction", x: h.x, z: h.z });
    } else w.popup("Nothing to react to", "#6b6185", h.x, h.z);
  }

  // State progression.
  if (h.state === "windup") {
    if (h.strike && h.stateT >= h.strike.at) resolveStrike(w, h);
    if (h.stateT >= h.stateDur) w.setState(h, "idle", 0);
  } else if (h.state === "recover" || h.state === "cast" || h.state === "stagger") {
    if (h.stateT >= h.stateDur) w.setState(h, "idle", 0);
  } else if (h.state === "dodge") {
    if (h.stateT >= h.stateDur) w.setState(h, "idle", 0);
  }

  // Movement intent.
  const mlen = Math.hypot(inp.mx, inp.mz);
  let speed = h.speed * speedMultiplier(h.conds) * (h.buffs.dash ? BALANCE.hero.dashMultiplier : 1);
  if (h.state === "windup" || h.state === "recover" || h.state === "cast") speed *= 0.25;
  if (h.state === "stagger") speed = 0;
  if (h.state !== "dodge") {
    h.vx = mlen > 0.15 ? (inp.mx / Math.max(1, mlen)) * speed : 0;
    h.vz = mlen > 0.15 ? (inp.mz / Math.max(1, mlen)) * speed : 0;
    if (mlen > 0.15 && h.state !== "windup") h.facing = Math.atan2(inp.mx, inp.mz);
  }
  if (!busy && h.state !== "dodge") {
    const moving = mlen > 0.15 && speed > 0;
    const want = moving ? "run" : "idle";
    if (h.anim !== want && (h.anim === "run" || h.anim === "idle" || h.stateT > 20)) {
      h.anim = want;
    }
    h.state = moving ? "move" : "idle";
  }
  if (!acting) return;

  // Dodge (free): i-frames that avoid attacks entirely.
  if (p & BTN.dodge && h.dodgeCd <= 0 && h.state !== "stagger" && h.state !== "dodge") {
    const dd = BALANCE.hero.dodge;
    const dx = mlen > 0.15 ? inp.mx / mlen : Math.sin(h.facing), dz = mlen > 0.15 ? inp.mz / mlen : Math.cos(h.facing);
    h.facing = Math.atan2(dx, dz);
    h.vx = dx * dd.speed;
    h.vz = dz * dd.speed;
    h.iframes = dd.iframes;
    h.dodgeCd = Math.max(6, dd.cooldown + h.mods.dodgeCooldown);
    h.strike = null;
    w.setState(h, "dodge", dd.ticks, "dodge");
    w.emit({ t: "sfx", id: "dodge", x: h.x, z: h.z });
    return;
  }
  if (busy) return;

  // Attack (free).
  if (p & BTN.attack) {
    const c = CLASSES[h.cls]!;
    const t = aimTarget(w, h, c.attack.kind === "melee" ? (c.attack.reach ?? 1.6) + 1.5 : c.attack.range ?? 12, 60);
    if (t) h.facing = Math.atan2(t.x - h.x, t.z - h.z);
    const wind = Math.max(2, Math.round(c.attack.windup / atkSpeed));
    const rec = Math.max(3, Math.round(c.attack.recover / atkSpeed));
    h.strike = { kind: "basic", at: wind, targetId: t?.id };
    w.setState(h, "windup", wind + rec, c.attack.anim);
    return;
  }
  // Action / Bonus: tap on release, hold for the alternate.
  const c = CLASSES[h.cls]!;
  const tryUse = (slot: "action" | "bonus", tap: string, hold: string | undefined): void => {
    const held = h.holdT[slot];
    const releasedNow = (inp.released & (slot === "action" ? BTN.action : BTN.bonus)) !== 0;
    const holdFire = hold && held === HOLD_TICKS;
    if (!releasedNow && !holdFire) return;
    h.holdT[slot] = holdFire ? HOLD_TICKS + 1000 : 0; // swallow the release after a hold fires
    if (releasedNow && held > HOLD_TICKS) return;
    const id = holdFire ? hold! : tap;
    if (!h.clock[slot]) {
      w.popup(slot === "action" ? "Action spent" : "Bonus spent", "#6b6185", h.x, h.z);
      return;
    }
    if (useAbility(w, h, id, slot)) {
      h.clock[slot] = false;
      if (h.cls === "wizard" && w.persona.wildMagic && w.rng.float() < (w.persona.wildMagicChance ?? 0.3)) wildSurge(w, h);
    }
  };
  tryUse("action", c.action, c.actionHold);
  tryUse("bonus", c.bonus, c.bonusHold);
  if (inp.released & BTN.action && !c.actionHold) h.holdT.action = 0;
  if (inp.released & BTN.bonus && !c.bonusHold) h.holdT.bonus = 0;

  // Interact: hold near a downed ally to stabilize them; potion when nothing else to do.
  if (d & BTN.interact) {
    const ally = w.nearest(h, w.s.heroes, (o) => o.id !== h.id && !!o.down && !o.stable && !o.fallen && w.dist(o, h) <= BALANCE.hero.stabilizeRange);
    if (ally && ally.down) {
      ally.down.stabilizeT += h.mods.stabilizeFast ? 2 : 1;
      h.anim = "interact";
      h.vx = h.vz = 0;
      if (ally.down.stabilizeT >= BALANCE.hero.stabilizeTicks) {
        ally.stable = true;
        ally.down.saves = { ...ally.down.saves, stable: true };
        w.popup("STABILIZED", "#5fc77a", ally.x, ally.z, true);
        w.emit({ t: "sfx", id: "stabilize", x: ally.x, z: ally.z });
      }
    }
  } else {
    h.holdT.interact = 0;
  }
  if (inp.released & BTN.interact) {
    const anyDowned = w.s.heroes.some((o) => o.id !== h.id && o.down && !o.stable && w.dist(o, h) <= BALANCE.hero.stabilizeRange);
    if (!anyDowned && h.potions > 0 && h.hp < h.maxHp && h.state !== "windup") {
      h.potions--;
      w.heal(h, rollDice(w.rng, parseDice("2d4+2")).total, null);
      w.setState(h, "cast", h.mods.sub.fastHands ? 8 : 30, "interact");
      w.vfx("potion", h.x, h.z, { follow: h.id, ally: true, scale: 0.7 });
    }
  }
  // Help: the next attack against the nearest foe has advantage.
  if (p & BTN.help) {
    const t = w.nearest(h, w.enemiesAlive(), (e) => w.dist(e, h) <= BALANCE.hero.helpRange);
    if (t) {
      t.helped = BALANCE.hero.helpTicks;
      w.popup("HELP!", "#f2b45a", t.x, t.z);
      w.setState(h, "recover", 12, "interact");
    }
  }
}

function wildSurge(w: World, h: Hero): void {
  const list = ["fireball_self", "heal_all", "lightning", "frost", "grease_everywhere", "inspire", "haste"];
  const pick = w.rng.pick(list);
  w.popup(`WILD MAGIC: ${pick.replace(/_/g, " ")}`, "#e8cf4a", h.x, h.z, true);
  switch (pick) {
    case "fireball_self": w.areaDamage(h.x, h.z, 3, parseDice("3d6"), "fire", "dex", 13, h, { hitTeam: "both" }); w.vfx("fireball_burst", h.x, h.z); break;
    case "heal_all": for (const o of w.heroesUp()) w.heal(o, 6, null); break;
    case "lightning": { const t = w.nearest(h, w.enemiesAlive()); if (t) { w.damage(t, rollDice(w.rng, parseDice("4d8")).total, "lightning", h); w.vfx("lightning", t.x, t.z); } break; }
    case "frost": w.areaDamage(h.x, h.z, 4, parseDice("2d6"), "cold", "con", 13, h, { hitTeam: "foe", onFail: { c: "restrained", ticks: 60 } }); w.vfx("frost", h.x, h.z); break;
    case "grease_everywhere": for (const e of w.enemiesAlive().slice(0, 4)) w.addZone("grease", e.x, e.z, 1.6, sec(10), h); break;
    case "inspire": for (const o of w.heroesUp()) o.inspiration = Math.min(3, o.inspiration + 1); break;
    default: h.buffs.dash = sec(6); h.buffs.surge = sec(4);
  }
}

function updateProjectile(w: World, pr: Projectile): boolean {
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    pr.x += (pr.vx / 60) / steps;
    pr.z += (pr.vz / 60) / steps;
    if (pr.kind === "fireball") {
      // Fireball passing over grease ignites it.
      if (w.s.zones.some((z) => z.kind === "grease" && w.dist(z, pr) < z.r)) {
        explodeFireball(w, pr);
        return false;
      }
      continue;
    }
    if (pr.fire) {
      for (const z of w.s.zones) if (z.kind === "grease" && w.dist(z, pr) < z.r) w.igniteAt(pr.x, pr.z, 0.3, w.byId(pr.owner) ?? null);
    }
    if (w.s.room && isBlocked(w.s.room, pr.x, pr.z) && !(w.s.room.cells[Math.floor(pr.z) * w.s.room.w + Math.floor(pr.x)] === 2)) return false;
    const foes: AnyActor[] = pr.team === "party" ? w.enemiesAlive() : w.s.heroes.filter((h) => !h.fallen && !h.down);
    for (const t of foes) {
      if (w.dist(t, pr) > t.radius + pr.radius) continue;
      const owner = w.byId(pr.owner);
      if (pr.team === "party" && owner && w.isHero(owner)) {
        w.heroAttack(owner, t, { melee: false, dice: parseDice(pr.damage), type: pr.type, fire: pr.fire });
        if (pr.push && t.state !== "dead") w.push(t, Math.sign(pr.vx) * pr.push * Math.abs(pr.vx) / Math.hypot(pr.vx, pr.vz), Math.sign(pr.vz) * pr.push * Math.abs(pr.vz) / Math.hypot(pr.vx, pr.vz));
      } else if (pr.team === "foe" && owner && w.isEnemy(owner) && w.isHero(t)) {
        const a = ENEMIES[owner.type]!.attacks[pr.enemyAttackIdx]!;
        enemyAttackRoll(w, owner, a, t, null);
      } else if (pr.team === "foe" && w.isHero(t)) {
        const r = resolveAttack(w.rng, { bonus: pr.toHit, ac: t.ac, damage: parseDice(pr.damage) });
        w.damage(t, r.damage, pr.type, null, { crit: r.crit, graze: r.outcome === "graze" });
      }
      w.vfx("hit", pr.x, pr.z, { y: 1 });
      return false;
    }
  }
  if (--pr.life <= 0) {
    if (pr.kind === "fireball") explodeFireball(w, pr);
    return false;
  }
  return true;
}

function explodeFireball(w: World, pr: Projectile): void {
  const h = w.byId(pr.owner) as Hero | undefined;
  const lvl = h?.level ?? 1;
  const per = abilityParam<{ every: number; dice: string }>("fireball", "perLevel", { every: 2, dice: "1d6" });
  const base = parseDice(abilityParam("fireball", "damage", "3d6"));
  const dice = { ...base, count: base.count + Math.floor((lvl - 1) / per.every) + (h?.mods.aoeDice ?? 0) + (h?.mods.sub.fireballDice ?? 0), mod: (h?.mods.fireDamage ?? 0) + (h?.mods.spellDamage ?? 0) };
  const r = abilityParam("fireball", "radius", 3.2);
  w.vfx("fireball_burst", pr.x, pr.z, { scale: r / 2.5 });
  w.emit({ t: "sfx", id: "explosion", x: pr.x, z: pr.z });
  w.emit({ t: "shake", amount: 4 });
  const dc = h ? 8 + h.prof + abilityMod(h.scores.int) + h.mods.spellDc : 13;
  const ff = w.persona.friendlyFire ? "both" : "foe";
  w.areaDamage(pr.x, pr.z, r, dice, "fire", "dex", dc, h ?? null, { hitTeam: ff, sculpt: !!h?.mods.sub.sculpt });
  w.igniteAt(pr.x, pr.z, r, h ?? null);
}

function updateZones(w: World): void {
  for (const z of w.s.zones) {
    z.life--;
    z.tickT++;
    if (z.tickT < 60) continue;
    z.tickT = 0;
    const inside = (a: AnyActor): boolean => w.dist(a, z) <= z.r + a.radius * 0.5;
    switch (z.kind) {
      case "fire":
        for (const a of [...w.enemiesAlive(), ...w.heroesUp()]) {
          if (!inside(a)) continue;
          if (a.team === "party" && !w.persona.friendlyFire && z.team === "party") continue;
          w.damage(a, rollDice(w.rng, parseDice(z.dice || "2d4")).total, "fire", w.byId(z.owner) ?? null);
          w.vfx("burning", a.x, a.z, { follow: a.id, life: 0.9, scale: 0.7 });
        }
        break;
      case "grease":
        for (const e of w.enemiesAlive()) if (inside(e) && !e.conds.prone && !w.saveFor(e, "dex", z.dc)) w.addCondition(e, "prone", BALANCE.hero.proneTicks);
        break;
      case "darkness":
        for (const e of w.enemiesAlive()) if (inside(e)) {
          w.addCondition(e, "blinded", 70);
          w.damage(e, rollDice(w.rng, parseDice(z.dice || "2d6")).total, "cold", w.byId(z.owner) ?? null);
        }
        break;
      case "entangle": {
        const owner = w.byId(z.owner) as Hero | undefined;
        if (z.tickT === 0 && z.life % 120 < 60) for (const e of w.enemiesAlive()) if (inside(e) && !e.conds.restrained && !w.saveFor(e, "str", z.dc)) w.addCondition(e, "restrained", 120);
        if (owner?.mods.sub.entangleHeals) for (const h of w.heroesUp()) if (inside(h)) w.heal(h, 2, owner);
        break;
      }
      case "acid":
      case "poison":
        for (const h of w.heroesUp()) if (inside(h)) w.damage(h, rollDice(w.rng, parseDice(z.dice || "1d6")).total, z.kind, w.byId(z.owner) ?? null);
        break;
      case "spikes":
        for (const h of w.heroesUp()) if (inside(h) && h.iframes <= 0) w.damage(h, rollDice(w.rng, parseDice("1d6")).total, "piercing", null);
        break;
    }
  }
  w.s.zones = w.s.zones.filter((z) => z.life > 0);
}

/** Integrate velocities with grid collision and soft actor separation. */
function physics(w: World): void {
  const room = w.s.room;
  const all: AnyActor[] = [...w.s.heroes.filter((h) => !h.fallen), ...w.enemiesAlive(), ...w.s.summons];
  for (const a of all) {
    const dx = a.vx / 60, dz = a.vz / 60;
    if (dx === 0 && dz === 0) continue;
    if (!room || a.kind === "summon" || a.tags.includes("hover") && a.kind === "enemy" && false) {
      a.x += dx;
      a.z += dz;
      continue;
    }
    const r = a.radius * 0.9;
    const nx = a.x + dx;
    if (!isBlocked(room, nx + Math.sign(dx) * r, a.z) && !isBlocked(room, nx + Math.sign(dx) * r, a.z + r * 0.7) && !isBlocked(room, nx + Math.sign(dx) * r, a.z - r * 0.7)) a.x = nx;
    const nz = a.z + dz;
    if (!isBlocked(room, a.x, nz + Math.sign(dz) * r) && !isBlocked(room, a.x + r * 0.7, nz + Math.sign(dz) * r) && !isBlocked(room, a.x - r * 0.7, nz + Math.sign(dz) * r)) a.z = nz;
  }
  // Separation.
  const solid = all.filter((a) => a.kind !== "summon" && !(w.isHero(a) && a.down));
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const a = solid[i]!, b = solid[j]!;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    const min = (a.radius + b.radius) * BALANCE.enemy.separation;
    if (d >= min || d < 1e-6) continue;
    const push = (min - d) / 2;
    const ux = dx / d, uz = dz / d;
    const aw = a.team === b.team ? 0.5 : w.isEnemy(a) && a.boss ? 0.1 : 0.5;
    const bw = 1 - aw;
    const ax = a.x - ux * push * 2 * aw, az = a.z - uz * push * 2 * aw;
    const bx = b.x + ux * push * 2 * bw, bz = b.z + uz * push * 2 * bw;
    if (!room || !isBlocked(room, ax, az)) { a.x = ax; a.z = az; }
    if (!room || !isBlocked(room, bx, bz)) { b.x = bx; b.z = bz; }
  }
  // Shared camera leash: heroes can't spread further than the camera's zoom cap allows.
  const up = w.s.heroes.filter((h) => !h.fallen);
  if (up.length > 1) {
    const maxSpanR = BALANCE.camera.maxHeight * (16 / 9) - BALANCE.camera.padding * 2;
    const maxSpanU = BALANCE.camera.maxHeight / Math.sin((35 * Math.PI) / 180) - BALANCE.camera.padding * 2;
    const proj = (h: Hero): [number, number] => [(h.x - h.z) * Math.SQRT1_2, (-h.x - h.z) * Math.SQRT1_2];
    for (const h of up) {
      const others = up.filter((o) => o !== h).map(proj);
      const [pr, pu] = proj(h);
      const minR = Math.min(...others.map((o) => o[0])), maxR = Math.max(...others.map((o) => o[0]));
      const minU = Math.min(...others.map((o) => o[1])), maxU = Math.max(...others.map((o) => o[1]));
      const cr = Math.max(maxR - maxSpanR, Math.min(minR + maxSpanR, pr));
      const cu = Math.max(maxU - maxSpanU, Math.min(minU + maxSpanU, pu));
      if (cr !== pr || cu !== pu) {
        // Back to world: x = (r - u)/√2, z = (-r - u)/√2
        const nx = (cr - cu) * Math.SQRT1_2, nz = (-cr - cu) * Math.SQRT1_2;
        if (!room || !isBlocked(room, nx, nz)) { h.x = nx; h.z = nz; }
      }
    }
  }
}

function collectPickups(w: World): void {
  const up = w.heroesUp();
  w.s.pickups = w.s.pickups.filter((p) => {
    const h = up.find((o) => w.dist(o, p) < 1.0);
    if (!h) return true;
    if (p.kind === "gold") {
      const amt = Math.round(p.value * (1 + up.reduce((s, o) => s + o.mods.goldFind, 0)));
      w.s.run.gold += amt;
      w.popup(`+${amt}g`, "#e8cf4a", p.x, p.z);
      w.emit({ t: "sfx", id: "coin", x: p.x, z: p.z });
    } else if (p.kind === "potion") {
      h.potions = Math.min(3 + h.mods.potionSlots, h.potions + 1);
      w.popup("+Potion", "#e5584f", p.x, p.z);
      w.emit({ t: "sfx", id: "pickup", x: p.x, z: p.z });
    }
    return false;
  });
}

// ------------------------------------------------------------------------------------------------
// Initiative Break
// ------------------------------------------------------------------------------------------------
export function startInitiativeBreak(w: World, bossId: number, legendary: string): void {
  const boss = w.byId(bossId);
  const entries = [
    ...w.heroesUp().map((h) => ({ id: h.id, dexMod: abilityMod(h.scores.dex) + h.mods.initiative, hero: true })),
    ...w.enemiesAlive().map((e) => ({ id: e.id, dexMod: abilityMod(e.scores.dex), hero: false })),
  ];
  const order = rollInitiative(w.rng, entries).map((r) => ({ id: r.id, total: r.total, roll: r.roll }));
  const plans: NonNullable<typeof w.s.init>["plans"] = {};
  for (const h of w.heroesUp()) {
    plans[h.id] = { x: h.x, z: h.z, action: "none", ready: false, cursor: 0 };
    h.clock.action = true;
    h.vx = h.vz = 0;
    w.emit({ t: "roll", who: h.name, what: "Initiative", d20: [order.find((o) => o.id === h.id)!.roll], kept: order.find((o) => o.id === h.id)!.roll, total: order.find((o) => o.id === h.id)!.total, vs: 0, vsLabel: "DC", result: "", mode: "normal", x: h.x, z: h.z, slot: h.slot });
  }
  for (const e of w.enemiesAlive()) {
    e.telegraph = null;
    e.vx = e.vz = 0;
  }
  w.s.projectiles = [];
  w.s.init = { bossId, phase: "plan", planT: BALANCE.initiativeBreak.planTicks, order, plans, turn: 0, turnT: 0, legendary };
  w.emit({ t: "initiative", on: true });
  w.narrate("initiative");
  if (boss) w.popup("INITIATIVE!", "#e8cf4a", boss.x, boss.z, true);
}

/** Planning: each player steers a cursor up to 6 tiles and picks an action; then turns resolve in order. */
export function updateInitiative(w: World, inputs: (InputFrame | undefined)[], aiPlans: Map<number, { x: number; z: number; action: "attack" | "ability" | "dodge" | "help" }>): void {
  const init = w.s.init!;
  const maxMove = BALANCE.initiativeBreak.moveTiles;
  if (init.phase === "plan") {
    init.planT--;
    for (const h of w.heroesUp()) {
      const plan = init.plans[h.id];
      if (!plan || plan.ready) continue;
      const ai = aiPlans.get(h.id);
      if (ai) {
        Object.assign(plan, ai, { ready: true });
        continue;
      }
      const inp = inputs[h.slot];
      if (!inp) continue;
      plan.x += inp.mx * 0.1;
      plan.z += inp.mz * 0.1;
      const dx = plan.x - h.x, dz = plan.z - h.z, d = Math.hypot(dx, dz);
      if (d > maxMove) {
        plan.x = h.x + (dx / d) * maxMove;
        plan.z = h.z + (dz / d) * maxMove;
      }
      if (w.s.room && isBlocked(w.s.room, plan.x, plan.z)) {
        plan.x -= inp.mx * 0.1;
        plan.z -= inp.mz * 0.1;
      }
      const pick = (bit: number, a: "attack" | "ability" | "dodge" | "help"): void => {
        if (inp.pressed & bit) {
          plan.action = a;
          plan.ready = true;
          w.emit({ t: "sfx", id: "ui_confirm" });
        }
      };
      pick(BTN.attack, "attack");
      pick(BTN.action, "ability");
      pick(BTN.dodge, "dodge");
      pick(BTN.help, "help");
    }
    const allReady = w.heroesUp().every((h) => init.plans[h.id]?.ready);
    if (allReady || init.planT <= 0) {
      init.phase = "resolve";
      init.turn = 0;
      init.turnT = 0;
    }
    return;
  }
  // Resolve, one combatant per turn in initiative order.
  const per = BALANCE.initiativeBreak.resolveTicksPerTurn;
  const entry = init.order[init.turn];
  if (!entry) {
    w.s.init = null;
    w.emit({ t: "initiative", on: false });
    for (const h of w.s.heroes) h.iframes = 0;
    return;
  }
  const actor = w.byId(entry.id);
  const alive = actor && actor.state !== "dead" && !(w.isHero(actor) && (actor.down || actor.fallen));
  if (!alive) {
    init.turn++;
    init.turnT = 0;
    return;
  }
  init.turnT++;
  if (w.isHero(actor)) {
    const plan = init.plans[actor.id];
    if (plan && init.turnT <= per / 2) {
      const k = 1 / (per / 2 - init.turnT + 1);
      const dx = plan.x - actor.x, dz = plan.z - actor.z;
      actor.x += dx * k;
      actor.z += dz * k;
      if (Math.hypot(dx, dz) > 0.05) actor.facing = Math.atan2(dx, dz);
      actor.anim = "run";
    }
    if (plan && init.turnT === Math.floor(per / 2)) {
      actor.anim = "idle";
      const t = aimTarget(w, actor, 30, 180);
      if (t) actor.facing = Math.atan2(t.x - actor.x, t.z - actor.z);
      if (plan.action === "attack") {
        const c = CLASSES[actor.cls]!;
        actor.strike = { kind: "basic", at: 0, targetId: t?.id };
        w.setState(actor, "windup", 10, c.attack.anim);
        resolveStrike(w, actor);
      } else if (plan.action === "ability") {
        if (useAbility(w, actor, CLASSES[actor.cls]!.action, "action")) actor.clock.action = false;
        if (actor.strike) resolveStrike(w, actor);
      } else if (plan.action === "dodge") {
        actor.iframes = 999; // protected for the rest of the break
        w.popup("DODGE", "#4f9be5", actor.x, actor.z);
      } else if (plan.action === "help") {
        if (t) {
          t.helped = BALANCE.hero.helpTicks;
          w.popup("HELP!", "#f2b45a", t.x, t.z);
        }
      }
    }
  } else if (w.isEnemy(actor)) {
    const target = w.nearest(actor, w.heroesUp());
    if (target && init.turnT <= per / 2) {
      const dx = target.x - actor.x, dz = target.z - actor.z, d = Math.hypot(dx, dz);
      const want = Math.max(0, d - (actor.radius + target.radius + 1.0));
      const move = Math.min(want, BALANCE.initiativeBreak.moveTiles) / (per / 2);
      w.push(actor, (dx / (d || 1)) * move, (dz / (d || 1)) * move);
      actor.facing = Math.atan2(dx, dz);
      actor.anim = "run";
    }
    if (init.turnT === Math.floor(per / 2)) {
      actor.anim = "idle";
      if (actor.id === init.bossId) {
        runLegendary(w, actor, init.legendary);
      } else if (target) {
        const atks = ENEMIES[actor.type]!.attacks;
        const a = atks[0]!;
        if (a.kind === "melee" && w.dist(actor, target) <= (a.reach ?? 1.5) + actor.radius + target.radius + 0.6) {
          w.setState(actor, "recover", 20, a.anim);
          enemyAttackRoll(w, actor, a, target, null);
        }
      }
    }
  }
  if (init.turnT >= per) {
    init.turn++;
    init.turnT = 0;
  }
}

/** One fixed step of a combat room. */
export function stepRoom(w: World, inputs: (InputFrame | undefined)[], aiInputs: Map<number, InputFrame>): void {
  const s = w.s;
  if (s.hitstop > 0) {
    s.hitstop--;
    return;
  }
  for (const h of s.heroes) {
    const inp = h.ctrl === "ai" ? aiInputs.get(h.id) : inputs[h.slot];
    updateHero(w, h, inp ?? { mx: 0, mz: 0, down: 0, pressed: 0, released: 0 });
  }
  for (const m of s.summons) updateSummon(w, m);
  s.summons = s.summons.filter((m) => m.life > 0);
  for (const e of s.enemies) {
    tickTimers(w, e);
    updateEnemy(w, e);
    if (e.boss || e.elite) {
      const leg = checkLegendary(w, e);
      if (leg) {
        startInitiativeBreak(w, e.id, leg);
        break;
      }
    }
  }
  s.projectiles = s.projectiles.filter((p) => updateProjectile(w, p));
  updateZones(w);
  physics(w);
  collectPickups(w);
  // Hazard tiles hurt.
  if (s.room && s.tick % 60 === 0) {
    for (const h of w.heroesUp()) {
      const c = s.room.cells[Math.floor(h.z) * s.room.w + Math.floor(h.x)];
      if (c === 3 && h.iframes <= 0) w.damage(h, rollDice(w.rng, parseDice("1d4")).total, "piercing", null);
    }
  }
  // Dead enemies linger for their death animation, then are removed.
  s.enemies = s.enemies.filter((e) => !(e.state === "dead" && e.stateT > 240));
  void activeTelegraph;
}
