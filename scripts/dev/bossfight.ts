import { Sim } from "../../src/sim/sim";
import { createRun } from "../../src/sim/run";
import { botCommands } from "../../src/sim/bot";
const cls = process.argv[2] ?? "wizard", seed = Number(process.argv[3] ?? 2);
const sim = new Sim(createRun({ seed, persona: "storyteller", mode: "lone", heroes: [{ slot: 0, cls, ctrl: "ai" }] }));
let last = 0;
while (!sim.s.run.ended && sim.s.tick < 3600 * 60) {
  const ev = sim.step([], sim.s.tick % 30 === 0 ? botCommands(sim.s) : []);
  const boss = sim.s.enemies.find((e) => e.boss);
  const h = sim.s.heroes[0]!;
  if (boss && sim.s.tick - last >= 300) {
    last = sim.s.tick;
    console.log(((sim.s.tick - sim.s.room!.startTick) / 60).toFixed(0) + "s", "boss", boss.hp, "/", boss.maxHp, boss.ai.mode, "hero", h.hp, "/", h.maxHp, h.state, "d", Math.hypot(h.x - boss.x, h.z - boss.z).toFixed(1), "slots", h.slots, "pots", h.potions, "minions", sim.s.enemies.filter((e) => !e.boss && e.state !== "dead").length, h.down ? "DOWN" : "");
  }
  for (const e of ev) if (e.t === "deathsave") console.log("  deathsave", e.roll, e.successes, e.failures);
}
console.log("end", sim.s.run.phase);
