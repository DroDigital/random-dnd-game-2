import { ACTS, BALANCE, CARDS, CLASSES, DIRECTOR, ENEMIES, ITEMS, SCENES, abilityParam } from "../data";
import { buildEncounter, partyBudget, crToXp, type Difficulty } from "../rules/encounter";
import { parseDice, rollDice } from "../rules/dice";
import { rollCheck } from "../rules/checks";
import { buildRoom, templateFor } from "./room";
import { generateActMap, nodeById, revealFrom } from "./hexmap";
import { spawnEnemy } from "./enemyai";
import { giveItem, hitDiceMax, levelTo, longRest, makeHero, maxSlots, recalc, skillBonus, INJURIES } from "./hero";
import { sec, type World } from "./world";
import type { Ability, Hero, LootVote, NodeKind, SimState } from "./types";
import { Rng, seedState } from "../rules/rng";

export type Command =
  | { c: "continue" }
  | { c: "chooseNode"; node: number }
  | { c: "join"; slot: number; cls: string; ctrl: "human" | "ai"; background?: string }
  | { c: "card"; hero: number; card: string }
  | { c: "subclass"; hero: number; sub: string }
  | { c: "campfire"; hero: number; choice: "rest" | "upgrade"; ability?: Ability }
  | { c: "buy"; hero: number; item: string }
  | { c: "leave" }
  | { c: "skill"; option: number; hero: number; helper: number | null }
  | { c: "vote"; hero: number; vote: "need" | "greed" | "pass" }
  | { c: "order"; order: Hero["order"] }
  | { c: "attune"; hero: number; item: string };

export interface RunConfig {
  seed: number;
  persona: SimState["run"]["persona"];
  killerTier?: number;
  mode: SimState["run"]["mode"];
  heroes: { slot: number; cls: string; ctrl: "human" | "ai"; background?: string }[];
  unlocked?: SimState["run"]["unlocked"];
  startGold?: number;
}

export function createRun(cfg: RunConfig): SimState {
  const s: SimState = {
    version: 1, tick: 0, rng: seedState(cfg.seed), nextId: 1,
    run: {
      seed: cfg.seed, persona: cfg.persona, killerTier: cfg.killerTier ?? 0, mode: cfg.mode, act: 0, map: { act: 0, nodes: [], current: 0 },
      phase: "actIntro", gold: 20 + (cfg.startGold ?? 0), fights: 0, levelsPending: [], pendingCards: {}, pendingSubclass: {}, campfireDone: {}, merchantStock: [],
      scene: null, loot: [], renown: 0, bossesBeaten: 0, nodesCleared: 0, startTick: 0, ended: null, ttk: [],
      unlocked: cfg.unlocked ?? { classes: [], items: [], backgrounds: [], perm: {} },
    },
    room: null, heroes: [], enemies: [], summons: [], projectiles: [], zones: [], pickups: [], init: null,
    director: { boredom: 0, delight: 0, mercyUsed: 0, twistCooldown: 0, lastTwist: "", advantageNextFight: false, idleTicks: 0 },
    hitstop: 0,
  };
  const w = new WorldLite(s);
  for (const h of cfg.heroes) s.heroes.push(makeHero(s.nextId++, h.slot, h.cls, { ctrl: h.ctrl, background: h.background, perm: s.run.unlocked.perm }));
  s.run.map = generateActMap(w.rng, 0);
  return s;
}

/** Minimal rng holder for setup code. */
class WorldLite {
  rng: Rng;
  constructor(s: SimState) {
    this.rng = new Rng(s.rng);
  }
}

const perm = (w: World): Record<string, number> => w.s.run.unlocked.perm;

