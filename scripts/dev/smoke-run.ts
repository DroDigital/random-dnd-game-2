import { runHeadless } from "../../src/sim/headless";
const n = Number(process.argv[2] ?? 4);
const classes = ["fighter", "wizard", "rogue", "cleric"];
for (let seed = 1; seed <= Number(process.argv[3] ?? 3); seed++) {
  const t0 = Date.now();
  const phases = new Map<string, number>();
  const r = runHeadless({ seed, persona: "storyteller", mode: n === 1 ? "lone" : "coop", heroes: classes.slice(0, n).map((cls, slot) => ({ slot, cls, ctrl: "ai" as const })) }, {
    onEvents: (ev) => { for (const e of ev) if (e.t === "narrate") phases.set(e.key, (phases.get(e.key) ?? 0) + 1); },
  });
  console.log(`seed ${seed}: victory=${r.victory} act=${r.act} nodes=${r.nodes} bosses=${r.bosses} minutes=${(r.ticks / 3600).toFixed(1)} levels=${r.levels} downs=${r.downs} phase=${r.sim.s.run.phase} ttk=${JSON.stringify(r.ttk)} wall=${Date.now() - t0}ms`);
  console.log("  ", [...phases].map(([k, v]) => `${k}:${v}`).join(" "));
}
