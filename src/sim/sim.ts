import { stepRoom, updateInitiative } from "./combat";
import { companionInput, companionPlan } from "./companion";
import { updateDirector } from "./director";
import { applyCommand, updateRun, type Command } from "./run";
import { World } from "./world";
import { BTN, type InputFrame, type SimEvent, type SimState } from "./types";

export const SIM_HZ = 60;

/**
 * The deterministic simulation. `step` advances exactly one 1/60 s tick from the current state,
 * the per-player input frames and any menu commands. Same seed + same inputs → same run.
 */
export class Sim {
  private w: World;
  constructor(public s: SimState) {
    this.w = new World(s);
  }

  get world(): World {
    return this.w;
  }

  step(inputs: (InputFrame | undefined)[], commands: Command[] = []): SimEvent[] {
    const w = this.w;
    w.events = [];
    const s = this.s;
    for (const c of commands) applyCommand(w, c);
    const run = s.run;
    if (!run.ended && s.room && (run.phase === "room" || run.phase === "loot")) {
      // Companion orders from player 1's D-pad in party mode.
      const p1 = inputs[0];
      if (run.mode === "party" && p1 && run.phase === "room") {
        if (p1.pressed & BTN.up) applyCommand(w, { c: "order", order: "follow" });
        if (p1.pressed & BTN.right) applyCommand(w, { c: "order", order: "focus" });
        if (p1.pressed & BTN.down) applyCommand(w, { c: "order", order: "hold" });
        if (p1.pressed & BTN.left) applyCommand(w, { c: "order", order: "defensive" });
      }
      if (s.init) {
        const plans = new Map<number, ReturnType<typeof companionPlan>>();
        // In party mode the player plans for everyone during an Initiative Break: companions'
        // plans are drafted by the AI and the player's own frame steers the hero whose turn it is.
        for (const h of s.heroes) if (h.ctrl === "ai" && run.mode !== "party") plans.set(h.id, companionPlan(w, h));
        if (run.mode === "party") partyPlanning(this, inputs, plans);
        updateInitiative(w, inputs, plans);
      } else {
        const ai = new Map<number, InputFrame>();
        for (const h of s.heroes) if (h.ctrl === "ai") ai.set(h.id, companionInput(w, h));
        stepRoom(w, inputs, ai);
        updateDirector(w);
        // Leaving a cleared room: anyone presses Interact at the exit, or every hero stands on it.
        if (s.room.cleared && run.phase === "room") {
          const near = s.heroes.filter((h) => !h.fallen && Math.hypot(h.x - s.room!.exit.x, h.z - s.room!.exit.z) < 2.4);
          const pressed = near.some((h) => h.ctrl === "human" && ((inputs[h.slot]?.released ?? 0) & BTN.interact));
          const allThere = near.length === s.heroes.filter((h) => !h.fallen).length;
          if (pressed || (allThere && s.heroes.every((h) => h.ctrl === "ai"))) applyCommand(w, { c: "continue" });
        }
      }
    }
    updateRun(w);
    s.tick++;
    return w.events;
  }
}

/** Solo party mode: the human's frame cycles through companions, each gets confirmed in turn. */
function partyPlanning(sim: Sim, inputs: (InputFrame | undefined)[], plans: Map<number, { x: number; z: number; action: "attack" | "ability" | "dodge" | "help" }>): void {
  const s = sim.s;
  const init = s.init!;
  if (init.phase !== "plan") return;
  const human = s.heroes.find((h) => h.ctrl === "human");
  if (!human) return;
  const humanPlan = init.plans[human.id];
  if (!humanPlan?.ready) return; // plan your own hero first
  const next = s.heroes.find((h) => h.ctrl === "ai" && init.plans[h.id] && !init.plans[h.id]!.ready);
  if (!next) return;
  const plan = init.plans[next.id]!;
  const inp = inputs[human.slot];
  if (!inp) return;
  plan.x += inp.mx * 0.1;
  plan.z += inp.mz * 0.1;
  const dx = plan.x - next.x, dz = plan.z - next.z, d = Math.hypot(dx, dz);
  if (d > 6) { plan.x = next.x + (dx / d) * 6; plan.z = next.z + (dz / d) * 6; }
  const pick = (bit: number, a: "attack" | "ability" | "dodge" | "help"): void => {
    if (inp.pressed & bit) { plan.action = a; plan.ready = true; }
  };
  pick(BTN.attack, "attack");
  pick(BTN.action, "ability");
  pick(BTN.dodge, "dodge");
  pick(BTN.help, "help");
  if (init.planT <= 1) plans.set(next.id, { x: plan.x, z: plan.z, action: plan.action === "none" ? "attack" : plan.action });
  // Swallow the human frame so the human's own plan doesn't move.
  inputs[human.slot] = { mx: 0, mz: 0, down: 0, pressed: 0, released: 0 };
}

/** Stable 32-bit hash of the deterministic state (FNV-1a over canonical JSON). */
export function hashState(s: SimState): string {
  const json = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
