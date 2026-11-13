import { BALANCE, DIRECTOR, ACTS } from "../data";
import { parseDice } from "../rules/dice";
import { spawnEnemy } from "./enemyai";
import { sec, type World } from "./world";

/**
 * The DM Director: Boredom climbs when the party plays slow and safe and pays out a twist;
 * Mercy drops a potion when an early-run party is about to wipe; Delight rises on nat 20s,
 * combos and bold choices and pays out Inspiration (and kinder Mystery rooms).
 */
export function updateDirector(w: World): void {
  const s = w.s;
  const d = s.director;
  const room = s.room;
  if (!room) return;
  const B = DIRECTOR.boredom, D = DIRECTOR.delight;
  const persona = w.persona;
  if (s.tick % 60 === 0) {
    d.delight = Math.max(0, d.delight - D.decayPerSecond);
    if (d.twistCooldown > 0) d.twistCooldown--;
    if (room.fight && !room.cleared) {
      const heroes = w.heroesUp();
      const enemies = w.enemiesAlive();
      const moving = heroes.some((h) => Math.hypot(h.vx, h.vz) > 0.5);
      const engaged = heroes.some((h) => enemies.some((e) => w.dist(e, h) < 6));
      let gain = 0;
      if (!moving) gain += B.perSecondIdle;
      if (!engaged) gain += B.perSecondFarFromEnemies;
      if ((s.tick - room.startTick) / 60 > B.slowFightSeconds) gain += B.perSecondSlowFight;
      d.boredom = Math.min(B.max, d.boredom + gain * persona.boredomMult);
      if (d.boredom >= B.max && d.twistCooldown <= 0) twist(w);
      mercy(w);
    }
    if (d.delight >= D.inspirationAt) {
      const lacking = w.heroesUp().filter((h) => h.inspiration < 3);
      if (lacking.length) {
        const h = w.rng.pick(lacking);
        h.inspiration++;
        w.popup("The DM is delighted: Inspiration!", "#e8cf4a", h.x, h.z, true);
        d.delight -= D.inspirationAt;
      }
    }
  }
}

/** Damage dealt resets some boredom. */
export function onHeroDamageDealt(w: World): void {
  w.s.director.boredom = Math.max(0, w.s.director.boredom - DIRECTOR.boredom.decayOnHit);
}

function twist(w: World): void {
  const s = w.s, d = s.director, room = s.room!;
  d.boredom = 0;
  d.twistCooldown = DIRECTOR.boredom.twistCooldownSeconds;
  const kind = w.rng.pick(DIRECTOR.twists.filter((t) => t !== d.lastTwist));
  d.lastTwist = kind;
  w.narrate("boredom");
  w.narrate(kind);
  const act = ACTS.acts[s.run.act]!;
  const spawns = room.enemySpawns.length ? room.enemySpawns : room.heroSpawns;
  if (kind === "ambush") {
    const n = w.rng.int(2, 3);
    for (let i = 0; i < n; i++) {
      const sp = w.rng.pick(spawns);
      spawnEnemy(w, w.rng.weighted(act.pool, (p) => p.w).id, sp.x + w.rng.float() - 0.5, sp.z + w.rng.float() - 0.5);
    }
  } else if (kind === "rival_party") {
    for (let i = 0; i < 3; i++) {
      const sp = w.rng.pick(spawns);
      const e = spawnEnemy(w, "bandit", sp.x + i * 0.6, sp.z);
      e.name = "Rival Adventurer";
    }
  } else {
    const h = w.rng.pick(w.heroesUp());
    if (h) {
      w.addZone("spikes", h.x, h.z, 2.2, sec(10), null, "1d6");
      w.vfx("dust", h.x, h.z, { scale: 1 });
      w.emit({ t: "shake", amount: 5 });
      w.areaDamage(h.x, h.z, 2.2, parseDice("2d6"), "bludgeoning", "dex", 12, null, { hitTeam: "party", onFail: { c: "prone", ticks: BALANCE.hero.proneTicks } });
    }
  }
}

function mercy(w: World): void {
  const s = w.s, d = s.director;
  const persona = w.persona;
  if (d.mercyUsed >= persona.mercyPerAct || s.run.act > DIRECTOR.mercy.maxActIndex) return;
  const all = s.heroes.filter((h) => !h.fallen);
  if (!all.length) return;
  const frac = all.reduce((t, h) => t + Math.max(0, h.hp) / h.maxHp, 0) / all.length;
  const anyDown = all.some((h) => h.down);
  if (frac < DIRECTOR.mercy.hpFraction || (anyDown && frac < DIRECTOR.mercy.hpFraction * 1.6)) {
    d.mercyUsed++;
    const low = all.filter((h) => !h.down).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0] ?? all[0]!;
    s.pickups.push({ id: w.id(), kind: "potion", x: low.x + 0.8, z: low.z + 0.4, value: 1 });
    w.vfx("potion", low.x + 0.8, low.z + 0.4, { life: 2 });
    w.narrate("mercy");
  }
}
