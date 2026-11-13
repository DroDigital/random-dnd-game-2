import { botCommands } from "./bot";
import { createRun, type Command, type RunConfig } from "./run";
import { Sim } from "./sim";
import type { InputFrame, SimEvent } from "./types";

export interface HeadlessResult {
  victory: boolean;
  ticks: number;
  act: number;
  nodes: number;
  bosses: number;
  ttk: { boss: string; ticks: number }[];
  levels: number[];
  downs: number;
  sim: Sim;
}

/**
 * Run a whole game with no renderer, every hero AI-driven. Optional scripted inputs/commands
 * let tests drive human slots deterministically.
 */
export function runHeadless(cfg: RunConfig, opts: { maxTicks?: number; inputs?: (tick: number) => (InputFrame | undefined)[]; onEvents?: (ev: SimEvent[], tick: number) => void; extraCommands?: (tick: number) => Command[] } = {}): HeadlessResult {
  const sim = new Sim(createRun(cfg));
  const max = opts.maxTicks ?? 60 * 60 * 120;
  let stall = 0;
  while (!sim.s.run.ended && sim.s.tick < max) {
    // Bots decide every 30 ticks so menus have a human-ish rhythm (and runs stay cheap).
    const cmds = sim.s.tick % 30 === 0 ? botCommands(sim.s) : [];
    if (opts.extraCommands) cmds.push(...opts.extraCommands(sim.s.tick));
    const ev = sim.step(opts.inputs ? opts.inputs(sim.s.tick) : [], cmds);
    opts.onEvents?.(ev, sim.s.tick);
    stall = sim.s.run.phase === "room" && sim.s.room?.cleared ? stall + 1 : 0;
    if (stall > 60 * 60) break; // safety: should never happen
  }
  const s = sim.s;
  return {
    victory: !!s.run.ended?.victory, ticks: s.tick, act: s.run.act, nodes: s.run.nodesCleared, bosses: s.run.bossesBeaten,
    ttk: s.run.ttk, levels: s.heroes.map((h) => h.level), downs: s.heroes.reduce((t, h) => t + h.stats.downs, 0), sim,
  };
}
