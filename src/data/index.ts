// Loads and validates every balance/content file once. Throws with a readable message on bad data.
import { z } from "zod";
import balanceJson from "./balance.json";
import classesJson from "./classes.json";
import abilitiesJson from "./abilities.json";
import subclassesJson from "./subclasses.json";
import enemiesJson from "./enemies.json";
import itemsJson from "./items.json";
import roomsJson from "./rooms.json";
import actsJson from "./acts.json";
import directorJson from "./director.json";
import metaJson from "./meta.json";
import cardsJson from "./cards.json";
import scenesJson from "./skillscenes.json";
import legendaryJson from "./legendary.json";
import vfxJson from "./vfx.json";
import modelsJson from "./models.json";
import {
  AbilitySchema, ActsSchema, BalanceSchema, CardsSchema, ClassSchema, DirectorSchema, EnemySchema, ItemsFileSchema, LegendarySchema,
  MetaSchema, RoomsSchema, SkillScenesSchema, SubclassSchema, VfxSchema,
} from "./schema";

function parse<T>(name: string, schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new Error(`data/${name} is invalid:\n${r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  return r.data;
}

export const BALANCE = parse("balance.json", BalanceSchema, balanceJson);
export const CLASSES = parse("classes.json", z.record(z.string(), ClassSchema), classesJson);
export const ABILITIES = parse("abilities.json", z.record(z.string(), AbilitySchema), abilitiesJson);
export const SUBCLASSES = parse("subclasses.json", z.record(z.string(), SubclassSchema), subclassesJson);
export const ENEMIES = parse("enemies.json", z.record(z.string(), EnemySchema), enemiesJson);
export const ITEMS = parse("items.json", ItemsFileSchema, itemsJson);
export const ROOMS = parse("rooms.json", RoomsSchema, roomsJson);
export const ACTS = parse("acts.json", ActsSchema, actsJson);
export const DIRECTOR = parse("director.json", DirectorSchema, directorJson);
export const META = parse("meta.json", MetaSchema, metaJson);
export const CARDS = parse("cards.json", CardsSchema, cardsJson);
export const SCENES = parse("skillscenes.json", SkillScenesSchema, scenesJson);
export const LEGENDARY = parse("legendary.json", LegendarySchema, legendaryJson);
export const VFX = parse("vfx.json", VfxSchema, vfxJson);
export const MODELS = modelsJson;

export type ClassId = keyof typeof classesJson;
export type ClassDef = z.infer<typeof ClassSchema>;
export type EnemyDef = z.infer<typeof EnemySchema>;
export type EnemyAttack = EnemyDef["attacks"][number];
export type ActDef = z.infer<typeof ActsSchema>["acts"][number];
export type PersonaId = keyof z.infer<typeof DirectorSchema>["personas"];

/** Typed ability parameter lookup with a default. */
export function abilityParam<T>(id: string, key: string, fallback: T): T {
  const a = ABILITIES[id] as Record<string, unknown> | undefined;
  const v = a?.[key];
  return v === undefined ? fallback : (v as T);
}

/** Cross-file integrity checks that a schema can't express. Returns a list of problems. */
export function validateCrossRefs(): string[] {
  const problems: string[] = [];
  const models = modelsJson.models as Record<string, unknown>;
  for (const [id, c] of Object.entries(CLASSES)) {
    for (const a of [c.action, c.actionHold, c.bonus, c.bonusHold, c.reaction, ...c.passives]) if (a && !ABILITIES[a]) problems.push(`class ${id}: unknown ability ${a}`);
    for (const s of c.subclasses) if (SUBCLASSES[s]?.class !== id) problems.push(`class ${id}: subclass ${s} missing or wrong class`);
    if (!models[c.model]) problems.push(`class ${id}: unknown model ${c.model}`);
    if (!VFX[c.attack.vfx]) problems.push(`class ${id}: unknown vfx ${c.attack.vfx}`);
  }
  for (const [id, e] of Object.entries(ENEMIES)) {
    if (!models[e.model]) problems.push(`enemy ${id}: unknown model ${e.model}`);
    for (const a of e.attacks) if (!VFX[a.vfx]) problems.push(`enemy ${id}: unknown vfx ${a.vfx}`);
    for (const l of e.legendary?.actions ?? []) if (!LEGENDARY[l]) problems.push(`enemy ${id}: unknown legendary ${l}`);
  }
  for (const act of ACTS.acts) {
    if (!ENEMIES[act.boss]) problems.push(`act ${act.id}: unknown boss ${act.boss}`);
    for (const p of [...act.pool.map((x) => x.id), ...act.elites, ...act.bossMinions]) if (!ENEMIES[p]) problems.push(`act ${act.id}: unknown enemy ${p}`);
  }
  for (const [id, l] of Object.entries(LEGENDARY)) if (l.summon && !ENEMIES[l.summon.id]) problems.push(`legendary ${id}: unknown summon ${l.summon.id}`);
  for (const sc of SCENES.scenes) for (const o of sc.options) if (!SCENES.skills[o.skill]) problems.push(`scene ${sc.id}: unknown skill ${o.skill}`);
  for (const u of META.unlocks) {
    if (u.kind === "class" && !CLASSES[u.ref]) problems.push(`unlock ${u.id}: unknown class`);
    if (u.kind === "item" && !ITEMS.items[u.ref]) problems.push(`unlock ${u.id}: unknown item`);
    if (u.kind === "persona" && !(u.ref in DIRECTOR.personas)) problems.push(`unlock ${u.id}: unknown persona`);
  }
  for (const [id, t] of Object.entries(ROOMS.templates)) {
    const w = t.map[0]!.length;
    if (t.map.some((r) => r.length !== w)) problems.push(`room ${id}: ragged rows`);
    if (t.tags.includes("combat") && !t.map.join("").includes("E")) problems.push(`room ${id}: no enemy spawns`);
    if (!t.map.join("").includes("S")) problems.push(`room ${id}: no hero spawns`);
  }
  return problems;
}
