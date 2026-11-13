import { describe, expect, it } from "vitest";
import {
  Rng, seedState, ensureNonZero, hashSeed, parseDice, formatDice, addMod, rollDice, minDamage, maxDamage, averageDamage,
  combineMode, rollD20, rerollD20, abilityMod, proficiencyBonus, resolveAttack, rollCheck, saveDamage, saveDC,
  freshDeathSaves, applyDeathSave, damageWhileDowned, attackModeSources, speedMultiplier, canAct, saveModifiers,
  checkDisadvantages, tickConditions, has, freshClock, advanceClock, spend, clockFraction, ROUND_TICKS,
  rollInitiative, partyBudget, buildEncounter, crToXp, encounterXp, XP_BUDGET,
} from "./index";

/** An Rng whose d20/dice results are scripted (values are die faces). */
class ScriptRng extends Rng {
  constructor(private faces: number[]) {
    super(seedState(1));
  }
  override die(sides: number): number {
    const v = this.faces.shift();
    if (v === undefined) throw new Error("script exhausted");
    if (v < 1 || v > sides) throw new Error(`face ${v} not on d${sides}`);
    return v;
  }
}

describe("xoshiro128**", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = Rng.fromSeed(42), b = Rng.fromSeed(42), c = Rng.fromSeed(43);
    const sa = Array.from({ length: 8 }, () => a.nextU32());
    const sb = Array.from({ length: 8 }, () => b.nextU32());
    const sc = Array.from({ length: 8 }, () => c.nextU32());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });
  it("matches the reference xoshiro128** sequence for a known state", () => {
    // Reference values computed with the C implementation from prng.di.unimi.it for s = {1,2,3,4}.
    const r = new Rng([1, 2, 3, 4]);
    expect([r.nextU32(), r.nextU32(), r.nextU32()]).toEqual([11520, 0, 5927040]);
  });
  it("never seeds an all-zero state", () => {
    for (let s = 0; s < 50; s++) expect(seedState(s).some((v) => v !== 0)).toBe(true);
    expect(ensureNonZero([0, 0, 0, 0])).toEqual([1, 0, 0, 0]);
  });
  it("float is in [0,1), int is inclusive and roughly uniform", () => {
    const r = Rng.fromSeed(7);
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 6000; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      counts[r.die(6) - 1]++;
    }
    for (const c of counts) expect(c).toBeGreaterThan(850);
    expect(() => r.int(3, 2)).toThrow(RangeError);
  });
  it("pick, weighted, shuffle and fork", () => {
    const r = Rng.fromSeed(9);
    expect(["a"]).toContain(r.pick(["a"]));
    expect(() => r.pick([])).toThrow();
    expect(r.weighted(["x", "y"], (v) => (v === "y" ? 1 : 0))).toBe("y");
    expect(() => r.weighted(["x"], () => 0)).toThrow();
    const arr = [1, 2, 3, 4, 5];
    expect(r.shuffle([...arr]).sort()).toEqual(arr);
    const f1 = Rng.fromSeed(5).fork(), f2 = Rng.fromSeed(5).fork();
    expect(f1.nextU32()).toBe(f2.nextU32());
  });
  it("weighted falls back to the last item on float edge", () => {
    const r = new Rng(seedState(1));
    r.float = () => 0.99999999999;
    expect(r.weighted(["a", "b"], () => 1)).toBe("b");
    r.float = () => 1; // pathological: never goes below zero
    expect(r.weighted(["a", "b"], () => 1)).toBe("b");
  });
  it("int rejects biased values", () => {
    const r = new Rng(seedState(1));
    const seq = [4294967295, 5];
    r.nextU32 = () => seq.shift()!;
    expect(r.int(1, 3)).toBe(1 + (5 % 3));
  });
  it("hashSeed is stable", () => {
    expect(hashSeed("RUIN")).toBe(hashSeed("RUIN"));
    expect(hashSeed("RUIN")).not.toBe(hashSeed("RUIM"));
  });
});

