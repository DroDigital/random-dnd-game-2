import { createRun } from "../sim/run";
import { buildRoom } from "../sim/room";
import { spawnEnemy } from "../sim/enemyai";
import { Sim } from "../sim/sim";
import { ACTS } from "../data";

/** The one-room look test: four heroes and a skeleton patrol in a crypt hall. */
export function lookTestSim(seed = 7): Sim {
  const s = createRun({
    seed, persona: "storyteller", mode: "coop",
    heroes: [
      { slot: 0, cls: "fighter", ctrl: "ai" }, { slot: 1, cls: "wizard", ctrl: "ai" },
      { slot: 2, cls: "rogue", ctrl: "ai" }, { slot: 3, cls: "cleric", ctrl: "ai" },
    ],
  });
  const sim = new Sim(s);
  const w = sim.world;
  s.room = buildRoom("pillars", "encounter", w.rng, ACTS.acts[0]!, 0);
  s.room.fight = true;
  s.run.phase = "room";
  s.run.map.nodes[0]!.kind = "encounter";
  s.heroes.forEach((h, i) => {
    const sp = s.room!.heroSpawns[i % s.room!.heroSpawns.length]!;
    h.x = sp.x + (i >= 3 ? 1 : 0);
    h.z = sp.z - 1;
    h.facing = Math.PI;
  });
  const types = ["skeleton", "skeleton", "skeleton_archer", "skeleton_brute", "zombie", "skeleton"];
  s.room.enemySpawns.forEach((sp, i) => spawnEnemy(w, types[i % types.length]!, sp.x, sp.z));
  spawnEnemy(w, "skeleton", s.room.w / 2, s.room.h / 2 - 2);
  return sim;
}
