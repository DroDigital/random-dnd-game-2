import { lookTestSim } from "../../src/game/looktest";
const sim = lookTestSim();
for (let i = 0; i < 90; i++) sim.step([], []);
const s = sim.s, r = s.room!;
console.log("room", r.w, r.h, "exit", r.exit, "spawns", JSON.stringify(r.heroSpawns));
for (const h of s.heroes) console.log(h.cls, h.slot, h.x.toFixed(1), h.z.toFixed(1));
const rows: string[] = []; for (let z = 0; z < r.h; z++) { let line = ""; for (let x = 0; x < r.w; x++) { const hh = s.heroes.find((h) => Math.floor(h.x) === x && Math.floor(h.z) === z); line += hh ? String(hh.slot + 1) : ".#C~ "[r.cells[z * r.w + x]!]; } rows.push(line); } console.log(rows.join("\n"));
