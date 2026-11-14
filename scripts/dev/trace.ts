import { Sim } from "../../src/sim/sim";
import { createRun } from "../../src/sim/run";
import { botCommands } from "../../src/sim/bot";
const seed = 1036;
const sim = new Sim(createRun({ seed, persona: "storyteller", mode: "lone", heroes: [{ slot: 0, cls: "fighter", ctrl: "ai" }] }));
let roomStart = -1;
while (!sim.s.run.ended && sim.s.tick < 3600 * 90) {
  sim.step([], sim.s.tick % 30 === 0 ? botCommands(sim.s) : []);
  const r = sim.s.room;
  if (r?.fight && !r.cleared) { if (roomStart < 0) roomStart = sim.s.tick; } else roomStart = -1;
  if (roomStart >= 0 && sim.s.tick - roomStart > 3600 * 3 && (sim.s.tick - roomStart) % 120 === 0) {
    const h = sim.s.heroes[0]!;
    console.log(sim.s.tick, "H", h.x.toFixed(2), h.z.toFixed(2), h.vx.toFixed(2), h.vz.toFixed(2), h.state, "E", sim.s.enemies.filter(e=>e.state!=="dead").map((e) => `${e.type}@${e.x.toFixed(1)},${e.z.toFixed(1)} ${e.ai.mode} v${Math.hypot(e.vx,e.vz).toFixed(1)} path${e.ai.path.length}`).join(" | "));
    if (sim.s.tick - roomStart > 3600 * 3 + 600) break;
  }
}
const r = sim.s.room!;
const rows: string[] = []; for (let z = 0; z < r.h; z++) { let line = ""; for (let x = 0; x < r.w; x++) line += ".#C~ "[r.cells[z * r.w + x]!]; rows.push(line); } console.log(rows.join("\n"));
