import { z } from "zod";
import { parseDice } from "../rules/dice";
import { CONDITIONS } from "../rules/conditions";
import { CR_XP } from "../rules/encounter";

const dice = z.string().refine((s) => {
  try {
    parseDice(s);
    return true;
  } catch {
    return false;
  }
}, "invalid dice expression");
const ability = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
const condition = z.enum(CONDITIONS);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const Scores = z.object({ str: z.number(), dex: z.number(), con: z.number(), int: z.number(), wis: z.number(), cha: z.number() });

export const BalanceSchema = z.object({
  tickRate: z.literal(60),
  feetToMetersPerSecond: z.number().positive(),
  hero: z.object({
    speed: z.number(), radius: z.number(),
    dodge: z.object({ ticks: z.number().int(), iframes: z.number().int(), speed: z.number(), cooldown: z.number().int() }),
    staggerTicks: z.number().int(), critFreezeTicks: z.number().int(), hitstunTicks: z.number().int(), deathSaveTicks: z.number().int(),
    stabilizeTicks: z.number().int(), stabilizeRange: z.number(), flankRange: z.number(), helpTicks: z.number().int(), helpRange: z.number(),
    shoveDistance: z.number(), proneTicks: z.number().int(), hideTicks: z.number().int(), dashTicks: z.number().int(), dashMultiplier: z.number(),
    invulnAfterReviveTicks: z.number().int(), combatSpeedMin: z.number(),
  }),
  enemy: z.object({
    radius: z.number(), repathTicks: z.number().int(), aggroRange: z.number(), leashRange: z.number(), separation: z.number(),
    hitstunTicks: z.number().int(), eliteHpMult: z.number(), eliteDamageBonus: z.number(), bossHpByPartySize: z.array(z.number()).length(4),
    solo: z.object({ hpMult: z.number() }),
  }),
  initiativeBreak: z.object({ planTicks: z.number().int(), moveTiles: z.number(), maxPerBoss: z.number().int(), resolveTicksPerTurn: z.number().int(), eliteBreaks: z.number().int() }),
  encounter: z.object({
    difficulty: z.record(z.string(), z.enum(["low", "moderate", "high"])), multiplier: z.number(), loneHeroMultiplier: z.number(),
    companionMultiplier: z.number(), maxEnemies: z.number().int(), killerTierMultiplier: z.number(),
  }),
  rest: z.object({ shortRestHitDiceFraction: z.number(), campfireUpgradeAmount: z.number(), longRestFull: z.boolean() }),
  loot: z.object({ goldPerEncounter: z.tuple([z.number(), z.number()]), goldPerElite: z.tuple([z.number(), z.number()]), eliteGuaranteedItem: z.boolean(), itemChance: z.number(), potionChance: z.number() }),
  renown: z.object({ perNode: z.number(), perBoss: z.number(), perAct: z.number(), victory: z.number(), minimum: z.number() }),
  leveling: z.object({ fightsPerMidLevel: z.number().int(), finaleLevel: z.number().int() }),
  camera: z.object({ minHeight: z.number(), maxHeight: z.number(), padding: z.number() }),
});

const AttackDef = z.object({
  kind: z.enum(["melee", "projectile"]), ability, damage: dice, type: z.string(), reach: z.number().optional(), arc: z.number().optional(),
  speed: z.number().optional(), range: z.number().optional(), windup: z.number().int(), recover: z.number().int(), vfx: z.string(), anim: z.string(),
  fire: z.boolean().optional(), push: z.number().optional(),
});

export const ClassSchema = z.object({
  name: z.string(), model: z.string(), hitDie: z.number().int(), armorAc: z.number().int(), dexCap: z.number().int(), scores: Scores,
  saves: z.array(ability), skills: z.array(z.string()), attack: AttackDef, action: z.string(), actionHold: z.string().optional(),
  bonus: z.string(), bonusHold: z.string().optional(), reaction: z.string(), passives: z.array(z.string()),
  subclasses: z.array(z.string()).length(2), unlock: z.number(), color: hex,
});

export const AbilitySchema = z.object({ name: z.string(), desc: z.string() }).catchall(z.unknown());
export const SubclassSchema = z.object({ class: z.string(), name: z.string(), desc: z.string(), srd: z.boolean().optional(), mods: z.record(z.string(), z.number()) });

const OnHit = z.object({ condition, save: ability, dc: z.number().int(), seconds: z.number() });
export const EnemyAttackSchema = z.object({
  name: z.string(), kind: z.enum(["melee", "ranged", "area", "line"]), toHit: z.number().optional(), damage: dice, type: z.string(),
  reach: z.number().optional(), range: z.number().optional(), radius: z.number().optional(), length: z.number().optional(), width: z.number().optional(),
  save: ability.optional(), dc: z.number().int().optional(), telegraph: z.number(), recover: z.number(), cooldown: z.number(),
  vfx: z.string(), anim: z.string(), projectileSpeed: z.number().optional(), onHit: OnHit.optional(),
  onFail: z.object({ condition, seconds: z.number() }).optional(), extra: dice.optional(), drain: z.boolean().optional(), targeted: z.boolean().optional(),
});
export const EnemySchema = z.object({
  name: z.string(), srd: z.string().optional(), cr: z.string().refine((c) => c in CR_XP, "unknown CR"), xpOverride: z.number().optional(),
  ac: z.number().int(), hp: z.number().int().positive(), speed: z.number(), scores: z.object({ str: z.number(), dex: z.number(), con: z.number(), wis: z.number() }),
  tags: z.array(z.string()), model: z.string(), ai: z.enum(["melee", "ranged", "caster", "swarm", "skirmisher", "ambusher", "boss"]),
  traits: z.array(z.string()).optional(), attacks: z.array(EnemyAttackSchema).min(1), boss: z.boolean().optional(), hpMult: z.number().optional(),
  radius: z.number().optional(), legendary: z.object({ thresholds: z.array(z.number()), actions: z.array(z.string()) }).optional(),
});