// ------------------------------------------------------------------------------------------------
// Nodes and rooms
// ------------------------------------------------------------------------------------------------
function placeHeroes(w: World): void {
  const room = w.s.room!;
  w.s.heroes.forEach((h, i) => {
    const sp = room.heroSpawns[i % room.heroSpawns.length] ?? { x: room.w / 2, z: room.h - 2 };
    h.x = sp.x + (i >= room.heroSpawns.length ? 0.6 : 0);
    h.z = sp.z;
    h.vx = h.vz = 0;
    h.facing = Math.PI;
    h.state = h.down ? "downed" : h.fallen ? "dead" : "idle";
    h.anim = h.fallen ? "dead" : h.down ? "downed" : "idle";
    h.strike = null;
    h.buffs = {};
    h.aiMem.holdX = h.x;
    h.aiMem.holdZ = h.z;
  });
}

function budgetFor(w: World, kind: "encounter" | "elite" | "boss" | "ambush"): number {
  const run = w.s.run;
  const levels = w.s.heroes.filter((h) => !h.fallen).map((h) => h.level);
  const diff = BALANCE.encounter.difficulty[kind] as Difficulty;
  let mult = BALANCE.encounter.multiplier * w.persona.budgetMult;
  if (run.mode === "lone") mult *= BALANCE.encounter.loneHeroMultiplier;
  if (run.mode === "party") mult *= BALANCE.encounter.companionMultiplier;
  if (run.persona === "killer") mult *= 1 + (w.persona.tierBudget ?? 0.12) * run.killerTier;
  return partyBudget(levels, diff, mult);
}

function spawnEncounter(w: World, kind: "encounter" | "elite" | "boss", extraIds: string[] = []): void {
  const run = w.s.run, room = w.s.room!;
  const act = ACTS.acts[run.act]!;
  const xpOf = (id: string): number => ENEMIES[id]!.xpOverride ?? crToXp(ENEMIES[id]!.cr);
  let ids: string[];
  let eliteId: string | null = null;
  if (kind === "boss") {
    const boss = act.boss;
    const sp = room.bossSpawns[0] ?? room.enemySpawns[0]!;
    spawnEnemy(w, boss, sp.x, sp.z);
    w.narrate("boss");
    const minions = act.bossMinions.map((id) => ({ id, xp: xpOf(id) }));
    ids = buildEncounter(w.rng, budgetFor(w, "boss"), minions, 4);
  } else {
    let budget = budgetFor(w, kind);
    if (kind === "elite") {
      eliteId = w.rng.pick(act.elites);
      budget -= xpOf(eliteId) * 1.5;
    }
    const pool = act.pool.map((p) => ({ id: p.id, xp: xpOf(p.id), weight: p.w }));
    ids = budget > 0 ? buildEncounter(w.rng, budget, pool, BALANCE.encounter.maxEnemies - (eliteId ? 1 : 0)) : [];
  }
  ids.push(...extraIds);
  const spawns = room.enemySpawns.length ? room.enemySpawns : room.bossSpawns;
  if (eliteId) {
    const sp = spawns[0]!;
    spawnEnemy(w, eliteId, sp.x, sp.z, { elite: true });
  }
  ids.forEach((id, i) => {
    const sp = spawns[(i + (eliteId ? 1 : 0)) % spawns.length]!;
    const ring = Math.floor(i / spawns.length);
    const ang = i * 2.1;
    spawnEnemy(w, id, sp.x + Math.sin(ang) * ring * 0.8, sp.z + Math.cos(ang) * ring * 0.8);
  });
}

