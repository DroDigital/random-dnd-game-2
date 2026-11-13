import { CLASSES } from "../data";
import { activeTelegraph, aimTarget, inTelegraph } from "./abilities";
import type { World } from "./world";
import { BTN, type Enemy, type Hero, type InputFrame } from "./types";

/**
 * AI that drives companions (solo party mode) and every hero in headless balance runs.
 * It produces the same InputFrames a player would, so it plays by exactly the same rules.
 */
export function companionInput(w: World, h: Hero, skill = 0.75): InputFrame {
  const mem = h.aiMem;
  let down = 0;
  let mx = 0, mz = 0;
  const finish = (): InputFrame => {
    if (mem.hold) {
      mem.holdT--;
      const bit = mem.hold === "action" ? BTN.action : mem.hold === "bonus" ? BTN.bonus : BTN.interact;
      if (mem.holdT > 0) down |= bit;
      else mem.hold = null;
    }
    const pressed = down & ~mem.prevDown;
    const released = mem.prevDown & ~down;
    mem.prevDown = down;
    const l = Math.hypot(mx, mz);
    return { mx: l > 1 ? mx / l : mx, mz: l > 1 ? mz / l : mz, down, pressed, released };
  };
  if (h.down || h.fallen || h.hp <= 0) return finish();
  // While a hold is in progress keep holding and stay put.
  if (mem.hold) return finish();
  const go = (x: number, z: number, stop = 0.3): boolean => {
    const dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz);
    if (d <= stop) return true;
    mx = dx / d;
    mz = dz / d;
    return false;
  };
  const leader = w.s.heroes.find((o) => o.ctrl === "human" && !o.fallen && !o.down) ?? w.heroesUp()[0];
  const enemies = w.enemiesAlive();
  const fight = enemies.length > 0 && !!w.s.room?.fight;

  // 1. Danger: a telegraph aimed at me.
  const tg = activeTelegraph(w, [h.id]);
  if (tg) {
    const left = tg.t.end - w.s.tick;
    if (left < 14 && left > 2) {
      if (h.clock.reaction && w.rng.float() < skill * 0.8) down |= BTN.reaction;
      else if (h.dodgeCd <= 0 && w.rng.float() < skill) {
        const dx = h.x - tg.e.x, dz = h.z - tg.e.z, d = Math.hypot(dx, dz) || 1;
        mx = dx / d;
        mz = dz / d;
        down |= BTN.dodge;
        return finish();
      }
    }
  }
  // Area telegraphs anyone is standing in: step out.
  for (const e of enemies) {
    const t = e.telegraph;
    if (t && (t.shape === "circle" || t.shape === "line") && inTelegraph(t, h) && t.end - w.s.tick < 20) {
      const dx = h.x - t.x, dz = h.z - t.z, d = Math.hypot(dx, dz) || 1;
      mx = dx / d;
      mz = dz / d;
      if (h.dodgeCd <= 0 && t.end - w.s.tick < 10) down |= BTN.dodge;
      return finish();
    }
  }

  // 2. Rescue downed allies when it's safe.
  const downed = w.s.heroes.find((o) => o.down && !o.stable && !o.fallen && w.dist(o, h) < 10);
  if (downed) {
    const healer = CLASSES[h.cls]!.bonus === "healing_word" && h.clock.bonus;
    if (healer) {
      mem.hold = "bonus";
      mem.holdT = 2;
      return finish();
    }
    const threat = enemies.some((e) => w.dist(e, downed) < 2.5);
    if (!threat || w.heroesUp().length === 1) {
      if (go(downed.x, downed.z, 1.1)) down |= BTN.interact;
      return finish();
    }
  }

  // 3. Self-care.
  if (h.hp < h.maxHp * 0.3 && h.potions > 0 && h.state !== "windup") {
    mem.hold = "interact";
    mem.holdT = 1;
    return finish();
  }

  if (!fight) {
    // Follow the leader, or walk to the exit once the room is clear.
    if (w.s.room?.cleared && (h.ctrl === "human" || !leader || leader === h)) go(w.s.room.exit.x, w.s.room.exit.z, 0.8);
    else if (leader && leader !== h && h.order !== "hold") go(leader.x + Math.sin(h.slot * 2.1) * 1.6, leader.z + Math.cos(h.slot * 2.1) * 1.6, 1.2);
    else if (h.order === "hold") go(mem.holdX, mem.holdZ, 0.4);
    return finish();
  }

  // 4. Pick a target according to orders.
  let target: Enemy | undefined;
  if (h.order === "focus" && leader) target = w.nearest(leader, enemies);
  else if (h.order === "defensive" && leader) target = enemies.filter((e) => e.ai.targetId === leader.id).sort((a, b) => w.dist(a, leader) - w.dist(b, leader))[0] ?? w.nearest(leader, enemies);
  else target = enemies.find((e) => e.boss && w.dist(e, h) < 6) ?? w.nearest(h, enemies);
  if (!target) return finish();
  const c = CLASSES[h.cls]!;
  const ranged = c.attack.kind === "projectile";
  const d = w.dist(h, target);
  const reach = (c.attack.reach ?? 1.6) + target.radius + h.radius;

  // 5. Bonus actions.
  if (h.clock.bonus && h.state !== "windup") {
    const wounded = w.s.heroes.filter((o) => !o.fallen && (o.down || o.hp < o.maxHp * 0.45));
    let use: "tap" | "hold" | null = null;
    switch (c.bonus) {
      case "healing_word": if (wounded.length) use = "tap"; else if (c.bonusHold && !w.s.summons.some((m) => m.owner === h.id)) use = "hold"; break;
      case "second_wind": if (h.hp < h.maxHp * 0.5) use = "tap"; break;
      case "misty_step": if (h.hp < h.maxHp * 0.5 && enemies.some((e) => w.dist(e, h) < 2.2)) use = "tap"; break;
      case "cunning_dash": if (d > 6) use = "tap"; else if (!enemies.some((e) => w.dist(e, h) < 3) && w.rng.float() < 0.02) use = "hold"; break;
      case "rage": if (d < 5) use = "tap"; break;
      case "hunters_mark": case "hex": if (!h.buffs.mark) use = "tap"; break;
      case "bardic_inspiration": if (w.heroesUp().some((o) => o.inspiration === 0)) use = "tap"; break;
      case "lay_on_hands": if (wounded.some((o) => w.dist(o, h) < 2.5) && h.layOnHands > 0) use = "tap"; break;
    }
    if (use) {
      mem.hold = "bonus";
      mem.holdT = use === "hold" ? 26 : 2;
      return finish();
    }
  }

  // 6. Actions.
  if (h.clock.action && h.state !== "windup" && h.state !== "recover") {
    const near = enemies.filter((e) => w.dist(e, h) < 5).length;
    let use: "tap" | "hold" | null = null;
    switch (c.action) {
      case "action_surge": if (near >= 2 || target.boss) use = "tap"; break;
      case "fireball": {
        const cluster = enemies.filter((e) => w.dist(e, target!) < 3.2).length;
        if (h.slots > 0 && (cluster >= 2 || target.boss) && d < 10 && !w.heroesUp().some((o) => o.id !== h.id && w.dist(o, target!) < 3.5 && w.persona.friendlyFire)) use = "tap";
        else if (cluster >= 3 && d < 8) use = "hold";
        break;
      }
      case "sneak_strike": if (d < 3.5) use = "tap"; break;
      case "turn_undead": if (enemies.filter((e) => w.isUndead(e) && w.dist(e, h) < 9).length >= 2) use = "tap"; break;
      case "reckless_strike": case "divine_smite": if (d < reach + 0.5) use = "tap"; break;
      case "volley": case "hunger_of_hadar": case "entangle": if (enemies.filter((e) => w.dist(e, target!) < 3).length >= 2 && d < 10) use = "tap"; break;
      case "thunderwave": if (near >= 2) use = "tap"; break;
    }
    if (use) {
      const t = aimTarget(w, h, 12, 180);
      if (t) h.facing = Math.atan2(t.x - h.x, t.z - h.z);
      mem.hold = "action";
      mem.holdT = use === "hold" ? 26 : 2;
      return finish();
    }
  }

  // 7. Position and attack.
  if (h.order === "hold" && Math.hypot(mem.holdX - h.x, mem.holdZ - h.z) > 1 && d > reach) {
    go(mem.holdX, mem.holdZ, 0.4);
    return finish();
  }
  if (ranged) {
    if (d < 4) go(h.x + (h.x - target.x), h.z + (h.z - target.z), 0);
    else if (d > (c.attack.range ?? 12) * 0.7) go(target.x, target.z, 0);
    if (d <= (c.attack.range ?? 12) * 0.8 && h.state !== "windup") {
      h.facing = Math.atan2(target.x - h.x, target.z - h.z);
      if ((w.s.tick + h.id) % 3 === 0) down |= BTN.attack;
    }
  } else {
    if (d > reach - 0.2) {
      // Flank: approach from the side opposite another ally.
      const ally = w.heroesUp().find((o) => o.id !== h.id && w.dist(o, target!) < 2);
      if (ally) go(target.x + (target.x - ally.x) * 0.6, target.z + (target.z - ally.z) * 0.6, 0.2);
      else go(target.x, target.z, reach - 0.4);
    } else if (h.state !== "windup") {
      h.facing = Math.atan2(target.x - h.x, target.z - h.z);
      if ((w.s.tick + h.id) % 2 === 0) down |= BTN.attack;
    }
    // Help an ally who is hitting the same target (lets the rogue sneak attack).
    if (w.rng.float() < 0.004 && d < 2.5) down |= BTN.help;
  }
  return finish();
}

/** AI plan for an Initiative Break: step toward the nearest foe and use the Action if it's good. */
export function companionPlan(w: World, h: Hero): { x: number; z: number; action: "attack" | "ability" | "dodge" | "help" } {
  const t = w.nearest(h, w.enemiesAlive());
  if (!t) return { x: h.x, z: h.z, action: "dodge" };
  const c = CLASSES[h.cls]!;
  const ranged = c.attack.kind === "projectile";
  const want = ranged ? 7 : (c.attack.reach ?? 1.6) + t.radius;
  const dx = t.x - h.x, dz = t.z - h.z, d = Math.hypot(dx, dz) || 1;
  const move = Math.max(-3, Math.min(6, d - want));
  const x = h.x + (dx / d) * move, z = h.z + (dz / d) * move;
  const ok = w.standable(x, z);
  const lowHp = h.hp < h.maxHp * 0.3;
  const actionGood = ["fireball", "action_surge", "divine_smite", "reckless_strike", "sneak_strike", "volley", "thunderwave"].includes(c.action);
  return { x: ok ? x : h.x, z: ok ? z : h.z, action: lowHp ? "dodge" : actionGood && h.clock.action ? "ability" : "attack" };
}
