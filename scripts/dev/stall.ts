import { runHeadless } from "../../src/sim/headless";
const [seed, size] = process.argv.slice(2).map(Number);
const BASE = ["fighter", "wizard", "rogue", "cleric"];
const party = Array.from({ length: size! }, (_, i) => BASE[(seed! + i) % 4]!);
const r = runHeadless({ seed: seed!, persona: "storyteller", mode: size === 1 ? "lone" : "coop", heroes: party.map((cls, slot) => ({ slot, cls, ctrl: "ai" as const })) }, { maxTicks: 3600 * 90 });
const s = r.sim.s;
console.log("phase", s.run.phase, "room", s.room?.template, s.room?.kind, "cleared", s.room?.cleared, "init", !!s.init, "loot", s.run.loot.length, "scene", JSON.stringify(s.run.scene));
for (const e of s.enemies) console.log("E", e.type, e.state, e.ai.mode, e.hp, e.x.toFixed(1), e.z.toFixed(1), JSON.stringify(e.conds), e.ai.targetId, e.telegraph ? "tele" : "");
for (const h of s.heroes) console.log("H", h.cls, h.state, h.hp, h.x.toFixed(1), h.z.toFixed(1), h.down ? `down ${JSON.stringify(h.down.saves)}` : "", h.stable, h.fallen, JSON.stringify(h.buffs));
