import { describe, expect, it } from "vitest";
import { freshMeta, migrateMeta, parseRunSave, unlockedForRun, RUN_SAVE_VERSION } from "./saves";
import { runHeadless } from "../sim/headless";
import { Sim, hashState } from "../sim/sim";
import type { SimState } from "../sim/types";

describe("saves", () => {
  it("round-trips a mid-run save and resumes identically", () => {
    const r = runHeadless({ seed: 21, persona: "storyteller", mode: "coop", heroes: [{ slot: 0, cls: "fighter", ctrl: "ai" }, { slot: 1, cls: "cleric", ctrl: "ai" }] }, { maxTicks: 4000 });
    const json = JSON.stringify({ version: RUN_SAVE_VERSION, savedAt: "x", state: r.sim.s, devices: ["kbA"] });
    const save = parseRunSave(json)!;
    expect(save).not.toBeNull();
    expect(hashState(new Sim(save.state as SimState).s)).toBe(hashState(r.sim.s));
  });
  it("rejects corrupt or foreign saves", () => {
    expect(parseRunSave(null)).toBeNull();
    expect(parseRunSave("{nope")).toBeNull();
    expect(parseRunSave(JSON.stringify({ version: 99 }))).toBeNull();
  });
  it("migrates meta and resolves unlocks with capped permanent bonuses", () => {
    expect(migrateMeta("junk")).toEqual(freshMeta());
    const m = migrateMeta({ renown: 50.7, unlocked: ["class_barbarian", 3, "perm_hp", "perm_hp", "perm_hp"] });
    expect(m.renown).toBe(50);
    const u = unlockedForRun({ ...m, heirlooms: ["flame_tongue"] });
    expect(u.classes).toContain("barbarian");
    expect(u.items).toContain("flame_tongue");
    expect(u.perm.maxHp).toBe(4);
  });
});
