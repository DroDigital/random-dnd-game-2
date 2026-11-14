import type { RngState } from "../rules/rng";
import type { ConditionSet } from "../rules/conditions";
import type { RoundClock } from "../rules/clock";
import type { DeathSaveState } from "../rules/deathsave";
import type { RollMode } from "../rules/d20";

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type Team = "party" | "foe";
export type ActState = "idle" | "move" | "windup" | "recover" | "dodge" | "stagger" | "cast" | "downed" | "dead";

/** Input bits, one frame per player per tick. */
export const BTN = {
  attack: 1, action: 2, bonus: 4, dodge: 8, reaction: 16, interact: 32, help: 64, start: 128,
  up: 256, down: 512, left: 1024, right: 2048, // menu navigation / D-pad orders
} as const;
export type ButtonName = keyof typeof BTN;

export interface InputFrame {
  /** World-space move direction, length <= 1. */
  mx: number;
  mz: number;
  /** Buttons held this tick. */
  down: number;
  /** Buttons that went down this tick. */
  pressed: number;
  /** Buttons that went up this tick. */
  released: number;
}
export const EMPTY_INPUT: InputFrame = { mx: 0, mz: 0, down: 0, pressed: 0, released: 0 };

export interface PendingStrike {
  kind: "basic" | "sneak" | "smite" | "reckless" | "retaliate";
  at: number; // stateT tick at which it resolves
  targetId?: number;
}

export interface Actor {
  id: number;
  team: Team;
  model: string;
  name: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  radius: number;
  hp: number;
  maxHp: number;
  tempHp: number;
  ac: number;
  speed: number;
  scores: Record<Ability, number>;
  prof: number;
  conds: ConditionSet;
  state: ActState;
  stateT: number;
  stateDur: number;
  anim: string;
  animSeq: number;
  freeze: number;
  /** Timed effects keyed by name (ticks remaining). */
  buffs: Record<string, number>;
  /** Ticks during which attacks against this actor have advantage (Help action). */
  helped: number;
  tags: string[];
  attackCount: number;
  strike: PendingStrike | null;
  lastHitBy: number;
  resist: string[];
}

export interface Mods {
  ac: number; toHit: number; damage: number; maxHp: number; speed: number; critOn: number; saves: number; checks: number;
  healBonus: number; spellDc: number; spellToHit: number; spellDamage: number; slotBonus: number; dodgeCooldown: number;
  hpRegen: number; deathSave: number; goldFind: number; initiative: number; clockSpeed: number; aoeDice: number;
  inspirationOnRest: number; inspirationOnCrit: number; critDamage: number; reactionAc: number; reactionShove: number;
  stabilizeFast: number; hitDiceBonus: number; restHeal: number; maxHpPerLevel: number; stealth: number; hideTicks: number;
  potionSlots: number; evasion: number; firstHitDisadvantage: number; fireDamage: number; rageBonus: number;
  onHit: { dice: string; type: string; undeadOnly: boolean; ignites: boolean }[];
  resist: string[]; resistCondition: string[];
  sub: Record<string, number>;
}

export interface Hero extends Actor {
  kind: "hero";
  slot: number;
  ctrl: "human" | "ai";
  cls: string;
  subclass: string | null;
  level: number;
  clock: RoundClock;
  inspiration: number;
  hitDice: number;
  slots: number;
  dodgeCd: number;
  iframes: number;
  down: null | { saves: DeathSaveState; timer: number; stabilizeT: number };
  stable: boolean;
  fallen: boolean;
  injuries: string[];
  items: string[];
  attuned: string[];
  potions: number;
  cards: string[];
  background: string;
  upgrades: Partial<Record<Ability, number>>;
  order: "follow" | "hold" | "focus" | "defensive";
  layOnHands: number;
  holdT: { action: number; bonus: number; interact: number };
  markId: number;
  stats: { kills: number; damage: number; crits: number; downs: number; heals: number };
  mods: Mods;
  /** Companion/bot memory (multi-tick button holds, hold position). */
  aiMem: { hold: "action" | "bonus" | "interact" | null; holdT: number; holdX: number; holdZ: number; prevDown: number; path: { x: number; z: number }[]; repath: number };
}

export interface Telegraph {
  attackIdx: number;
  targetId: number;
  shape: "melee" | "circle" | "line" | "ranged";
  x: number;
  z: number;
  radius: number;
  dirX: number;
  dirZ: number;
  length: number;
  width: number;
  start: number;
  end: number;
  /** Reaction outcomes applied by heroes during the window. */
  cancelled: boolean;
  shieldAc: number;
  halve: boolean;
  cut: number;
  disadvantage: boolean;
  thorns: number;
}

export interface AiState {
  mode: "idle" | "chase" | "telegraph" | "attack" | "recover" | "flee";
  t: number;
  targetId: number;
  path: { x: number; z: number }[];
  repath: number;
  cooldowns: number[];
}

export interface Enemy extends Actor {
  kind: "enemy";
  type: string;
  elite: boolean;
  boss: boolean;
  xp: number;
  ai: AiState;
  telegraph: Telegraph | null;
  legendaryUsed: number;
  damageBonus: number;
  fortitudeUsed: boolean;
}

export interface Summon extends Actor {
  kind: "summon";
  owner: number;
  life: number;
  attackT: number;
  summonType: "spiritual_weapon" | "wolf";
}

export type AnyActor = Hero | Enemy | Summon;