describe("dice", () => {
  it("parses and formats", () => {
    expect(parseDice("2d6+3")).toEqual({ count: 2, sides: 6, mod: 3 });
    expect(parseDice("1d10")).toEqual({ count: 1, sides: 10, mod: 0 });
    expect(parseDice("3d8 - 1")).toEqual({ count: 3, sides: 8, mod: -1 });
    expect(parseDice("+4")).toEqual({ count: 0, sides: 0, mod: 4 });
    expect(parseDice("7")).toEqual({ count: 0, sides: 0, mod: 7 });
    expect(() => parseDice("banana")).toThrow(SyntaxError);
    expect(() => parseDice("2d0")).toThrow(SyntaxError);
    expect(formatDice({ count: 2, sides: 6, mod: 3 })).toBe("2d6+3");
    expect(formatDice({ count: 1, sides: 4, mod: -1 })).toBe("1d4-1");
    expect(formatDice({ count: 1, sides: 4, mod: 0 })).toBe("1d4");
    expect(formatDice({ count: 0, sides: 0, mod: 0 })).toBe("0");
    expect(formatDice({ count: 0, sides: 0, mod: 5 })).toBe("5");
    expect(addMod(parseDice("1d6"), 2)).toEqual({ count: 1, sides: 6, mod: 2 });
  });
  it("rolls, doubles dice on crit, adds extra dice, floors at zero", () => {
    expect(rollDice(new ScriptRng([3, 5]), parseDice("2d6+1"))).toEqual({ rolls: [3, 5], total: 9 });
    expect(rollDice(new ScriptRng([1, 2, 3, 4]), parseDice("2d6+1"), { crit: true }).total).toBe(11);
    expect(rollDice(new ScriptRng([2, 6, 6]), parseDice("1d8"), { extraDice: [parseDice("2d6")] }).total).toBe(14);
    expect(rollDice(new ScriptRng([1]), parseDice("1d4-5")).total).toBe(0);
  });
  it("min/max/average", () => {
    expect(minDamage(parseDice("2d6+3"))).toBe(5);
    expect(minDamage(parseDice("1d4-3"))).toBe(1);
    expect(minDamage(parseDice("1d6"), [parseDice("2d6")])).toBe(3);
    expect(maxDamage(parseDice("2d6+3"))).toBe(15);
    expect(maxDamage(parseDice("1d4-9"))).toBe(0);
    expect(averageDamage(parseDice("2d6+3"))).toBe(10);
    expect(averageDamage(parseDice("1d4-9"))).toBe(0);
  });
});

describe("d20, advantage, ability", () => {
  it("combines sources", () => {
    expect(combineMode(0, 0)).toBe("normal");
    expect(combineMode(2, 0)).toBe("advantage");
    expect(combineMode(0, 1)).toBe("disadvantage");
    expect(combineMode(3, 1)).toBe("normal");
  });
  it("keeps higher on advantage, lower on disadvantage", () => {
    expect(rollD20(new ScriptRng([4, 17]), "advantage")).toEqual({ rolls: [4, 17], natural: 17, mode: "advantage" });
    expect(rollD20(new ScriptRng([4, 17]), "disadvantage").natural).toBe(4);
    expect(rollD20(new ScriptRng([9])).natural).toBe(9);
    expect(rerollD20(new ScriptRng([12]), { rolls: [3], natural: 3, mode: "normal" }).natural).toBe(12);
  });
  it("ability modifiers and proficiency", () => {
    expect([1, 8, 9, 10, 11, 12, 16, 20].map(abilityMod)).toEqual([-5, -1, -1, 0, 0, 1, 3, 5]);
    expect([0, 1, 4, 5, 8, 9, 13, 17].map(proficiencyBonus)).toEqual([2, 2, 2, 3, 3, 4, 5, 6]);
  });
});

describe("attacks", () => {
  const base = { bonus: 5, ac: 15, damage: parseDice("1d8+3") };
  it("hits on total >= AC", () => {
    const r = resolveAttack(new ScriptRng([10, 6]), base);
    expect(r).toMatchObject({ outcome: "hit", hit: true, crit: false, total: 15, damage: 9, stagger: false });
  });
  it("natural 20 crits and doubles dice", () => {
    const r = resolveAttack(new ScriptRng([20, 8, 8]), { ...base, ac: 30 });
    expect(r).toMatchObject({ outcome: "crit", crit: true, damage: 19 });
  });
  it("crit range (Champion 19)", () => {
    expect(resolveAttack(new ScriptRng([19, 1, 1]), { ...base, critOn: 19 }).outcome).toBe("crit");
  });
  it("natural 1 misses and staggers", () => {
    const r = resolveAttack(new ScriptRng([1]), { ...base, ac: 2 });
    expect(r).toMatchObject({ outcome: "fumble", hit: false, damage: 0, stagger: true });
  });
  it("other misses graze for minimum damage", () => {
    expect(resolveAttack(new ScriptRng([5]), base)).toMatchObject({ outcome: "graze", damage: 4, hit: false });
    expect(resolveAttack(new ScriptRng([5]), { ...base, damage: parseDice("1d4-3") }).damage).toBe(1);
  });
  it("advantage / disadvantage", () => {
    expect(resolveAttack(new ScriptRng([2, 18, 3]), { ...base, advantages: 1 }).d20.natural).toBe(18);
    expect(resolveAttack(new ScriptRng([2, 18]), { ...base, disadvantages: 1 }).outcome).toBe("graze");
  });
  it("inspiration rerolls a miss only", () => {
    const r = resolveAttack(new ScriptRng([3, 15, 4]), { ...base, inspiration: true });
    expect(r.usedInspiration).toBe(true);
    expect(r.rerolled?.natural).toBe(3);
    expect(r.outcome).toBe("hit");
    const h = resolveAttack(new ScriptRng([15, 4]), { ...base, inspiration: true });
    expect(h.usedInspiration).toBe(false);
  });
  it("auto-crit on a hit, damage at least 1", () => {
    expect(resolveAttack(new ScriptRng([12, 1, 1]), { ...base, autoCrit: true }).crit).toBe(true);
    expect(resolveAttack(new ScriptRng([12, 1]), { ...base, damage: parseDice("1d4-5") }).damage).toBe(1);
    expect(resolveAttack(new ScriptRng([2]), { ...base, autoCrit: true }).crit).toBe(false);
  });
  it("sneak attack dice are doubled on crit", () => {
    const r = resolveAttack(new ScriptRng([20, 1, 1, 1, 1, 1, 1]), { ...base, extraDice: [parseDice("2d6")] });
    expect(r.damageRolls.length).toBe(6);
  });
});