export function enterNode(w: World, nodeId: number): void {
  const s = w.s, run = s.run;
  const node = nodeById(run.map, nodeId);
  run.map.current = nodeId;
  // Bold choices delight the DM: picking a fight with an Elite, or walking into the unknown.
  if (node.kind === "elite" || node.kind === "mystery") s.director.delight = Math.min(DIRECTOR.delight.max, s.director.delight + DIRECTOR.delight.boldChoice);
  node.visited = true;
  const revealed = revealFrom(run.map, nodeId);
  void revealed;
  const act = ACTS.acts[run.act]!;
  const kind: NodeKind = node.kind;
  // Mystery rooms resolve now: sometimes treasure, sometimes a Mimic.
  let mimic = false;
  if (kind === "mystery") {
    const delightBonus = s.director.delight >= DIRECTOR.delight.mysteryBonusAt ? 0.5 : 1;
    mimic = w.rng.float() < ACTS.mimicChance * delightBonus;
  }
  const trap = w.rng.float() < w.persona.trapChance;
  const tpl = templateFor(kind === "mystery" ? (mimic ? "encounter" : "mystery") : kind, w.rng);
  s.room = buildRoom(tpl, kind, w.rng, act, s.tick, trap);
  s.enemies = [];
  s.summons = [];
  s.projectiles = [];
  s.zones = [];
  s.pickups = [];
  s.init = null;
  s.director.boredom = 0;
  placeHeroes(w);
  w.emit({ t: "roomstart", kind });
  w.emit({ t: "music", track: act.music });
  run.phase = "room";
  if (kind === "encounter" || kind === "elite" || kind === "boss") {
    s.room.fight = true;
    spawnEncounter(w, kind);
    w.narrate("enter_room");
    if (trap) for (let i = 0; i < 2; i++) {
      const sp = w.rng.pick(s.room.enemySpawns);
      w.addZone("spikes", sp.x - 2 + w.rng.float() * 4, sp.z + 2, 1.2, sec(600), null, "1d6");
    }
  } else if (kind === "mystery") {
    w.narrate("mystery");
    if (mimic) {
      s.room.fight = true;
      const sp = s.room.enemySpawns[0]!;
      spawnEnemy(w, "mimic", sp.x, sp.z, { elite: run.act > 0 });
      w.narrate("mimic");
    } else {
      s.room.cleared = true;
      const items = s.director.delight >= DIRECTOR.delight.mysteryBonusAt ? 2 : 1;
      for (let i = 0; i < items; i++) queueLoot(w, randomItem(w));
      s.run.gold += w.rng.int(15, 40);
      s.director.delight = Math.max(0, s.director.delight - 20);
      if (s.run.loot.length) run.phase = "loot";
    }
  } else if (kind === "campfire") {
    run.phase = "campfire";
    run.campfireDone = {};
    w.narrate("campfire");
    // Fallen heroes return at the campfire, one level down and injured.
    for (const h of s.heroes) if (h.fallen) returnFallen(w, h);
    for (const h of s.heroes) {
      h.anim = "sit";
      if (h.ctrl === "ai") applyCampfire(w, h, "rest");
    }
  } else if (kind === "merchant") {
    run.phase = "merchant";
    run.merchantStock = [...new Set([randomItem(w), randomItem(w), randomItem(w), randomItem(w)])];
    w.narrate("merchant");
  } else if (kind === "skill") {
    run.phase = "skill";
    const scenes = SCENES.scenes.filter((sc) => sc.acts.includes(act.id));
    const sc = w.rng.pick(scenes.length ? scenes : SCENES.scenes);
    run.scene = { id: sc.id, result: null, chosen: -1 };
  }
}

function returnFallen(w: World, h: Hero): void {
  h.fallen = false;
  h.down = null;
  const inj = w.rng.pick(Object.keys(INJURIES));
  if (!h.injuries.includes(inj)) h.injuries.push(inj);
  levelTo(h, Math.max(1, h.level - 1), perm(w));
  h.hp = Math.max(1, Math.floor(h.maxHp / 2));
  h.state = "idle";
  w.popup(`${h.name} returns (${INJURIES[inj]!.name})`, "#e5584f", h.x, h.z, true);
}

export function randomItem(w: World): string {
  const act = ACTS.acts[w.s.run.act]!;
  const weights = ITEMS.rarityWeights[act.id === "finale" ? "finale" : act.id] ?? { uncommon: 1 };
  const rar = w.rng.weighted(Object.keys(weights), (k) => weights[k] ?? 0);
  const pool = Object.entries(ITEMS.items).filter(([, it]) => it.rarity === rar).map(([id]) => id);
  return w.rng.pick(pool.length ? pool : Object.keys(ITEMS.items));
}

