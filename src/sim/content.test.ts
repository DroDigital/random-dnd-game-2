import { describe, expect, it } from "vitest";
import { CLASSES, ENEMIES, ITEMS, ACTS } from "../data";
import { createRun } from "./run";
import { Sim } from "./sim";
import { buildRoom } from "./room";
import { spawnEnemy } from "./enemyai";
import { useAbility } from "./abilities";
import { giveItem, recalc } from "./hero";
import { runHeadless } from "./headless";
import { BTN } from "./types";

function room(classes: string[], act = 0): Sim {
  const s = createRun({ seed: 4, persona: "storyteller", mode: "coop", heroes: classes.map((cls, slot) => ({ slot, cls, ctrl: "ai" as const })) });
  const sim = new Sim(s);
  s.room = buildRoom("hall", "encounter", sim.world.rng, ACTS.acts[act]!, 0);
  s.room.fight = true;
  s.run.phase = "room";
  s.heroes.forEach((h, i) => { h.x = 5 + i; h.z = 9; });
  return sim;
}

describe("content", () => {
  for (const cls of Object.keys(CLASSES)) {
    it(`${cls}: every ability works and both subclasses apply`, () => {
      const sim = room([cls, "fighter"]);
      const w = sim.world;
      const h = sim.s.heroes[0]!;
      spawnEnemy(w, "skeleton", h.x + 1.2, h.z);
      spawnEnemy(w, "zombie", h.x + 2, h.z + 1);
      const c = CLASSES[cls]!;
      for (const id of [c.action, c.actionHold, c.bonus, c.bonusHold].filter(Boolean) as string[]) {
        h.clock = { ticks: 0, action: true, bonus: true, reaction: true };
        h.hp = Math.max(1, h.maxHp - 5);
        expect(() => useAbility(w, h, id, "action")).not.toThrow();
        for (let i = 0; i < 40; i++) sim.step([]);
      }
      for (const sub of c.subclasses) {
        h.subclass = sub;
        recalc(h);
        expect(Object.keys(h.mods.sub).length).toBeGreaterThan(0);
      }
      // Basic attack through the input path.
      h.ctrl = "human";
      for (let i = 0; i < 30; i++) sim.step([{ mx: 0, mz: 0, down: BTN.attack, pressed: i % 10 === 0 ? BTN.attack : 0, released: 0 }]);
    });
  }

  for (const id of Object.keys(ENEMIES)) {
    it(`${id}: spawns, telegraphs and attacks`, () => {
      const sim = room(["fighter", "cleric"]);
      const e = spawnEnemy(sim.world, id, 9, 9);
      e.ai.t = 0;
      let telegraphed = false;
      for (let i = 0; i < 60 * 12 && !telegraphed; i++) {
        sim.step([]);
        telegraphed ||= !!e.telegraph || !!sim.s.init;
        for (const h of sim.s.heroes) { h.hp = h.maxHp; h.down = null; h.fallen = false; }
      }
      expect(telegraphed).toBe(true);
    });
  }

  it("every item can be equipped without breaking stats", () => {
    const sim = room(["fighter"]);
    const h = sim.s.heroes[0]!;
    for (const id of Object.keys(ITEMS.items)) {
      h.items = [];
      h.attuned = [];
      giveItem(h, id);
      expect(Number.isFinite(h.ac) && Number.isFinite(h.maxHp) && h.maxHp > 0).toBe(true);
    }
  });

  it("all four acts are reachable: a strong party wins a full run with every boss", () => {
    const r = runHeadless({ seed: 8, persona: "storyteller", mode: "coop", heroes: ["fighter", "wizard", "rogue", "cleric"].map((cls, slot) => ({ slot, cls, ctrl: "ai" as const })) });
    expect(r.ttk.map((t) => t.boss)).toEqual(ACTS.acts.map((a) => a.boss).slice(0, r.ttk.length));
    expect(r.act).toBeGreaterThanOrEqual(1);
  });

  it("unlockable classes can finish rooms in a full party", () => {
    // Across a few seeds, parties built from the unlockable classes clear rooms (not a difficulty check).
    const nodes = (classes: string[], persona: "storyteller" | "chaos"): number =>
      [3, 4, 5].reduce((t, seed) => t + runHeadless({ seed, persona, mode: "coop", heroes: classes.map((cls, slot) => ({ slot, cls, ctrl: "ai" as const })) }, { maxTicks: 60 * 60 * 10 }).nodes, 0);
    expect(nodes(["barbarian", "ranger", "bard", "paladin"], "storyteller")).toBeGreaterThan(3);
    expect(nodes(["warlock", "druid", "fighter", "cleric"], "chaos")).toBeGreaterThan(3);
  }, 60_000); // six whole headless runs: ~6 s on a CI runner
});