describe("checks and saves", () => {
  it("meets-it-beats-it", () => {
    expect(rollCheck(new ScriptRng([10]), { mod: 2, dc: 12 }).success).toBe(true);
    expect(rollCheck(new ScriptRng([9]), { mod: 2, dc: 12 }).success).toBe(false);
  });
  it("auto-fail, help advantage, inspiration", () => {
    expect(rollCheck(new ScriptRng([20]), { mod: 5, dc: 5, autoFail: true }).success).toBe(false);
    expect(rollCheck(new ScriptRng([3, 15]), { mod: 0, dc: 12, advantages: 1 }).success).toBe(true);
    const r = rollCheck(new ScriptRng([3, 18]), { mod: 0, dc: 12, inspiration: true });
    expect(r.success).toBe(true);
    expect(r.rerolled?.natural).toBe(3);
    expect(rollCheck(new ScriptRng([15]), { mod: 0, dc: 12, inspiration: true }).rerolled).toBeUndefined();
    expect(rollCheck(new ScriptRng([3, 15]), { mod: 0, dc: 12, disadvantages: 1 }).success).toBe(false);
  });
  it("half damage on a save, DC formula", () => {
    expect(saveDamage(15, true)).toBe(7);
    expect(saveDamage(15, false)).toBe(15);
    expect(saveDC(2, 3)).toBe(13);
  });
});

describe("death saves", () => {
  it("three successes stabilise", () => {
    let s = freshDeathSaves();
    for (const n of [10, 15, 12]) s = applyDeathSave(s, n);
    expect(s).toMatchObject({ successes: 3, stable: true, dead: false });
    expect(applyDeathSave(s, 1)).toBe(s);
  });
  it("three failures kill; natural 1 counts double", () => {
    let s = applyDeathSave(freshDeathSaves(), 1);
    expect(s.failures).toBe(2);
    s = applyDeathSave(s, 9);
    expect(s).toMatchObject({ failures: 3, dead: true });
  });
  it("natural 20 revives", () => {
    expect(applyDeathSave(freshDeathSaves(), 20).revived).toBe(true);
  });
  it("lone hero gets an extra failure", () => {
    let s = freshDeathSaves();
    for (const n of [2, 3, 4]) s = applyDeathSave(s, n, 4);
    expect(s.dead).toBe(false);
    s = applyDeathSave(s, 5, 4);
    expect(s.dead).toBe(true);
  });
  it("caps failures at the limit on a natural 1", () => {
    let s = applyDeathSave(freshDeathSaves(), 2);
    s = applyDeathSave(s, 1);
    expect(s.failures).toBe(3);
  });
  it("damage while downed", () => {
    const s = damageWhileDowned({ ...freshDeathSaves(), stable: true }, false);
    expect(s).toMatchObject({ failures: 1, stable: false, dead: false });
    expect(damageWhileDowned(s, true).dead).toBe(true);
    const dead = { ...freshDeathSaves(), dead: true };
    expect(damageWhileDowned(dead, false)).toBe(dead);
  });
});

