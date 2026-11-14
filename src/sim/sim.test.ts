import { describe, expect, it } from "vitest";
import { runHeadless } from "./headless";
import { createRun } from "./run";
import { Sim, hashState } from "./sim";
import { buildRoom } from "./room";
import { spawnEnemy } from "./enemyai";
import { useAbility } from "./abilities";
import { botCommands } from "./bot";
import { ACTS } from "../data";
import { Rng } from "../rules/rng";
import { BTN, type InputFrame, type SimState } from "./types";

const PARTY = ["fighter", "wizard", "rogue", "cleric"];

/** Scripted "human" input for slot 0 from its own RNG (independent of the sim's). */
function scripted(seed: number): (tick: number) => (InputFrame | undefined)[] {
  const r = Rng.fromSeed(seed);
  let prev = 0;
  let dir = { x: 0, z: 0 };
  return (tick) => {
    if (tick % 20 === 0) dir = { x: r.float() * 2 - 1, z: r.float() * 2 - 1 };
    let down = 0;
    if (r.float() < 0.08) down |= BTN.attack;
    if (r.float() < 0.01) down |= BTN.dodge;
    if (r.float() < 0.01) down |= BTN.action;
    if (r.float() < 0.01) down |= BTN.bonus;
    if (r.float() < 0.005) down |= BTN.reaction;
    const f = { mx: dir.x, mz: dir.z, down, pressed: down & ~prev, released: prev & ~down };
    prev = down;
    return [f];
  };
}

function cfg(seed: number, humans = 1) {
  return { seed, persona: "storyteller" as const, mode: "coop" as const, heroes: PARTY.map((cls, slot) => ({ slot, cls, ctrl: slot < humans ? "human" as const : "ai" as const })) };
}

describe("determinism", () => {
  it("the same seed and inputs give the same run (all-AI full run)", () => {
    const a = runHeadless(cfg(42, 0), { maxTicks: 60 * 60 * 30 });
    const b = runHeadless(cfg(42, 0), { maxTicks: 60 * 60 * 30 });
    expect(hashState(a.sim.s)).toBe(hashState(b.sim.s));
    expect(a.ticks).toBe(b.ticks);
    expect(a.victory).toBe(b.victory);
  });

  it("the same seed and scripted player inputs give identical states at every checkpoint", () => {
    const hashes = (): string[] => {
      const out: string[] = [];
      runHeadless(cfg(7, 1), { maxTicks: 6000, inputs: scripted(99), onEvents: (_e, t) => { if (t % 500 === 0) out.push(String(t)); } });
      const sim = new Sim(createRun(cfg(7, 1)));
      const inp = scripted(99);
      const seen: string[] = [];
      for (let t = 0; t < 6000 && !sim.s.run.ended; t++) {
        sim.step(inp(t), t % 30 === 0 ? [] : []);
        if (t % 500 === 0) seen.push(hashState(sim.s));
      }
      return seen;
    };
    expect(hashes()).toEqual(hashes());
  });

  it("different seeds diverge", () => {
    const a = runHeadless(cfg(1, 0), { maxTicks: 3000 });
    const b = runHeadless(cfg(2, 0), { maxTicks: 3000 });
    expect(hashState(a.sim.s)).not.toBe(hashState(b.sim.s));
  });

  it("save → JSON → load continues exactly like an uninterrupted run", () => {
    const inp = scripted(5);
    const straight = runHeadless(cfg(11, 1), { maxTicks: 5000, inputs: inp });
    const inp2 = scripted(5);
    const half = runHeadless(cfg(11, 1), { maxTicks: 2500, inputs: inp2 });
    const restored = new Sim(JSON.parse(JSON.stringify(half.sim.s)) as SimState);
    // Continue with the same input stream and the same bot cadence as runHeadless.
    while (restored.s.tick < 5000 && !restored.s.run.ended) {
      const cmds = restored.s.tick % 30 === 0 ? botCommands(restored.s) : [];
      restored.step(inp2(restored.s.tick), cmds);
    }
    expect(hashState(restored.s)).toBe(hashState(straight.sim.s));
  });
});

/** A fresh combat room with the given heroes and enemies placed by hand. */
function arena(classes: string[], enemies: { id: string; x: number; z: number }[]): Sim {
  const s = createRun({ seed: 3, persona: "storyteller", mode: "coop", heroes: classes.map((cls, slot) => ({ slot, cls, ctrl: "human" as const })) });
  const sim = new Sim(s);
  s.room = buildRoom("hall", "encounter", sim.world.rng, ACTS.acts[0]!, 0);
  s.room.fight = true;
  s.run.phase = "room";
  s.heroes.forEach((h, i) => { h.x = 6 + i; h.z = 8; });
  for (const e of enemies) {
    const en = spawnEnemy(sim.world, e.id, e.x, e.z);
    en.ai.t = 99999; // keep them passive unless a test wants otherwise
  }
  return sim;
}