function queueLoot(w: World, itemId: string): void {
  const votes: LootVote["votes"] = {};
  for (const h of w.s.heroes) if (!h.fallen) votes[h.id] = null;
  w.s.run.loot.push({ itemId, votes, rolls: {}, t: sec(15), winner: null });
}

/** AI vote: Need if it's an upgrade for its class and it has a free attunement slot. */
function aiVote(w: World, h: Hero, itemId: string): "need" | "greed" | "pass" {
  const it = ITEMS.items[itemId]!;
  const e = it.effects as Record<string, unknown>;
  const caster = ["wizard", "warlock", "druid", "cleric", "bard"].includes(h.cls);
  const casterItem = "spellDc" in e || "spellToHit" in e || "slotBonus" in e || "spellDamage" in e || "fireDamage" in e;
  const martialItem = "toHit" in e || "damage" in e || "onHit" in e || "critOn" in e;
  if (it.attune && h.attuned.length >= ITEMS.attunementSlots) return "greed";
  if ((casterItem && caster) || (martialItem && !caster) || "ac" in e || "maxHp" in e) return w.rng.float() < 0.7 ? "need" : "greed";
  return "greed";
}

function resolveLoot(w: World): void {
  const run = w.s.run;
  const lv = run.loot[0];
  if (!lv) return;
  for (const h of w.s.heroes) if (h.ctrl === "ai" && lv.votes[h.id] === null) lv.votes[h.id] = aiVote(w, h, lv.itemId);
  lv.t--;
  const pending = Object.values(lv.votes).some((v) => v === null);
  if (pending && lv.t > 0) return;
  const entries = Object.entries(lv.votes).map(([id, v]) => [Number(id), v ?? "pass"] as const);
  const need = entries.filter(([, v]) => v === "need");
  const pool = need.length ? need : entries.filter(([, v]) => v === "greed");
  let best = -1, winner: number | null = null;
  for (const [id] of pool) {
    const r = w.rng.die(20);
    lv.rolls[id] = r;
    const h = w.s.heroes.find((x) => x.id === id)!;
    w.emit({ t: "roll", who: h.name, what: `${need.length ? "Need" : "Greed"}: ${ITEMS.items[lv.itemId]!.name}`, d20: [r], kept: r, total: r, vs: 0, vsLabel: "DC", result: "", mode: "normal", x: h.x, z: h.z, slot: h.slot });
    if (r > best) { best = r; winner = id; }
  }
  lv.winner = winner;
  if (winner !== null) {
    const h = w.s.heroes.find((x) => x.id === winner)!;
    giveItem(h, lv.itemId, perm(w));
    w.popup(`${h.name} gets ${ITEMS.items[lv.itemId]!.name}`, "#e8cf4a", h.x, h.z, true);
    w.emit({ t: "sfx", id: "loot" });
  } else {
    w.s.run.gold += ITEMS.prices[ITEMS.items[lv.itemId]!.rarity]! / 2;
  }
  run.loot.shift();
  if (!run.loot.length) {
    run.phase = "room";
    if (w.s.room) w.s.room.cleared = true;
  }
}