describe("conditions", () => {
  it("collects advantage sources", () => {
    const m = attackModeSources({ attacker: {}, target: { prone: 10 }, melee: true, attackerHidden: true, allyNearTarget: true, helped: true });
    expect(m.advantages).toEqual(["prone target", "hidden", "flanked", "help"]);
    expect(m.disadvantages).toEqual([]);
  });
  it("ranged vs prone and attacker conditions are disadvantage", () => {
    const m = attackModeSources({ attacker: { prone: 1, frightened: 1, poisoned: 1, restrained: 1, blinded: 1 }, target: { prone: 1 }, melee: false, targetHidden: true });
    expect(m.disadvantages).toEqual(["prone target", "attacker prone", "frightened", "poisoned", "restrained", "blinded", "target unseen"]);
  });
  it("target conditions grant advantage", () => {
    const m = attackModeSources({ attacker: {}, target: { restrained: 1, stunned: 1, blinded: 1 }, melee: true });
    expect(m.advantages).toEqual(["restrained target", "stunned target", "blinded target"]);
  });
  it("speed, acting, saves, checks", () => {
    expect(speedMultiplier({})).toBe(1);
    expect(speedMultiplier({ prone: 3 })).toBe(0.35);
    expect(speedMultiplier({ grappled: 3 })).toBe(0);
    expect(canAct({ stunned: 1 })).toBe(false);
    expect(canAct({ prone: 1 })).toBe(true);
    expect(saveModifiers({ stunned: 1 }, "dex")).toEqual({ autoFail: true, disadvantages: 0 });
    expect(saveModifiers({ restrained: 1 }, "dex")).toEqual({ autoFail: false, disadvantages: 1 });
    expect(saveModifiers({ stunned: 1 }, "wis").autoFail).toBe(false);
    expect(checkDisadvantages({ poisoned: 1, frightened: 2 })).toBe(2);
    expect(checkDisadvantages({})).toBe(0);
  });
  it("ticks down and expires", () => {
    const c = tickConditions({ prone: 2, stunned: 1 });
    expect(c).toEqual({ prone: 1 });
    expect(has(c, "stunned")).toBe(false);
    expect(tickConditions(c, 5)).toEqual({});
  });
});

describe("round clock", () => {
  it("refreshes everything when it fills", () => {
    let c = spend(spend(spend(freshClock(), "action")!, "bonus")!, "reaction")!;
    expect(spend(c, "action")).toBeNull();
    let r = advanceClock(c, ROUND_TICKS - 1);
    expect(r.filled).toBe(false);
    expect(r.clock.action).toBe(false);
    c = r.clock;
    r = advanceClock(c, 2);
    expect(r.filled).toBe(true);
    expect(r.clock).toEqual({ ticks: 1, action: true, bonus: true, reaction: true });
    expect(clockFraction({ ...freshClock(), ticks: ROUND_TICKS / 2 })).toBe(0.5);
    expect(advanceClock(freshClock()).clock.ticks).toBe(1);
  });
});

describe("initiative", () => {
  it("sorts by total, then dex, then heroes, then id", () => {
    const r = rollInitiative(new ScriptRng([10, 12, 10, 10, 11]), [
      { id: 1, dexMod: 2, hero: true }, { id: 2, dexMod: 0, hero: false }, { id: 3, dexMod: 2, hero: false },
      { id: 4, dexMod: 2, hero: true }, { id: 5, dexMod: 1, hero: false },
    ]);
    expect(r.map((e) => e.id)).toEqual([1, 4, 3, 5, 2]);
    expect(r[0]!.total).toBe(12);
  });
});

describe("encounter budgets", () => {
  it("covers levels 1-20 with SRD per-character budgets", () => {
    expect(Object.keys(XP_BUDGET).length).toBe(20);
    expect(partyBudget([1, 1, 1, 1], "moderate")).toBe(300);
    expect(partyBudget([3], "high")).toBe(400);
    expect(partyBudget([5, 5], "low", 0.5)).toBe(500);
    expect(partyBudget([0, 25], "low")).toBe(50 + 6400);
  });
  it("scales with party size", () => {
    expect(partyBudget([2, 2, 2, 2], "moderate")).toBe(4 * partyBudget([2], "moderate"));
  });
  it("converts CR", () => {
    expect(crToXp("1/4")).toBe(50);
    expect(crToXp("21")).toBe(33000);
    expect(() => crToXp("99")).toThrow(RangeError);
  });
  it("fills a budget and never returns an empty room", () => {
    const pool = [{ id: "skel", xp: 50 }, { id: "zomb", xp: 50, weight: 2 }, { id: "ghoul", xp: 200 }];
    const ids = buildEncounter(Rng.fromSeed(3), 300, pool);
    expect(encounterXp(ids, (id) => pool.find((p) => p.id === id)!.xp)).toBeLessThanOrEqual(300);
    expect(ids.length).toBeGreaterThan(0);
    expect(buildEncounter(Rng.fromSeed(3), 10, pool)).toEqual(["skel"]);
    expect(buildEncounter(Rng.fromSeed(3), 1000, pool, 2).length).toBe(2);
    expect(buildEncounter(Rng.fromSeed(3), 100, [])).toEqual([]);
  });
});
