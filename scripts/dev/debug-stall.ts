import { runHeadless } from "../../src/sim/headless";
const r = runHeadless({ seed: 3, persona: "storyteller", mode: "coop", heroes: ["fighter", "wizard", "rogue", "cleric"].map((cls, slot) => ({ slot, cls, ctrl: "ai" as const })) }, { maxTicks: 60 * 60 * 10 });
const s = r.sim.s;
console.log(s.run.phase, s.room?.template, s.room?.kind, "cleared", s.room?.cleared, "init", !!s.init);
for (const e of s.enemies) console.log("E", e.type, e.state, e.ai.mode, e.hp, e.x.toFixed(1), e.z.toFixed(1), JSON.stringify(e.conds), e.tags);
for (const h of s.heroes) console.log("H", h.cls, h.state, h.hp, h.x.toFixed(1), h.z.toFixed(1), h.down ? "down" : "", h.fallen ? "fallen" : "", h.aiMem.hold);
console.log(s.room?.w, s.room?.h);
const rows = []; for (let z = 0; z < s.room!.h; z++) { let line = ""; for (let x = 0; x < s.room!.w; x++) line += ".#C~ "[s.room!.cells[z * s.room!.w + x]!]; rows.push(line); } console.log(rows.join("\n"));