function roomCleared(w: World): void {
  const s = w.s, run = s.run, room = s.room!;
  room.cleared = true;
  s.director.advantageNextFight = false;
  w.narrate("victory");
  w.emit({ t: "sfx", id: "victory" });
  // Downed heroes get up when the fight ends; stable ones too.
  for (const h of s.heroes) if (h.down) w.revive(h, 1);
  for (const h of s.heroes) h.clock = { ticks: 0, action: true, bonus: true, reaction: true };
  const kind = room.kind;
  const [g0, g1] = kind === "elite" || kind === "boss" ? BALANCE.loot.goldPerElite : BALANCE.loot.goldPerEncounter;
  const gold = Math.round(w.rng.int(g0, g1) * (1 + s.heroes.reduce((t, h) => t + h.mods.goldFind, 0)));
  s.pickups.push({ id: w.id(), kind: "gold", x: room.exit.x, z: room.exit.z - 2, value: gold });
  if (w.rng.float() < BALANCE.loot.potionChance) s.pickups.push({ id: w.id(), kind: "potion", x: room.exit.x + 1, z: room.exit.z - 2.5, value: 1 });
  const items = (kind === "elite" && BALANCE.loot.eliteGuaranteedItem ? 1 : 0) + (kind === "boss" ? 2 : 0) + (w.rng.float() < BALANCE.loot.itemChance + 0.1 * w.persona.lootBonus ? 1 : 0);
  for (let i = 0; i < items; i++) queueLoot(w, randomItem(w));
  if (run.loot.length) run.phase = "loot";
  if (kind === "boss") {
    const boss = s.enemies.find((e) => e.boss);
    run.ttk.push({ boss: boss?.type ?? "boss", ticks: s.tick - room.startTick });
  }
}

function levelUpParty(w: World, level: number): void {
  const run = w.s.run;
  for (const h of w.s.heroes) {
    if (h.level >= level) continue;
    levelTo(h, level, perm(w));
    w.emit({ t: "levelup", id: h.id, level });
    w.vfx("level_up", h.x, h.z, { follow: h.id });
    if (level === 3 && !h.subclass) run.pendingSubclass[h.id] = [...CLASSES[h.cls]!.subclasses];
    else {
      const caster = ["wizard", "warlock", "druid", "cleric", "bard"].includes(h.cls);
      const pool = CARDS.cards.filter((c) => !h.cards.includes(c.id) && !(c.casterOnly && !caster) && !(c.martialOnly && caster));
      run.pendingCards[h.id] = w.rng.shuffle(pool.map((c) => c.id)).slice(0, 3);
    }
  }
  if (Object.keys(run.pendingCards).length || Object.keys(run.pendingSubclass).length) run.phase = "levelup";
}

/** Called when the party leaves a finished node. */
function completeNode(w: World): void {
  const s = w.s, run = s.run;
  const node = nodeById(run.map, run.map.current);
  run.nodesCleared++;
  const act = ACTS.acts[run.act]!;
  // Sweep up anything left on the floor: gold is shared, potions go to whoever has room.
  for (const p of s.pickups) {
    if (p.kind === "gold") run.gold += p.value;
    else if (p.kind === "potion") {
      const h = s.heroes.find((x) => !x.fallen && x.potions < 3 + x.mods.potionSlots);
      if (h) h.potions++;
    }
  }
  s.room = null;
  s.enemies = [];
  s.summons = [];
  s.zones = [];
  s.projectiles = [];
  s.pickups = [];
  if (node.kind === "boss") {
    run.bossesBeaten++;
    if (run.act >= ACTS.acts.length - 1) {
      run.phase = "victory";
      run.ended = { victory: true, tick: s.tick };
      w.emit({ t: "achievement", id: "victory" });
      return;
    }
    // Long rest between acts.
    run.act++;
    s.director.mercyUsed = 0;
    for (const h of s.heroes) {
      if (h.fallen) returnFallen(w, h);
      longRest(h, perm(w));
    }
    const next = ACTS.acts[run.act]!;
    run.map = generateActMap(w.rng, run.act);
    run.fights = 0;
    run.phase = "actIntro";
    levelUpParty(w, act.levels[1] + (run.act === ACTS.acts.length - 1 ? 0 : 0));
    if (run.act === ACTS.acts.length - 1) levelUpParty(w, BALANCE.leveling.finaleLevel);
    void next;
    w.emit({ t: "achievement", id: `act_${run.act}` });
    return;
  }
  if (node.kind === "encounter" || node.kind === "elite") {
    run.fights++;
    const target = act.levels[0] + 1;
    if (run.fights === BALANCE.leveling.fightsPerMidLevel && target < act.levels[1] + 0) levelUpParty(w, target);
  }
  if (run.phase !== "levelup") run.phase = "map";
}