export const ItemSchema = z.object({ name: z.string(), rarity: z.enum(["common", "uncommon", "rare", "very_rare", "legendary"]), attune: z.boolean(), effects: z.record(z.string(), z.unknown()), desc: z.string() });
export const ItemsFileSchema = z.object({
  items: z.record(z.string(), ItemSchema),
  consumables: z.record(z.string(), z.object({ name: z.string(), heal: dice, rarity: z.string(), price: z.number() })),
  prices: z.record(z.string(), z.number()), attunementSlots: z.literal(3),
  rarityWeights: z.record(z.string(), z.record(z.string(), z.number())),
});

export const RoomsSchema = z.object({
  tileSize: z.number(), legend: z.record(z.string(), z.string()),
  templates: z.record(z.string(), z.object({ tags: z.array(z.string()), map: z.array(z.string()).min(3) })),
});

export const ActSchema = z.object({
  id: z.string(), name: z.string(), setting: z.string(), boss: z.string(), levels: z.tuple([z.number(), z.number()]), rows: z.number().int(), music: z.string(),
  pool: z.array(z.object({ id: z.string(), w: z.number() })), elites: z.array(z.string()), bossMinions: z.array(z.string()),
  floor: z.string(), floorAlt: z.string(), wall: z.string(), cover: z.array(z.string()), hazard: z.string(), decor: z.array(z.string()),
});
export const ActsSchema = z.object({ acts: z.array(ActSchema).length(4), nodeWeights: z.record(z.string(), z.number()), mimicChance: z.number(), columns: z.number().int() });

const Persona = z.object({
  name: z.string(), desc: z.string(), budgetMult: z.number(), mercyPerAct: z.number().int(), boredomMult: z.number(), trapChance: z.number(),
  lootBonus: z.number(), noGraze: z.boolean().optional(), friendlyFire: z.boolean(), wildMagic: z.boolean(), wildMagicChance: z.number().optional(), tiers: z.number().int().optional(),
  tierBudget: z.number().optional(), tierHp: z.number().optional(), tierDamage: z.number().optional(), unlock: z.number(),
});
export const DirectorSchema = z.object({
  boredom: z.object({ max: z.number(), perSecondIdle: z.number(), perSecondFarFromEnemies: z.number(), perSecondSlowFight: z.number(), slowFightSeconds: z.number(), decayOnHit: z.number(), twistCooldownSeconds: z.number() }),
  delight: z.object({ max: z.number(), nat20: z.number(), combo: z.number(), boldChoice: z.number(), kill: z.number(), decayPerSecond: z.number(), inspirationAt: z.number(), mysteryBonusAt: z.number() }),
  mercy: z.object({ hpFraction: z.number(), maxActIndex: z.number().int(), potion: z.string() }),
  twists: z.array(z.enum(["ambush", "rival_party", "collapsing_floor"])),
  personas: z.object({ storyteller: Persona, rules_lawyer: Persona, chaos: Persona, killer: Persona }),
  wildMagic: z.array(z.string()), lines: z.record(z.string(), z.array(z.string()).min(1)),
});

export const MetaSchema = z.object({
  unlocks: z.array(z.object({ id: z.string(), kind: z.enum(["class", "persona", "background", "item", "dice", "decor", "perm"]), ref: z.string(), name: z.string(), cost: z.number(), value: z.number().optional() })),
  backgrounds: z.record(z.string(), z.object({ name: z.string(), mods: z.record(z.string(), z.number()) })),
  dice: z.record(z.string(), z.object({ color: hex.nullable() })),
  permCap: z.record(z.string(), z.number()),
});

export const CardsSchema = z.object({ cards: z.array(z.object({ id: z.string(), name: z.string(), desc: z.string(), mods: z.record(z.string(), z.number()), grant: z.record(z.string(), z.number()).optional(), casterOnly: z.boolean().optional(), martialOnly: z.boolean().optional() })) });

const Outcome = z.object({ text: z.string(), gold: z.number().optional(), item: z.string().optional(), damage: dice.optional(), heal: dice.optional(), inspiration: z.number().optional(), condition: condition.optional(), boredom: z.number().optional(), delight: z.number().optional(), advantageNextFight: z.number().optional(), fight: z.boolean().optional() });
export const SkillScenesSchema = z.object({
  skills: z.record(z.string(), ability),
  scenes: z.array(z.object({ id: z.string(), text: z.string(), acts: z.array(z.string()), options: z.array(z.object({ label: z.string(), skill: z.string(), dc: z.number().int(), success: Outcome, fail: Outcome })).min(1) })),
});

export const LegendarySchema = z.record(z.string(), z.object({
  name: z.string(),
  summon: z.object({ id: z.string(), count: z.number().int() }).optional(),
  aoe: z.object({ radius: z.number(), damage: dice, type: z.string(), save: ability, dc: z.number().int(), condition: condition.optional(), seconds: z.number().optional(), push: z.number().optional(), healSelf: z.boolean().optional() }).optional(),
  dash: z.object({ distance: z.number(), damage: dice, type: z.string(), save: ability, dc: z.number().int(), condition: condition.optional() }).optional(),
  buff: z.object({ attackSpeed: z.number(), seconds: z.number() }).optional(),
  zone: z.object({ kind: z.string(), radius: z.number(), seconds: z.number(), damage: dice }).optional(),
}));

export const VfxSchema = z.record(z.string(), z.object({ src: z.string(), light: hex.optional(), intensity: z.number().optional(), range: z.number().optional(), size: z.number(), palette: z.array(z.string()).optional() }));
