import { BALANCE, CLASSES, DIRECTOR, ENEMIES, abilityParam } from "../data";
import { Rng } from "../rules/rng";
import { resolveAttack, type AttackResult } from "../rules/attack";
import { parseDice, rollDice, type DiceExpr } from "../rules/dice";
import { rollCheck, saveDamage } from "../rules/checks";
import { abilityMod } from "../rules/d20";
import { attackModeSources, has, saveModifiers, type Condition } from "../rules/conditions";
import { damageWhileDowned, freshDeathSaves } from "../rules/deathsave";
import { cellAt, isBlocked } from "./nav";
import { attackBonus, damageMod, saveBonus } from "./hero";
import type { Ability, Actor, AnyActor, Enemy, Hero, SimEvent, SimState, Summon, Team, Zone, ZoneKind } from "./types";

export const TICK = 1 / 60;
export const sec = (s: number): number => Math.round(s * 60);

/** Wraps the plain-data SimState with helpers. The Rng shares the state's array so it stays serializable. */
export class World {
  readonly rng: Rng;
  events: SimEvent[] = [];
  constructor(public s: SimState) {
    this.rng = new Rng(s.rng);
  }

  id(): number {
    return this.s.nextId++;
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  narrate(key: string): void {
    const lines = DIRECTOR.lines[key];
    if (!lines) return;
    this.emit({ t: "narrate", key, text: this.rng.pick(lines) });
  }

  get persona() {
    return DIRECTOR.personas[this.s.run.persona];
  }

  // ---------------------------------------------------------------- queries
  heroesUp(): Hero[] {
    return this.s.heroes.filter((h) => !h.fallen && !h.down && h.hp > 0);
  }
  actorsOf(team: Team): AnyActor[] {
    if (team === "party") return [...this.s.heroes.filter((h) => !h.fallen && !h.down && h.hp > 0), ...this.s.summons];
    return this.s.enemies.filter((e) => e.state !== "dead");
  }
  enemiesAlive(): Enemy[] {
    return this.s.enemies.filter((e) => e.state !== "dead");
  }
  byId(id: number): AnyActor | undefined {
    return this.s.heroes.find((h) => h.id === id) ?? this.s.enemies.find((e) => e.id === id) ?? this.s.summons.find((m) => m.id === id);
  }
  dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }
  isHero(a: Actor): a is Hero {
    return (a as Hero).kind === "hero";
  }
  isEnemy(a: Actor): a is Enemy {
    return (a as Enemy).kind === "enemy";
  }
  isUndead(a: Actor): boolean {
    return a.tags.includes("undead");
  }
  nearest<T extends { x: number; z: number }>(from: { x: number; z: number }, list: T[], filter?: (t: T) => boolean): T | undefined {
    let best: T | undefined, bd = Infinity;
    for (const t of list) {
      if (filter && !filter(t)) continue;
      const d = this.dist(from, t);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /** An ally of `team` (other than `exclude`) within flank range of the target — Spiritual Weapon counts. */
  allyNear(target: Actor, team: Team, exclude: number): boolean {
    const r = BALANCE.hero.flankRange + target.radius;
    return this.actorsOf(team).some((a) => a.id !== exclude && this.dist(a, target) <= r + a.radius * 0.5);
  }

  // ---------------------------------------------------------------- animation & fx helpers
  setState(a: Actor, state: Actor["state"], dur: number, anim?: string): void {
    a.state = state;
    a.stateT = 0;
    a.stateDur = dur;
    if (anim) {
      a.anim = anim;
      a.animSeq++;
    }
  }
  vfx(id: string, x: number, z: number, opts: Omit<Extract<SimEvent, { t: "vfx" }>, "t" | "id" | "x" | "z"> = {}): void {
    this.emit({ t: "vfx", id, x, z, ...opts });
  }
  popup(text: string, color: string, x: number, z: number, big = false): void {
    this.emit({ t: "popup", text, color, x, z, big });
  }

  // ---------------------------------------------------------------- saves
  saveFor(a: AnyActor, ability: Ability, dc: number, extraAdv = 0): boolean {
    const sm = saveModifiers(a.conds, ability);
    let bonus: number;
    let adv = extraAdv;
    if (this.isHero(a)) {
      bonus = saveBonus(a, ability);
      if (ability === "dex" && CLASSES[a.cls]!.passives.includes("danger_sense")) adv++;
    } else {
      bonus = abilityMod(a.scores[ability] ?? 10) + (this.isEnemy(a) && a.boss ? 2 : 0);
    }
    const r = rollCheck(this.rng, { mod: bonus, dc, autoFail: sm.autoFail, disadvantages: sm.disadvantages, advantages: adv });
    this.emit({ t: "roll", who: a.name, what: `${ability.toUpperCase()} save`, d20: r.d20.rolls, kept: r.d20.natural, total: r.total, vs: dc, vsLabel: "DC", result: r.success ? "saved" : "failed", mode: r.d20.mode, x: a.x, z: a.z, slot: this.isHero(a) ? a.slot : -1 });
    return r.success;
  }

  addCondition(a: AnyActor, c: Condition, ticks: number): void {
    if (this.isHero(a) && a.mods.resistCondition.includes(c)) {
      this.popup("Immune", "#a49eb6", a.x, a.z);
      return;
    }
    if (this.isEnemy(a) && a.boss && (c === "stunned" || c === "restrained") ) ticks = Math.floor(ticks / 2);
    a.conds[c] = Math.max(a.conds[c] ?? 0, ticks);
    if (c === "prone") this.setState(a, "stagger", Math.min(ticks, 40), "hit");
    if (c === "stunned") this.vfx("stun", a.x, a.z, { follow: a.id, life: ticks / 60, y: 1.8 });
    if (c === "frightened") this.vfx("frightened", a.x, a.z, { follow: a.id, life: Math.min(3, ticks / 60), y: 1.8 });
    this.popup(c.toUpperCase(), "#a49eb6", a.x, a.z);
  }

  // ---------------------------------------------------------------- damage
  /** Apply damage; handles resistances, temp HP, downing heroes, killing enemies. Returns damage dealt. */
  damage(target: AnyActor, amount: number, type: string, source: AnyActor | null, opts: { crit?: boolean; graze?: boolean; silent?: boolean } = {}): number {
    if (amount <= 0 || target.state === "dead") return 0;
    if (this.isHero(target) && target.fallen) return 0;
    if (target.kind === "summon") return 0;
    let dmg = amount;
    if (target.resist.includes(type)) dmg = Math.floor(dmg / 2);
    if (this.isHero(target) && target.buffs.rage && ["slashing", "piercing", "bludgeoning"].includes(type)) dmg = Math.floor(dmg / 2);
    if (target.tempHp > 0) {
      const absorbed = Math.min(target.tempHp, dmg);
      target.tempHp -= absorbed;
      dmg -= absorbed;
    }
    const dealt = Math.min(dmg, Math.max(0, target.hp));
    if (source && this.isHero(source)) source.stats.damage += dealt;
    target.lastHitBy = source?.id ?? 0;
    this.emit({ t: "damage", id: target.id, amount: dmg, crit: !!opts.crit, graze: !!opts.graze, type, x: target.x, z: target.z });
    // Hitstun on real hits.
    if (!opts.graze && dmg > 0 && target.state !== "downed") {
      if (this.isEnemy(target) && !target.boss && target.state !== "windup") target.freeze = Math.max(target.freeze, BALANCE.enemy.hitstunTicks / 2);
      if (this.isHero(target)) target.freeze = Math.max(target.freeze, 3);
    }
    if (this.isHero(target)) {
      if (target.down) {
        if (dmg > 0) {
          target.down.saves = damageWhileDowned(target.down.saves, !!opts.crit, this.failLimit());
          target.stable = false;
          if (target.down.saves.dead) this.fall(target);
        }
        return dealt;
      }
      target.hp -= dmg;
      if (target.hp <= 0) this.downHero(target);
      return dealt;
    }
    target.hp -= dmg;
    if (target.hp <= 0) {
      const e = target as Enemy;
      if (e.tags.includes("undead") && ENEMIES[e.type]?.traits?.includes("undead_fortitude") && !e.fortitudeUsed && type !== "radiant" && !opts.crit) {
        e.fortitudeUsed = true;
        const ok = this.saveFor(e, "con", 5 + dmg);
        if (ok) {
          e.hp = 1;
          this.popup("Undead Fortitude!", "#5fc77a", e.x, e.z);
          return dealt;
        }
      }
      this.killEnemy(e, source);
    }
    return dealt;
  }

  failLimit(): number {
    return this.s.run.mode === "lone" ? 4 : 3;
  }

  downHero(h: Hero): void {
    h.hp = 0;
    h.down = { saves: freshDeathSaves(), timer: BALANCE.hero.deathSaveTicks, stabilizeT: 0 };
    h.stable = false;
    h.stats.downs++;
    h.conds = {};
    h.buffs = {};
    h.strike = null;
    this.setState(h, "downed", 0, "downed");
    this.emit({ t: "sfx", id: "down", x: h.x, z: h.z });
    this.narrate("downed");
  }

  fall(h: Hero): void {
    h.fallen = true;
    h.down = null;
    h.stable = false;
    h.hp = 0;
    this.setState(h, "dead", 0, "death");
    this.popup("FALLEN", "#e5584f", h.x, h.z, true);
    this.emit({ t: "sfx", id: "fallen" });
  }

  revive(h: Hero, hp: number): void {
    h.down = null;
    h.stable = false;
    h.hp = Math.max(1, Math.min(h.maxHp, hp));
    h.iframes = BALANCE.hero.invulnAfterReviveTicks;
    this.setState(h, "stagger", 30, "revive");
    this.popup("BACK UP!", "#5fc77a", h.x, h.z);
  }

  heal(h: Hero, amount: number, source: Hero | null): number {
    if (h.fallen) return 0;
    if (source) amount += source.mods.healBonus + (source.mods.sub.healBonus ?? 0);
    if (h.down) {
      this.revive(h, amount);
    } else {
      h.hp = Math.min(h.maxHp, h.hp + amount);
    }
    if (source) source.stats.heals += amount;
    this.emit({ t: "heal", id: h.id, amount, x: h.x, z: h.z });
    this.vfx("heal", h.x, h.z, { follow: h.id });
    return amount;
  }

  killEnemy(e: Enemy, source: AnyActor | null): void {
    e.hp = 0;
    e.telegraph = null;
    this.setState(e, "dead", 0, "death");
    this.vfx("death", e.x, e.z);
    this.emit({ t: "sfx", id: "kill", x: e.x, z: e.z });
    const owner = source && source.kind === "summon" ? this.byId((source as Summon).owner) : source;
    if (owner && this.isHero(owner)) {
      owner.stats.kills++;
      if (owner.mods.sub.tempOnKill) owner.tempHp = Math.max(owner.tempHp, abilityMod(owner.scores.cha) + owner.level);
    }
    this.s.director.delight = Math.min(DIRECTOR.delight.max, this.s.director.delight + DIRECTOR.delight.kill);
    if (!e.ai || e.xp > 0) {
      if (this.rng.float() < 0.35 && !e.boss) this.s.pickups.push({ id: this.id(), kind: "gold", x: e.x, z: e.z, value: this.rng.int(1, 4) });
    }
  }

  // ---------------------------------------------------------------- hero attacks
  /**
   * A hero attacks a target. `extraDice` are added on hit (Sneak Attack etc.). Handles advantage sources,
   * crit/fumble/graze, combos, on-hit items, and the Fighter's every-third-hit shove.
   */
  heroAttack(h: Hero, target: AnyActor, opts: { dice?: DiceExpr; type?: string; bonusDamage?: number; extraDice?: DiceExpr[]; melee: boolean; sneak?: boolean; adv?: number; label?: string; fire?: boolean; spell?: boolean } ): AttackResult | null {
    if (target.state === "dead" || target.kind === "summon") return null;
    const c = CLASSES[h.cls]!;
    const dice = opts.dice ?? parseDice(c.attack.damage);
    const dmgDice: DiceExpr = { ...dice, mod: dice.mod + damageMod(h) + (opts.bonusDamage ?? 0) + (opts.spell ? h.mods.spellDamage + (h.mods.sub.spellDamageMod ? abilityMod(h.scores.int) : 0) : 0) };
    const hidden = (h.buffs.hidden ?? 0) > 0;
    const ms = attackModeSources({
      attacker: h.conds, target: target.conds, melee: opts.melee, attackerHidden: hidden,
      allyNearTarget: this.allyNear(target, "party", h.id), helped: target.helped > 0,
    });
    let advantages = ms.advantages.length + (opts.adv ?? 0) + (h.buffs.reckless ? 1 : 0);
    if (h.markId === target.id && h.mods.sub.vow) advantages++;
    if (this.s.director.advantageNextFight && this.s.room && this.s.tick - this.s.room.startTick < sec(6)) advantages++;
    const disadvantages = ms.disadvantages.length;
    const extra = [...(opts.extraDice ?? [])];
    let sneakApplied = false;
    if (opts.sneak) {
      const eligible = advantages > 0 && disadvantages === 0 || ms.advantages.includes("flanked");
      if (eligible) {
        const n = Math.max(abilityParam("sneak_strike", "minDice", 1), Math.ceil(h.level / 2));
        extra.push({ count: n, sides: 6, mod: 0 });
        sneakApplied = true;
      }
    }
    if (h.markId === target.id && h.buffs.mark) extra.push(parseDice(h.cls === "warlock" ? abilityParam("hex", "dice", "1d6") : abilityParam("hunters_mark", "dice", "1d6")));
    if (h.mods.sub.colossus && target.hp < target.maxHp) extra.push({ count: 1, sides: 8, mod: 0 });
    const autoCrit = (h.mods.sub.hiddenCrit ?? 0) > 0 && hidden;
    const r = resolveAttack(this.rng, {
      bonus: attackBonus(h), ac: target.ac, damage: dmgDice, extraDice: extra, advantages, disadvantages,
      critOn: 20 + h.mods.critOn, inspiration: false, autoCrit: autoCrit || has(target.conds, "stunned") && opts.melee,
    });
    // Inspiration: spend it automatically to reroll a natural-1 or a near miss on a boss.
    let res = r;
    if (!r.hit && h.inspiration > 0 && (r.d20.natural === 1 || (this.isEnemy(target) && target.boss && r.total >= target.ac - 4))) {
      h.inspiration--;
      res = resolveAttack(this.rng, { bonus: attackBonus(h), ac: target.ac, damage: dmgDice, extraDice: extra, advantages, disadvantages, critOn: 20 + h.mods.critOn });
      this.popup("Inspiration!", "#e8cf4a", h.x, h.z);
    }
    if (hidden) delete h.buffs.hidden;
    const what = opts.label ?? (sneakApplied ? "Sneak Attack" : c.attack.anim === "cast" ? c.name + " bolt" : "Attack");
    const modeNote = [...ms.advantages, ...ms.disadvantages].join(", ");
    this.emit({ t: "roll", who: h.name, what: modeNote ? `${what} (${modeNote})` : what, d20: res.d20.rolls, kept: res.d20.natural, total: res.total, vs: target.ac, vsLabel: "AC", result: res.outcome, mode: res.d20.mode, damage: res.damage, x: target.x, z: target.z, slot: h.slot });
    let damage = res.outcome === "graze" && this.persona.noGraze ? 0 : res.damage;
    if (res.crit) {
      damage += h.mods.critDamage;
      h.stats.crits++;
      this.s.hitstop = Math.max(this.s.hitstop, BALANCE.hero.critFreezeTicks);
      this.emit({ t: "crit" });
      this.popup("CRIT!", "#e8cf4a", target.x, target.z, true);
      this.vfx("crit", target.x, target.z);
      this.s.director.delight = Math.min(DIRECTOR.delight.max, this.s.director.delight + DIRECTOR.delight.nat20);
      if (res.d20.natural === 20) this.narrate("nat20");
      if (h.mods.inspirationOnCrit) h.inspiration = Math.min(3, h.inspiration + 1);
    }
    if (res.stagger) {
      this.setState(h, "stagger", BALANCE.hero.staggerTicks, "hit");
      this.popup("Fumble!", "#a49eb6", h.x, h.z);
      this.narrate("nat1");
    }
    if (sneakApplied && res.hit) {
      this.popup("SNEAK ATTACK", "#5fc77a", target.x, target.z);
      if (ms.advantages.includes("prone target") || ms.advantages.includes("flanked")) this.combo("Sneak Attack combo");
    }
    if (res.hit) {
      for (const oh of h.mods.onHit) {
        if (oh.undeadOnly && !this.isUndead(target)) continue;
        const extraDmg = rollDice(this.rng, parseDice(oh.dice), { crit: res.crit }).total;
        this.damage(target, extraDmg, oh.type, h, { silent: true });
        if (oh.ignites) this.igniteAt(target.x, target.z, 1.5, h);
      }
    }
    this.damage(target, damage, opts.type ?? c.attack.type, h, { crit: res.crit, graze: res.outcome === "graze" });
    if (opts.fire && res.outcome !== "fumble") this.igniteAt(target.x, target.z, 1.2, h);
    if (res.hit || res.outcome === "graze") this.vfx(res.hit ? "hit" : "block", target.x, target.z, { y: 1, ally: false });
    if (res.hit && opts.melee) {
      h.attackCount++;
      if (CLASSES[h.cls]!.passives.includes("shove_every_third") && h.attackCount % abilityParam("shove_every_third", "every", 3) === 0) this.shove(h, target);
    }
    return res;
  }

  /** Push the target away; Strength save or Prone. */
  shove(src: AnyActor, target: AnyActor): void {
    if (target.state === "dead") return;
    const dx = target.x - src.x, dz = target.z - src.z;
    const d = Math.hypot(dx, dz) || 1;
    this.push(target, (dx / d) * BALANCE.hero.shoveDistance, (dz / d) * BALANCE.hero.shoveDistance);
    this.vfx("shove", target.x, target.z, { scale: 0.6 });
    const dc = 8 + src.prof + abilityMod(src.scores.str);
    if (!(this.isEnemy(target) && target.boss) && !this.saveFor(target, "str", dc)) this.addCondition(target, "prone", BALANCE.hero.proneTicks);
  }

  push(a: AnyActor, dx: number, dz: number): void {
    const room = this.s.room;
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const nx = a.x + dx / steps, nz = a.z + dz / steps;
      if (room && isBlocked(room, nx, nz)) break;
      a.x = nx;
      a.z = nz;
    }
  }

  combo(label: string): void {
    this.s.director.delight = Math.min(DIRECTOR.delight.max, this.s.director.delight + DIRECTOR.delight.combo);
    this.popup(label, "#f2b45a", 0, 0);
    this.narrate("combo");
  }

  // ---------------------------------------------------------------- area effects
  /** Area damage at a point: dodging heroes avoid it, everyone else saves for half. */
  areaDamage(x: number, z: number, radius: number, dice: DiceExpr, type: string, save: Ability, dc: number, source: AnyActor | null, opts: { hitTeam: Team | "both"; sculpt?: boolean; onFail?: { c: Condition; ticks: number }; push?: number; exclude?: number } ): number {
    let hits = 0;
    const full = rollDice(this.rng, dice).total;
    const targets: AnyActor[] = [];
    if (opts.hitTeam === "foe" || opts.hitTeam === "both") targets.push(...this.enemiesAlive());
    if (opts.hitTeam === "party" || opts.hitTeam === "both") targets.push(...this.s.heroes.filter((h) => !h.fallen));
    for (const t of targets) {
      if (t.id === opts.exclude) continue;
      if (this.dist(t, { x, z }) > radius + t.radius) continue;
      if (opts.sculpt && t.team === "party") continue;
      if (this.isHero(t) && t.iframes > 0) {
        this.popup("Dodged!", "#4f9be5", t.x, t.z);
        continue;
      }
      const saved = this.saveFor(t, save, dc);
      let dmg = saveDamage(full, saved);
      if (saved && this.isHero(t) && t.mods.evasion) dmg = 0;
      this.damage(t, dmg, type, source);
      if (!saved && opts.onFail) this.addCondition(t, opts.onFail.c, opts.onFail.ticks);
      if (opts.push) {
        const dx = t.x - x, dz = t.z - z, d = Math.hypot(dx, dz) || 1;
        this.push(t, (dx / d) * opts.push, (dz / d) * opts.push);
      }
      hits++;
    }
    return hits;
  }

  /** Fire touching a grease zone turns it into a burning field. Returns true if it ignited something. */
  igniteAt(x: number, z: number, r: number, source: AnyActor | null): boolean {
    let lit = false;
    for (const zn of this.s.zones) {
      if (zn.kind !== "grease") continue;
      if (this.dist(zn, { x, z }) > zn.r + r) continue;
      zn.kind = "fire";
      zn.life = sec(8);
      zn.dice = "2d4";
      zn.tickT = 0;
      lit = true;
      this.vfx("flames", zn.x, zn.z, { life: 8, scale: 0.5 });
    }
    if (lit) {
      this.popup("GREASE FIRE!", "#f2b45a", x, z, true);
      this.combo("Grease + Fire");
      this.emit({ t: "sfx", id: "ignite", x, z });
      if (source && this.isHero(source)) this.emit({ t: "achievement", id: "grease_fire" });
    }
    return lit;
  }

  addZone(kind: ZoneKind, x: number, z: number, r: number, ticks: number, owner: AnyActor | null, dice = "0", dc = 12): Zone {
    const zn: Zone = { id: this.id(), kind, x, z, r, life: ticks, owner: owner?.id ?? 0, team: owner?.team ?? "foe", tickT: 0, dice, dc };
    this.s.zones.push(zn);
    return zn;
  }

  /** Can this actor stand here (used by teleports). */
  standable(x: number, z: number): boolean {
    const room = this.s.room;
    if (!room) return true;
    const c = cellAt(room, x, z);
    return c === 0 || c === 3;
  }
}