function applyCampfire(w: World, h: Hero, choice: "rest" | "upgrade", ability?: Ability): void {
  const run = w.s.run;
  if (run.campfireDone[h.id]) return;
  run.campfireDone[h.id] = true;
  if (choice === "rest") {
    const spend = Math.max(1, Math.ceil(h.hitDice * BALANCE.rest.shortRestHitDiceFraction));
    let healed = h.mods.restHeal;
    const die = CLASSES[h.cls]!.hitDie;
    for (let i = 0; i < spend && h.hitDice > 0 && h.hp + healed < h.maxHp; i++) {
      h.hitDice--;
      healed += Math.max(1, w.rng.die(die) + Math.floor((h.scores.con - 10) / 2));
    }
    h.hp = Math.min(h.maxHp, h.hp + healed);
    if (h.cls === "wizard") h.slots = Math.min(maxSlots(h), h.slots + Math.ceil(h.level / 2)); // Arcane Recovery
    h.inspiration = Math.min(3, h.inspiration + h.mods.inspirationOnRest);
    w.popup(`+${healed} HP`, "#5fc77a", h.x, h.z);
  } else {
    const a = ability ?? (CLASSES[h.cls]!.attack.ability as Ability);
    h.upgrades[a] = (h.upgrades[a] ?? 0) + 2;
    recalc(h, perm(w));
    w.popup(`+2 ${a.toUpperCase()}`, "#e8cf4a", h.x, h.z);
  }
  h.hitDice = Math.min(h.hitDice, hitDiceMax(h));
}

function finishSkill(w: World, optionIdx: number, heroId: number, helperId: number | null): void {
  const s = w.s, run = s.run;
  if (!run.scene || run.scene.result) return;
  const sc = SCENES.scenes.find((x) => x.id === run.scene!.id)!;
  const opt = sc.options[optionIdx] ?? sc.options[0]!;
  const h = s.heroes.find((x) => x.id === heroId && !x.fallen) ?? s.heroes.find((x) => !x.fallen)!;
  const ability = SCENES.skills[opt.skill] as Ability;
  const helper = helperId !== null && helperId !== h.id && s.heroes.some((x) => x.id === helperId && !x.fallen);
  const r = rollCheck(w.rng, { mod: skillBonus(h, opt.skill, ability), dc: opt.dc, advantages: helper ? 1 : 0, inspiration: h.inspiration > 0 });
  if (r.rerolled) h.inspiration--;
  w.emit({ t: "roll", who: h.name, what: `${opt.skill.replace(/_/g, " ")}${helper ? " (help)" : ""}`, d20: r.d20.rolls, kept: r.d20.natural, total: r.total, vs: opt.dc, vsLabel: "DC", result: r.success ? "success" : "failure", mode: r.d20.mode, x: h.x, z: h.z, slot: h.slot });
  const out = r.success ? opt.success : opt.fail;
  // Attempting the hardest option on offer is a bold choice.
  if (opt.dc >= Math.max(...sc.options.map((o) => o.dc))) s.director.delight = Math.min(DIRECTOR.delight.max, s.director.delight + DIRECTOR.delight.boldChoice / 2);
  run.scene = { id: sc.id, result: out.text, chosen: optionIdx };
  if (out.gold) run.gold = Math.max(0, run.gold + out.gold);
  if (out.item) queueLoot(w, randomItem(w));
  if (out.damage) w.damage(h, rollDice(w.rng, parseDice(out.damage)).total, "bludgeoning", null);
  if (out.heal) for (const o of w.heroesUp()) w.heal(o, rollDice(w.rng, parseDice(out.heal)).total, null);
  if (out.inspiration) h.inspiration = Math.min(3, h.inspiration + out.inspiration);
  if (out.condition) h.conds[out.condition] = sec(8);
  if (out.boredom) s.director.boredom += out.boredom;
  if (out.delight) s.director.delight += out.delight;
  if (out.advantageNextFight) s.director.advantageNextFight = true;
  if (r.d20.natural === 20) s.director.delight += DIRECTOR.delight.nat20;
  if (h.hp <= 0 && h.down) w.revive(h, 1);
  if (out.fight) {
    s.room!.fight = true;
    s.room!.cleared = false;
    s.room!.kind = "encounter";
    s.room!.startTick = s.tick;
    const sp = s.room!.heroSpawns[0]!;
    for (let i = 0; i < 3; i++) spawnEnemy(w, "goblin", sp.x + (i - 1) * 1.5, Math.max(2, sp.z - 6));
    run.phase = "room";
    run.scene = null;
  }
}

