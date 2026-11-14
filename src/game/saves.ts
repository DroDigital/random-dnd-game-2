import { z } from "zod";
import { META } from "../data";
import type { SimState } from "../sim/types";

export const META_VERSION = 1;
export const RUN_SAVE_VERSION = 1;

export const PlaqueSchema = z.object({
  name: z.string(), cls: z.string(), level: z.number(), act: z.number(), cause: z.string(), date: z.string(),
  bestItem: z.string().nullable(), kills: z.number(),
});
export type Plaque = z.infer<typeof PlaqueSchema>;

export const MetaSchema = z.object({
  version: z.literal(META_VERSION),
  renown: z.number().int().min(0),
  totalRenown: z.number().int().min(0),
  unlocked: z.array(z.string()),
  hall: z.array(PlaqueSchema),
  heirlooms: z.array(z.string()),
  stats: z.object({ runs: z.number(), wins: z.number(), bestAct: z.number(), killerTier: z.number() }),
  diceSkin: z.string(),
  lastPersona: z.string(),
});
export type MetaSave = z.infer<typeof MetaSchema>;

export function freshMeta(): MetaSave {
  return { version: META_VERSION, renown: 0, totalRenown: 0, unlocked: [], hall: [], heirlooms: [], stats: { runs: 0, wins: 0, bestAct: 0, killerTier: 0 }, diceSkin: "default", lastPersona: "storyteller" };
}

export function migrateMeta(raw: unknown): MetaSave {
  const r = MetaSchema.safeParse(raw);
  if (r.success) return r.data;
  const base = freshMeta();
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.renown === "number") base.renown = Math.max(0, Math.floor(o.renown));
    if (Array.isArray(o.unlocked)) base.unlocked = o.unlocked.filter((x): x is string => typeof x === "string");
  }
  return base;
}

/** Unlocked content for a run, resolved from the meta save. Permanent bonuses are capped small. */
export function unlockedForRun(m: MetaSave): SimState["run"]["unlocked"] {
  const classes = ["fighter", "wizard", "rogue", "cleric"];
  const items: string[] = [...m.heirlooms];
  const backgrounds = ["none"];
  const perm: Record<string, number> = {};
  for (const id of m.unlocked) {
    const u = META.unlocks.find((x) => x.id === id);
    if (!u) continue;
    if (u.kind === "class") classes.push(u.ref);
    if (u.kind === "item") items.push(u.ref);
    if (u.kind === "background") backgrounds.push(u.ref);
    if (u.kind === "perm") perm[u.ref] = Math.min(META.permCap[u.ref] ?? 0, (perm[u.ref] ?? 0) + (u.value ?? 0));
  }
  return { classes, items, backgrounds, perm };
}

export function personaUnlocked(m: MetaSave, persona: string): boolean {
  if (persona === "storyteller") return true;
  return m.unlocked.includes(`persona_${persona}`);
}

export interface RunSave {
  version: number;
  savedAt: string;
  state: SimState;
  devices: string[];
}

const RunSaveSchema = z.object({ version: z.literal(RUN_SAVE_VERSION), savedAt: z.string(), state: z.object({ version: z.literal(1), tick: z.number(), run: z.object({ phase: z.string() }).passthrough() }).passthrough(), devices: z.array(z.string()) });

export function parseRunSave(json: string | null): RunSave | null {
  if (!json) return null;
  try {
    const r = RunSaveSchema.safeParse(JSON.parse(json));
    return r.success ? (r.data as unknown as RunSave) : null;
  } catch {
    return null;
  }
}

/** Storage: the Electron preload API, or localStorage when running in a plain browser. */
export const storage = {
  async read(slot: string): Promise<string | null> {
    if (window.rfr) return window.rfr.readSave(slot);
    try { return localStorage.getItem(`rfr:${slot}`); } catch { return null; }
  },
  async write(slot: string, json: string): Promise<boolean> {
    if (window.rfr) return window.rfr.writeSave(slot, json);
    try { localStorage.setItem(`rfr:${slot}`, json); return true; } catch { return false; }
  },
  async remove(slot: string): Promise<void> {
    if (window.rfr) await window.rfr.deleteSave(slot);
    else try { localStorage.removeItem(`rfr:${slot}`); } catch { /* ignore */ }
  },
};