describe("combat rules in the sim", () => {
  it("grease + fire makes a burning field", () => {
    const sim = arena(["wizard"], [{ id: "skeleton", x: 10, z: 8 }]);
    const w = sim.world;
    const wiz = sim.s.heroes[0]!;
    wiz.facing = Math.atan2(4, 0);
    expect(useAbility(w, wiz, "grease", "action")).toBe(true);
    expect(sim.s.zones.some((z) => z.kind === "grease")).toBe(true);
    const lit = w.igniteAt(sim.s.zones[0]!.x, sim.s.zones[0]!.z, 1, wiz);
    expect(lit).toBe(true);
    expect(sim.s.zones.some((z) => z.kind === "fire")).toBe(true);
  });

  it("a Fireball explodes for fire damage and ignites grease it passes", () => {
    const sim = arena(["wizard"], [{ id: "ogre", x: 12, z: 8 }]);
    const w = sim.world;
    const wiz = sim.s.heroes[0]!;
    w.addZone("grease", 12, 8, 2, 600, wiz);
    const hp = sim.s.enemies[0]!.hp;
    useAbility(w, wiz, "fireball", "action");
    for (let i = 0; i < 90; i++) sim.step([]);
    expect(sim.s.enemies[0]!.hp).toBeLessThan(hp);
    expect(sim.s.zones.some((z) => z.kind === "fire")).toBe(true);
  });

  it("prone grants advantage, which enables Sneak Attack", () => {
    const sim = arena(["rogue"], [{ id: "ogre", x: 7.3, z: 8 }]);
    const w = sim.world;
    const rogue = sim.s.heroes[0]!;
    const ogre = sim.s.enemies[0]!;
    rogue.x = 6; rogue.z = 8; rogue.facing = Math.PI / 2;
    ogre.conds.prone = 200;
    const events: string[] = [];
    for (let i = 0; i < 40; i++) {
      const r = w.heroAttack(rogue, ogre, { melee: true, sneak: true });
      w.events.forEach((e) => { if (e.t === "roll") events.push(e.what); });
      w.events = [];
      if (r?.hit) break;
      ogre.hp = ogre.maxHp;
    }
    expect(events.some((e) => e.includes("Sneak Attack") && e.includes("prone target"))).toBe(true);
  });

  it("Spiritual Weapon counts as a flanking ally", () => {
    const sim = arena(["cleric", "rogue"], [{ id: "ogre", x: 12, z: 8 }]);
    const w = sim.world;
    const [cleric] = sim.s.heroes;
    const ogre = sim.s.enemies[0]!;
    expect(w.allyNear(ogre, "party", -1)).toBe(false);
    useAbility(w, cleric!, "spiritual_weapon", "bonus");
    const m = sim.s.summons[0]!;
    m.x = ogre.x - 0.8; m.z = ogre.z;
    expect(w.allyNear(ogre, "party", cleric!.id)).toBe(true);
  });

  it("the Fighter shoves on every third hit", () => {
    const sim = arena(["fighter"], [{ id: "bandit", x: 7.2, z: 8 }]);
    const w = sim.world;
    const f = sim.s.heroes[0]!;
    const e = sim.s.enemies[0]!;
    f.attackCount = 2;
    let shoved = false;
    for (let i = 0; i < 30 && !shoved; i++) {
      e.hp = e.maxHp;
      const before = e.x;
      const r = w.heroAttack(f, e, { melee: true });
      if (r?.hit && f.attackCount % 3 === 0) shoved = Math.abs(e.x - before) > 0.5;
      f.attackCount = r?.hit ? 2 : f.attackCount;
      e.x = 7.2;
    }
    expect(shoved).toBe(true);
  });

  it("downed heroes make death saves every 3 s and stabilize or fall", () => {
    const sim = arena(["fighter", "cleric"], [{ id: "skeleton", x: 18, z: 3 }]);
    const w = sim.world;
    const f = sim.s.heroes[0]!;
    w.damage(f, 999, "slashing", null);
    expect(f.down).not.toBeNull();
    for (let i = 0; i < 180 * 6 && f.down && !f.stable && !f.fallen; i++) sim.step([]);
    expect(f.stable || f.fallen || f.hp > 0).toBe(true);
  });

  it("an ally holding Interact for 2 s stabilizes a downed hero; Healing Word revives", () => {
    const sim = arena(["fighter", "cleric"], [{ id: "skeleton", x: 18, z: 3 }]);
    const w = sim.world;
    const [f, c] = sim.s.heroes;
    w.damage(f!, 999, "slashing", null);
    f!.down!.timer = 99999;
    c!.x = f!.x + 0.8; c!.z = f!.z;
    for (let i = 0; i < 125; i++) sim.step([undefined, { mx: 0, mz: 0, down: BTN.interact, pressed: i === 0 ? BTN.interact : 0, released: 0 }]);
    expect(f!.stable).toBe(true);
    expect(useAbility(w, c!, "healing_word", "bonus")).toBe(true);
    expect(f!.down).toBeNull();
    expect(f!.hp).toBeGreaterThan(0);
  });

  it("dodging i-frames avoid an area attack entirely; others save for half", () => {
    const sim = arena(["fighter", "rogue"], []);
    const w = sim.world;
    const [a, b] = sim.s.heroes;
    a!.iframes = 10;
    const hpA = a!.hp, hpB = b!.hp;
    w.areaDamage(a!.x, a!.z, 5, { count: 2, sides: 6, mod: 0 }, "fire", "dex", 30, null, { hitTeam: "party" });
    expect(a!.hp).toBe(hpA);
    expect(b!.hp).toBeLessThan(hpB);
  });

  it("the Round Clock refreshes Action, Bonus and Reaction after 6 s", () => {
    const sim = arena(["fighter"], [{ id: "skeleton", x: 18, z: 3 }]);
    const f = sim.s.heroes[0]!;
    f.clock = { ticks: 0, action: false, bonus: false, reaction: false };
    for (let i = 0; i < 359; i++) sim.step([]);
    expect(f.clock.action).toBe(false);
    sim.step([]);
    expect(f.clock).toMatchObject({ action: true, bonus: true, reaction: true });
  });

  it("reactions only work inside an enemy telegraph", () => {
    const sim = arena(["fighter"], [{ id: "skeleton", x: 7.4, z: 8 }]);
    const w = sim.world;
    const f = sim.s.heroes[0]!;
    expect(useAbility(w, f, "parry", "reaction")).toBe(false);
    const e = sim.s.enemies[0]!;
    e.ai.t = 0;
    e.ai.mode = "chase";
    for (let i = 0; i < 40 && !e.telegraph; i++) sim.step([]);
    expect(e.telegraph).not.toBeNull();
    expect(useAbility(w, f, "parry", "reaction")).toBe(true);
  });

  it("the Wight takes Legendary Actions that start an Initiative Break (max 3)", () => {
    const sim = arena(["fighter", "wizard", "rogue", "cleric"], [{ id: "wight", x: 12, z: 6 }]);
    const w = sim.world;
    const wight = sim.s.enemies[0]!;
    let breaks = 0;
    for (const frac of [0.7, 0.45, 0.2, 0.1]) {
      // Heroes may have finished it off during the previous break; bring it back for the test.
      if (!sim.s.enemies.includes(wight)) sim.s.enemies.push(wight);
      wight.state = "idle";
      wight.hp = Math.floor(wight.maxHp * frac);
      // A crit's hitstop can freeze the world for a few ticks.
      for (let k = 0; k < 10 && !sim.s.init; k++) sim.step([]);
      if (sim.s.init) {
        breaks++;
        // Everyone confirms a plan; the break resolves in initiative order.
        for (let i = 0; i < 2000 && sim.s.init; i++) sim.step([0, 1, 2, 3].map(() => ({ mx: 0, mz: 0, down: 0, pressed: BTN.attack, released: 0 })));
        expect(sim.s.init).toBeNull();
      }
    }
    expect(breaks).toBe(3);
    void w;
  });

  it("encounter budgets scale with party size", () => {
    const xp = (n: number): number => {
      const s = createRun({ seed: 9, persona: "storyteller", mode: n === 1 ? "lone" : "coop", heroes: PARTY.slice(0, n).map((cls, slot) => ({ slot, cls, ctrl: "ai" as const })) });
      const sim = new Sim(s);
      sim.step([], [{ c: "continue" }]);
      const first = s.run.map.nodes.find((x) => x.row === 1)!;
      sim.step([], [{ c: "chooseNode", node: first.id }]);
      return s.enemies.reduce((t, e) => t + e.xp, 0);
    };
    expect(xp(4)).toBeGreaterThan(xp(2));
    expect(xp(2)).toBeGreaterThanOrEqual(xp(1));
  });
});