/** Apply a player/bot command. Invalid commands are ignored (they can arrive late from the UI). */
export function applyCommand(w: World, cmd: Command): void {
  const s = w.s, run = s.run;
  const hero = (id: number): Hero | undefined => s.heroes.find((h) => h.id === id);
  switch (cmd.c) {
    case "continue":
      if (run.phase === "actIntro") {
        run.phase = "map";
        w.narrate("enter_room");
      } else if (run.phase === "room" && s.room?.cleared) completeNode(w);
      else if (run.phase === "campfire") {
        for (const h of s.heroes) if (!run.campfireDone[h.id]) applyCampfire(w, h, "rest");
        completeNode(w);
      } else if (run.phase === "merchant") completeNode(w);
      else if (run.phase === "skill" && run.scene?.result) {
        if (run.loot.length) run.phase = "loot";
        else completeNode(w);
      }
      break;
    case "leave":
      if (run.phase === "merchant") completeNode(w);
      break;
    case "chooseNode": {
      if (run.phase !== "map") break;
      const cur = nodeById(run.map, run.map.current);
      if (!cur.next.includes(cmd.node)) break;
      enterNode(w, cmd.node);
      break;
    }
    case "join": {
      if (s.heroes.some((h) => h.slot === cmd.slot) || s.heroes.length >= 4) break;
      if (run.phase !== "campfire" && run.phase !== "actIntro" && run.phase !== "tavern") break;
      const lvl = Math.max(1, Math.min(...s.heroes.map((h) => h.level)));
      const h = makeHero(s.nextId++, cmd.slot, cmd.cls, { level: lvl, ctrl: cmd.ctrl, background: cmd.background, perm: perm(w) });
      if (lvl >= 3) h.subclass = CLASSES[cmd.cls]!.subclasses[0]!;
      recalc(h, perm(w));
      h.hp = h.maxHp;
      const sp = s.room?.heroSpawns[s.heroes.length % Math.max(1, s.room.heroSpawns.length)];
      if (sp) { h.x = sp.x; h.z = sp.z; }
      s.heroes.push(h);
      w.popup(`${h.name} joins the party!`, "#e8cf4a", h.x, h.z, true);
      break;
    }
    case "card": {
      const opts = run.pendingCards[cmd.hero];
      const h = hero(cmd.hero);
      if (!opts || !h || !opts.includes(cmd.card)) break;
      h.cards.push(cmd.card);
      const card = CARDS.cards.find((c) => c.id === cmd.card)!;
      if (card.grant?.inspiration) h.inspiration = Math.min(3, h.inspiration + card.grant.inspiration);
      recalc(h, perm(w));
      delete run.pendingCards[cmd.hero];
      if (!Object.keys(run.pendingCards).length && !Object.keys(run.pendingSubclass).length) run.phase = run.map.current === 0 && run.act > 0 ? "actIntro" : "map";
      break;
    }
    case "subclass": {
      const opts = run.pendingSubclass[cmd.hero];
      const h = hero(cmd.hero);
      if (!opts || !h || !opts.includes(cmd.sub)) break;
      h.subclass = cmd.sub;
      recalc(h, perm(w));
      delete run.pendingSubclass[cmd.hero];
      if (!Object.keys(run.pendingCards).length && !Object.keys(run.pendingSubclass).length) run.phase = run.map.current === 0 && run.act > 0 ? "actIntro" : "map";
      break;
    }
    case "campfire": {
      const h = hero(cmd.hero);
      if (run.phase !== "campfire" || !h) break;
      applyCampfire(w, h, cmd.choice, cmd.ability);
      break;
    }
    case "buy": {
      const h = hero(cmd.hero);
      if (run.phase !== "merchant" || !h) break;
      if (cmd.item === "potion_healing") {
        const price = ITEMS.consumables.potion_healing!.price;
        if (run.gold >= price && h.potions < 3 + h.mods.potionSlots) { run.gold -= price; h.potions++; }
        break;
      }
      if (!run.merchantStock.includes(cmd.item)) break;
      const price = ITEMS.prices[ITEMS.items[cmd.item]!.rarity]!;
      if (run.gold < price) break;
      run.gold -= price;
      run.merchantStock = run.merchantStock.filter((i) => i !== cmd.item);
      giveItem(h, cmd.item, perm(w));
      w.emit({ t: "sfx", id: "coin" });
      break;
    }
    case "skill":
      if (run.phase === "skill") finishSkill(w, cmd.option, cmd.hero, cmd.helper);
      break;
    case "vote": {
      const lv = run.loot[0];
      if (run.phase !== "loot" || !lv || !(cmd.hero in lv.votes)) break;
      lv.votes[cmd.hero] = cmd.vote;
      break;
    }
    case "order":
      for (const h of s.heroes) if (h.ctrl === "ai") {
        h.order = cmd.order;
        if (cmd.order === "hold") { h.aiMem.holdX = h.x; h.aiMem.holdZ = h.z; }
      }
      break;
    case "attune": {
      const h = hero(cmd.hero);
      if (!h || !h.items.includes(cmd.item) || !ITEMS.items[cmd.item]?.attune) break;
      if (h.attuned.includes(cmd.item)) h.attuned = h.attuned.filter((i) => i !== cmd.item);
      else if (h.attuned.length < ITEMS.attunementSlots) h.attuned.push(cmd.item);
      recalc(h, perm(w));
      break;
    }
  }
}