export interface Projectile {
  id: number;
  owner: number;
  team: Team;
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  radius: number;
  vfx: string;
  kind: "attack" | "fireball" | "enemy";
  damage: string;
  type: string;
  toHit: number;
  fire: boolean;
  push: number;
  targetX: number;
  targetZ: number;
  mode: RollMode | null;
  enemyAttackIdx: number;
}

export type ZoneKind = "grease" | "fire" | "poison" | "acid" | "darkness" | "entangle" | "spikes";
export interface Zone {
  id: number;
  kind: ZoneKind;
  x: number;
  z: number;
  r: number;
  life: number;
  owner: number;
  team: Team;
  tickT: number;
  dice: string;
  dc: number;
}

export interface Pickup {
  id: number;
  kind: "gold" | "potion" | "chest";
  x: number;
  z: number;
  value: number;
}

export type CellType = 0 | 1 | 2 | 3 | 4; // floor, wall, cover (blocks), hazard (walkable), void
export interface RoomProp {
  kind: "floor" | "wall" | "cover" | "hazard" | "torch" | "chest" | "exit" | "campfire" | "merchant" | "pillar" | "rubble" | "decor" | "skill" | "grate";
  x: number;
  z: number;
  rot: number;
  variant: number;
}
export interface RoomState {
  template: string;
  kind: NodeKind | "tavern";
  /** Nav grid at 1 m cells. */
  w: number;
  h: number;
  cells: CellType[];
  props: RoomProp[];
  exit: { x: number; z: number };
  heroSpawns: { x: number; z: number }[];
  enemySpawns: { x: number; z: number }[];
  bossSpawns: { x: number; z: number }[];
  cleared: boolean;
  /** Tick the room started (for slow-fight boredom). */
  startTick: number;
  fight: boolean;
  trap: boolean;
}

export type NodeKind = "encounter" | "elite" | "skill" | "merchant" | "campfire" | "mystery" | "boss" | "start";
export interface MapNode {
  id: number;
  row: number;
  col: number;
  kind: NodeKind;
  next: number[];
  revealed: boolean;
  visited: boolean;
}
export interface ActMap {
  act: number;
  nodes: MapNode[];
  current: number;
}

export interface InitiativeState {
  bossId: number;
  phase: "plan" | "resolve";
  planT: number;
  order: { id: number; total: number; roll: number }[];
  plans: Record<number, { x: number; z: number; action: "attack" | "ability" | "dodge" | "help" | "none"; ready: boolean; cursor: number }>;
  turn: number;
  turnT: number;
  legendary: string;
}

export interface LootVote {
  itemId: string;
  votes: Record<number, "need" | "greed" | "pass" | null>;
  rolls: Record<number, number>;
  t: number;
  winner: number | null;
}

export type RunPhase =
  | "tavern" | "map" | "room" | "levelup" | "campfire" | "merchant" | "skill" | "loot" | "actIntro" | "victory" | "defeat";

export interface DirectorState {
  boredom: number;
  delight: number;
  mercyUsed: number;
  twistCooldown: number;
  lastTwist: string;
  advantageNextFight: boolean;
  idleTicks: number;
}

export interface RunState {
  seed: number;
  persona: "storyteller" | "rules_lawyer" | "chaos" | "killer";
  killerTier: number;
  mode: "coop" | "lone" | "party";
  act: number;
  map: ActMap;
  phase: RunPhase;
  gold: number;
  fights: number;
  levelsPending: number[];
  pendingCards: Record<number, string[]>;
  pendingSubclass: Record<number, string[]>;
  campfireDone: Record<number, boolean>;
  merchantStock: string[];
  scene: { id: string; result: string | null; chosen: number } | null;
  loot: LootVote[];
  renown: number;
  bossesBeaten: number;
  nodesCleared: number;
  startTick: number;
  ended: null | { victory: boolean; tick: number };
  ttk: { boss: string; ticks: number }[];
  unlocked: { classes: string[]; items: string[]; backgrounds: string[]; perm: Record<string, number> };
}

export interface SimState {
  version: 1;
  tick: number;
  rng: RngState;
  nextId: number;
  run: RunState;
  room: RoomState | null;
  heroes: Hero[];
  enemies: Enemy[];
  summons: Summon[];
  projectiles: Projectile[];
  zones: Zone[];
  pickups: Pickup[];
  init: InitiativeState | null;
  director: DirectorState;
  /** Hitstop: the whole world freezes for a few ticks on a crit. */
  hitstop: number;
}

/** Things the sim tells the presentation layer about. Not part of the deterministic state. */
export type SimEvent =
  | { t: "roll"; who: string; what: string; d20: number[]; kept: number; total: number; vs: number; vsLabel: "AC" | "DC"; result: string; mode: RollMode; damage?: number; x: number; z: number; slot: number }
  | { t: "damage"; id: number; amount: number; crit: boolean; graze: boolean; type: string; x: number; z: number }
  | { t: "heal"; id: number; amount: number; x: number; z: number }
  | { t: "vfx"; id: string; x: number; z: number; y?: number; follow?: number; life?: number; scale?: number; ally?: boolean; dirX?: number; dirZ?: number }
  | { t: "sfx"; id: string; x?: number; z?: number }
  | { t: "popup"; text: string; color: string; x: number; z: number; big?: boolean }
  | { t: "narrate"; key: string; text: string }
  | { t: "shake"; amount: number }
  | { t: "crit" }
  | { t: "initiative"; on: boolean }
  | { t: "deathsave"; id: number; roll: number; successes: number; failures: number }
  | { t: "levelup"; id: number; level: number }
  | { t: "roomstart"; kind: string }
  | { t: "achievement"; id: string }
  | { t: "music"; track: string };