/** Per-tick run bookkeeping outside of combat resolution. */
export function updateRun(w: World): void {
  const s = w.s, run = s.run;
  if (run.ended) return;
  if (run.phase === "loot") resolveLoot(w);
  if (s.room && s.room.fight && !s.room.cleared && run.phase === "room") {
    if (w.enemiesAlive().length === 0) roomCleared(w);
  }
  // Total party kill: nobody left standing.
  const standing = s.heroes.some((h) => !h.fallen && !h.down && h.hp > 0);
  if (!standing && s.heroes.length) {
    run.phase = "defeat";
    run.ended = { victory: false, tick: s.tick };
    w.narrate("tpk");
  }
  // Auto-advance AI-only decisions so headless runs and AI companions never stall.
  for (const [id, cards] of Object.entries(run.pendingCards)) {
    const h = s.heroes.find((x) => x.id === Number(id));
    if (h?.ctrl === "ai") applyCommand(w, { c: "card", hero: h.id, card: cards[0]! });
  }
  for (const [id, subs] of Object.entries(run.pendingSubclass)) {
    const h = s.heroes.find((x) => x.id === Number(id));
    if (h?.ctrl === "ai") applyCommand(w, { c: "subclass", hero: h.id, sub: subs[w.rng.int(0, subs.length - 1)]! });
  }
  void abilityParam;
}

/** Renown earned by a run, win or lose. */
export function renownFor(s: SimState): number {
  const R = BALANCE.renown;
  const r = s.run;
  const total = r.nodesCleared * R.perNode + r.bossesBeaten * R.perBoss + r.act * R.perAct + (r.ended?.victory ? R.victory : 0);
  return Math.max(R.minimum, Math.round(total * (r.persona === "killer" ? 1 + r.killerTier * 0.1 : 1)));
}
