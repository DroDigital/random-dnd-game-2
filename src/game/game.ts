import { Assets } from "../render/assets";
import { GameRenderer } from "../render/renderer";
import { Draw, UI_W } from "../ui/draw";
import { Hud } from "../ui/hud";
import { drawMenu, wrapIndex, type MenuItem } from "../ui/menu";
import { lookTestSim } from "./looktest";
import { useAbility } from "../sim/abilities";
import { Sim } from "../sim/sim";
import { createRun, renownFor, type Command } from "../sim/run";
import { buildRoom } from "../sim/room";
import { makeHero, giveItem } from "../sim/hero";
import { nodeById } from "../sim/hexmap";
import { BTN, EMPTY_INPUT, type Hero, type InputFrame, type SimEvent, type SimState } from "../sim/types";
import { PAL, PLAYER_IDENTITY } from "../render/palette";
import type { RfrApi } from "../shared/api";
import { defaultSettings, type Settings } from "../shared/settings";
import { Input, MENU, buttonLabel, type DeviceId } from "../input/input";
import { Audio } from "../audio/audio";
import { ACTS, CARDS, CLASSES, DIRECTOR, ITEMS, META, SCENES, SUBCLASSES } from "../data";
import { freshMeta, migrateMeta, parseRunSave, personaUnlocked, storage, unlockedForRun, RUN_SAVE_VERSION, type MetaSave, type Plaque } from "./saves";

declare global {
  interface Window { rfr?: RfrApi }
}

const STEP = 1 / 60;
const PERSONAS = ["storyteller", "rules_lawyer", "chaos", "killer"] as const;

export interface GameOptions { look: string | null; demo?: string | null; seed?: string | null; speed?: string | null }

interface Player { slot: number; device: DeviceId; cls: string; background: string }
type Screen = "tavern" | "run" | "summary" | "shop" | "hall" | "credits";

/** Top-level game: owns the loop, the sim, the renderer, input, audio and UI. */
export class Game {
  readonly assets = new Assets();
  readonly ui: Draw;
  readonly uiCanvas: HTMLCanvasElement;
  renderer!: GameRenderer;
  hud: Hud;
  input!: Input;
  audio!: Audio;
  sim: Sim | null = null;
  settings: Settings = defaultSettings();
  meta: MetaSave = freshMeta();
  players: Player[] = [];
  screen: Screen = "tavern";
  private acc = 0;
  private last = 0;
  paused = false;
  frozen = false;
  private fpsT = 0;
  private fpsN = 0;
  showStats = false;
  ready = false;
  /** Every sim event of the current run (tests read this). */
  events: SimEvent[] = [];
  private pauseSel = 0;
  private tavernSel = 0;
  private mode: "lone" | "party" = "lone";
  private persona: (typeof PERSONAS)[number] = "storyteller";
  private killerTier = 1;
  private hasSave = false;
  private mapSel = 0;
  private sel = new Map<number, number>();
  private shopSel = 0;
  private skillSel = 0;
  private helping = new Set<number>();
  private summary: { victory: boolean; renown: number; lines: string[] } | null = null;
  private listSel = 0;
  private credits: string[] = [];
  private creditsScroll = 0;
  private startTime = performance.now();
  private demo: string | null = null;
  private lastPhase = "";
  private seedText = "";

  constructor(readonly screenCanvas: HTMLCanvasElement, readonly opts: GameOptions) {
    this.uiCanvas = document.createElement("canvas");
    this.ui = new Draw(this.uiCanvas);
    this.hud = new Hud(this.ui);
    this.demo = opts.demo ?? null;
  }

  // ------------------------------------------------------------------------------------- boot
  async start(): Promise<void> {
    if (window.rfr) this.settings = await window.rfr.getSettings();
    this.applyAccessibility();
    this.input = new Input(this.settings);
    this.audio = new Audio(this.settings);
    this.hud.onType = () => this.audio.sfx("type");
    window.addEventListener("keydown", (e) => this.onKeyDown(e));
    window.addEventListener("pointerdown", () => this.audio.unlock());
    this.loading(0);
    await this.assets.loadAll((p) => this.loading(p));
    this.renderer = new GameRenderer(this.screenCanvas, this.assets, this.uiCanvas);
    this.loadCanvas?.remove();
    this.loadCanvas = null;
    this.renderer.post.toggles.dither = this.settings.accessibility.dither;
    this.renderer.noShake = this.settings.accessibility.noShake;
    this.renderer.altColors = this.settings.accessibility.altIdentityColors;
    this.meta = migrateMeta(JSON.parse((await storage.read("meta")) ?? "null"));
    this.persona = (PERSONAS as readonly string[]).includes(this.meta.lastPersona) ? (this.meta.lastPersona as (typeof PERSONAS)[number]) : "storyteller";
    this.hasSave = !!parseRunSave(await storage.read("run"));
    if (this.opts.look) await this.lookTest(this.opts.look);
    else if (this.demo) this.startDemo(this.demo);
    else this.enterTavern();
    this.ready = true;
    (window as unknown as { __rfrReady: boolean }).__rfrReady = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private applyAccessibility(): void {
    const a = this.settings.accessibility;
    this.hud.altColors = a.altIdentityColors;
    this.hud.largeText = a.largeText;
  }

  private loadCanvas: HTMLCanvasElement | null = null;
  private loading(p: number): void {
    if (!this.loadCanvas) {
      this.loadCanvas = document.createElement("canvas");
      this.loadCanvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;image-rendering:pixelated;object-fit:contain;background:#14121c";
      document.body.appendChild(this.loadCanvas);
    }
    const c = this.loadCanvas;
    const g = c.getContext("2d");
    if (!g) return;
    c.width = 480;
    c.height = 270;
    g.fillStyle = PAL.ink;
    g.fillRect(0, 0, 480, 270);
    g.fillStyle = PAL.dusk;
    g.fillRect(140, 150, 200, 6);
    g.fillStyle = PAL.amber;
    g.fillRect(140, 150, 200 * p, 6);
    g.fillStyle = PAL.bone;
    g.font = "16px NinjaPixel, monospace";
    g.textAlign = "center";
    g.fillText("Roll for Ruin", 240, 120);
  }

  private async lookTest(mode: string): Promise<void> {
    this.screen = "run";
    // look=on|off|fireball (Act I room) or look=act2|act3|finale[-boss] for the later acts.
    const m = /^(act2|act3|finale)(-boss)?$/.exec(mode);
    const act = m ? { act2: 1, act3: 2, finale: 3 }[m[1] as "act2"] : 0;
    this.sim = lookTestSim(7, act, !!m?.[2]);
    if (mode === "off") {
      const t = this.renderer.post.toggles;
      t.outline = t.tiltShift = t.quantize = t.dither = false;
    }
    if (mode === "fireball") {
      for (let i = 0; i < 70; i++) this.stepSim([]);
      const wiz = this.sim.s.heroes.find((h) => h.cls === "wizard")!;
      useAbility(this.sim.world, wiz, "fireball", "action");
      const fb = this.sim.s.projectiles.find((p) => p.kind === "fireball");
      const half = fb ? Math.max(4, Math.floor(fb.life * 0.55)) : 10;
      for (let k = 0; k < half; k++) this.stepSim([]);
    } else {
      for (let i = 0; i < 90; i++) this.stepSim([]);
    }
    this.frozen = true;
  }

  /** Autoplay demo (tests): an all-AI party plays a run with the full UI. */
  private startDemo(kind: string): void {
    const n = Math.max(1, Math.min(4, Number(kind) || 4));
    const classes = ["fighter", "wizard", "rogue", "cleric"];
    const s = createRun({ seed: Number(this.opts.seed ?? 1), persona: "storyteller", mode: n === 1 ? "lone" : "coop", heroes: classes.slice(0, n).map((cls, slot) => ({ slot, cls, ctrl: "ai" as const })) });
    this.sim = new Sim(s);
    this.screen = "run";
    this.players = [];
  }

  // ------------------------------------------------------------------------------------- tavern
  private enterTavern(): void {
    this.screen = "tavern";
    this.summary = null;
    this.tavernSel = 0;
    this.rebuildTavern();
    this.audio.playMusic("theme_plain");
  }

  private applyMetaVisuals(): void {
    const decor = META.unlocks.filter((u) => u.kind === "decor" && this.meta.unlocked.includes(u.id)).map((u) => u.ref);
    this.renderer.tavernDecor = decor;
    this.renderer.setDiceSkin(META.dice[this.meta.diceSkin]?.color ?? null);
  }

  private rebuildTavern(): void {
    this.applyMetaVisuals();
    const old = this.sim?.s;
    const s = createRun({ seed: 1, persona: "storyteller", mode: "coop", heroes: this.players.map((p) => ({ slot: p.slot, cls: p.cls, ctrl: "human" as const })) });
    const sim = new Sim(s);
    s.room = buildRoom("tavern", "tavern", sim.world.rng, null, 0);
    s.room.cleared = true;
    s.run.phase = "room";
    s.heroes.forEach((h, i) => {
      const prev = old?.heroes.find((o) => o.slot === h.slot);
      const sp = s.room!.heroSpawns[i % s.room!.heroSpawns.length]!;
      h.x = prev?.x ?? sp.x;
      h.z = prev?.z ?? sp.z;
    });
    this.sim = sim;
  }

  private unlockedClasses(): string[] {
    return unlockedForRun(this.meta).classes;
  }

  private joinDevice(dev: DeviceId): boolean {
    if (this.players.some((p) => p.device === dev) || this.players.length >= 4) return false;
    const slot = [0, 1, 2, 3].find((i) => !this.players.some((p) => p.slot === i))!;
    const used = new Set(this.players.map((p) => p.cls));
    const cls = this.unlockedClasses().find((c) => !used.has(c)) ?? "fighter";
    this.players.push({ slot, device: dev, cls, background: "none" });
    this.players.sort((a, b) => a.slot - b.slot);
    this.input.takeMenu(dev); // the join press must not also confirm a menu item
    this.audio.sfx("join");
    return true;
  }

  private checkJoins(): DeviceId[] {
    const joined: DeviceId[] = [];
    for (const dev of this.input.connectedDevices()) {
      if (this.players.some((p) => p.device === dev)) continue;
      if (this.input.takeJoin(dev)) joined.push(dev);
    }
    return joined;
  }

  private tavernItems(): MenuItem[] {
    const items: MenuItem[] = [];
    items.push({ label: "Start a new run", disabled: this.players.length === 0, hint: this.players.length ? "Begin Act I: The Hollow Crypt." : "Join first: A/Start on a controller, Enter or Right Shift on the keyboard." });
    items.push({ label: "Resume saved run", disabled: !this.hasSave, hint: "Continue from the last map you reached." });
    const p1 = this.players[0];
    if (p1) items.push({ label: "P1 class", value: CLASSES[p1.cls]!.name, hint: "Other players change class with Left/Right on their own device." });
    if (p1) items.push({ label: "P1 background", value: META.backgrounds[p1.background]?.name ?? "Wanderer", hint: "Backgrounds are small perks unlocked with Renown. Other players: Up/Down on their own device." });
    if (this.players.length === 1) items.push({ label: "Solo mode", value: this.mode === "lone" ? "Lone Hero" : "Party (3 AI)", hint: this.mode === "lone" ? "One hero, solo-tuned encounters and an extra death save." : "Three AI companions. D-pad: Up Follow, Right Focus, Down Hold, Left Defensive." });
    items.push({ label: "Dungeon Master", value: DIRECTOR.personas[this.persona].name, hint: DIRECTOR.personas[this.persona].desc + (personaUnlocked(this.meta, this.persona) ? "" : " (locked: buy in the Renown shop)") });
    if (this.persona === "killer") items.push({ label: "Killer tier", value: String(this.killerTier), hint: "Each tier stacks more budget, HP and damage." });
    items.push({ label: `Renown shop (${this.meta.renown})`, hint: "Spend Renown on classes, backgrounds, DMs, items, dice and decor." });
    items.push({ label: "Hall of Heroes", hint: "Plaques for the fallen. Their best items return as Heirlooms." });
    items.push({ label: "Credits & licenses" });
    items.push({ label: "Quit" });
    return items;
  }

  private updateTavern(): void {
    for (const dev of this.checkJoins()) {
      this.joinDevice(dev);
      this.rebuildTavern();
    }
    // Per-player class cycling for P2..P4 (left/right on their own device).
    for (const p of this.players.slice(1)) {
      const m = this.input.takeMenu(p.device);
      if (m & (MENU.left | MENU.right)) this.cycleClass(p, m & MENU.right ? 1 : -1);
      if (m & (MENU.up | MENU.down)) this.cycleBackground(p, m & MENU.down ? 1 : -1);
      if (m & MENU.back) {
        this.players = this.players.filter((x) => x !== p);
        this.rebuildTavern();
      }
    }
    const p1 = this.players[0];
    const dev = p1?.device ?? "kbA";
    const m = this.input.takeMenu(dev) | (p1 ? 0 : this.input.takeMenu("kbB"));
    const items = this.tavernItems();
    if (m & MENU.up) { this.tavernSel = wrapIndex(this.tavernSel - 1, items.length); this.audio.sfx("ui_move"); }
    if (m & MENU.down) { this.tavernSel = wrapIndex(this.tavernSel + 1, items.length); this.audio.sfx("ui_move"); }
    const it = items[this.tavernSel];
    if (!it) return;
    const dir = m & MENU.right ? 1 : m & MENU.left ? -1 : 0;
    if (dir) {
      if (it.label === "P1 class" && p1) this.cycleClass(p1, dir);
      if (it.label === "P1 background" && p1) this.cycleBackground(p1, dir);
      if (it.label === "Solo mode") this.mode = this.mode === "lone" ? "party" : "lone";
      if (it.label === "Dungeon Master") this.persona = PERSONAS[wrapIndex(PERSONAS.indexOf(this.persona) + dir, PERSONAS.length)]!;
      if (it.label === "Killer tier") this.killerTier = Math.max(1, Math.min(10, this.killerTier + dir));
      this.audio.sfx("ui_move");
    }
    if (m & MENU.confirm && !it.disabled && p1) {
      this.audio.sfx("ui_confirm");
      if (it.label === "Start a new run") {
        if (!personaUnlocked(this.meta, this.persona)) this.hud.narrate("That Dungeon Master isn't unlocked yet.");
        else void this.startRun();
      } else if (it.label === "Resume saved run") void this.resumeRun();
      else if (it.label.startsWith("Renown shop")) { this.screen = "shop"; this.listSel = 0; }
      else if (it.label === "Hall of Heroes") { this.screen = "hall"; this.listSel = 0; }
      else if (it.label === "Credits & licenses") void this.openCredits();
      else if (it.label === "Quit") void window.rfr?.quit();
    }
  }

  private cycleBackground(p: Player, dir: number): void {
    const bgs = unlockedForRun(this.meta).backgrounds;
    p.background = bgs[wrapIndex(bgs.indexOf(p.background) + dir, bgs.length)]!;
  }

  private cycleClass(p: Player, dir: number): void {
    const cl = this.unlockedClasses();
    p.cls = cl[wrapIndex(cl.indexOf(p.cls) + dir, cl.length)]!;
    this.rebuildTavern();
  }

  private async startRun(): Promise<void> {
    const unlocked = unlockedForRun(this.meta);
    const solo = this.players.length === 1;
    const mode = solo ? this.mode : "coop";
    const heroes: { slot: number; cls: string; ctrl: "human" | "ai"; background: string }[] = this.players.map((p) => ({ slot: p.slot, cls: p.cls, ctrl: "human", background: p.background }));
    if (solo && mode === "party") {
      const others = ["fighter", "wizard", "rogue", "cleric"].filter((c) => c !== this.players[0]!.cls).slice(0, 3);
      others.forEach((cls, i) => heroes.push({ slot: i + 1, cls, ctrl: "ai" as const, background: "none" }));
    }
    const seed = (Date.now() ^ (performance.now() * 1000)) >>> 0;
    this.seedText = seed.toString(16).toUpperCase();
    const s = createRun({ seed, persona: this.persona, killerTier: this.persona === "killer" ? this.killerTier : 0, mode, heroes, unlocked, startGold: unlocked.perm.startGold ?? 0 });
    // Start pool items (unlocks and heirlooms) are dealt to the party.
    const pool = [...unlocked.items];
    for (const h of s.heroes) {
      if (!pool.length) break;
      const it = pool.shift()!;
      giveItem(h, it, unlocked.perm);
      if (this.meta.heirlooms.includes(it)) this.meta.heirlooms = this.meta.heirlooms.filter((x) => x !== it);
    }
    this.meta.lastPersona = this.persona;
    this.meta.stats.runs++;
    await this.saveMeta();
    this.sim = new Sim(s);
    this.events = [];
    this.screen = "run";
    this.hud.log = [];
    this.renderer.prev.clear();
    this.input.flushMenus();
  }

  private async resumeRun(): Promise<void> {
    const save = parseRunSave(await storage.read("run"));
    if (!save) return;
    this.sim = new Sim(save.state);
    // Rebind saved devices; anyone missing falls back to the first free device or the AI.
    const devs = this.input.connectedDevices();
    this.players = [];
    for (const h of save.state.heroes) {
      if (h.ctrl !== "human") continue;
      const want = save.devices[h.slot] as DeviceId | undefined;
      const dev = want && devs.includes(want) ? want : devs.find((d) => !this.players.some((p) => p.device === d));
      if (dev) this.players.push({ slot: h.slot, device: dev, cls: h.cls, background: h.background });
      else h.ctrl = "ai";
    }
    this.screen = "run";
    this.renderer.prev.clear();
    this.input.flushMenus();
  }

  private async saveRun(): Promise<void> {
    if (!this.sim || this.demo) return;
    const devices: string[] = [];
    for (const p of this.players) devices[p.slot] = p.device;
    await storage.write("run", JSON.stringify({ version: RUN_SAVE_VERSION, savedAt: new Date().toISOString(), state: this.sim.s, devices }));
    this.hasSave = true;
  }

  private async saveMeta(): Promise<void> {
    await storage.write("meta", JSON.stringify(this.meta));
  }

  private async openCredits(): Promise<void> {
    this.screen = "credits";
    this.creditsScroll = 0;
    let text: string;
    try {
      text = window.rfr ? await window.rfr.getCredits() : await (await fetch("./CREDITS.md")).text();
    } catch {
      text = "See CREDITS.md";
    }
    this.credits = text.split("\n").flatMap((l) => (l.trim() ? this.ui.wrap(l.replace(/[#|*`]/g, "").trim(), 440, 8) : [""]));
  }

  // ------------------------------------------------------------------------------------- run
  private deviceOf(slot: number): DeviceId | null {
    return this.players.find((p) => p.slot === slot)?.device ?? null;
  }

  private gatherInputs(): (InputFrame | undefined)[] {
    const out: (InputFrame | undefined)[] = [];
    const toggle = this.settings.accessibility.holdMode === "toggle";
    for (const p of this.players) out[p.slot] = this.input.frame(p.device, toggle);
    return out;
  }

  private stepSim(inputs: (InputFrame | undefined)[], cmds: Command[] = []): void {
    if (!this.sim) return;
    const r = this.renderer;
    for (const a of [...this.sim.s.heroes, ...this.sim.s.enemies, ...this.sim.s.summons]) r.prev.set(a.id, { x: a.x, z: a.z, facing: a.facing });
    for (const p of this.sim.s.projectiles) r.prev.set(p.id, { x: p.x, z: p.z, facing: 0 });
    const ev = this.sim.step(inputs, cmds);
    this.handleEvents(ev);
  }

  private handleEvents(ev: SimEvent[]): void {
    if (!ev.length) return;
    this.renderer.onEvents(ev);
    this.hud.onEvents(ev, this.renderer);
    for (const e of ev) {
      switch (e.t) {
        case "sfx": this.audio.sfx(e.id); break;
        case "crit": this.audio.sfx("crit"); this.audio.duckMusic(0.35, 0.6); break;
        case "initiative": this.audio.holdDuck(e.on); if (e.on) this.audio.sfx("initiative"); break;
        case "music": this.audio.playMusic(e.track); break;
        case "roll": this.audio.sfx("dice"); break;
        case "achievement": void window.rfr?.steamAchievement(e.id); break;
      }
    }
    if (this.screen === "run" && this.events.length < 200000) this.events.push(...ev);
  }

  /** Commands from menus during non-room phases. */
  private runMenus(): Command[] {
    const s = this.sim!.s;
    const run = s.run;
    const cmds: Command[] = [];
    const humans = s.heroes.filter((h) => h.ctrl === "human");
    const p1dev = this.deviceOf(humans[0]?.slot ?? 0) ?? "kbA";
    const menuOf = (h: Hero): number => {
      const dev = this.deviceOf(h.slot);
      return dev ? this.input.takeMenu(dev) : 0;
    };
    if (this.demo) return [];
    switch (run.phase) {
      case "actIntro": {
        const m = this.input.takeMenu(p1dev);
        if (m & (MENU.confirm | MENU.start)) cmds.push({ c: "continue" });
        break;
      }
      case "map": {
        const cur = nodeById(run.map, run.map.current);
        const m = this.input.takeMenu(p1dev);
        const n = cur.next.length;
        if (m & (MENU.left | MENU.up)) { this.mapSel = wrapIndex(this.mapSel - 1, n); this.audio.sfx("ui_move"); }
        if (m & (MENU.right | MENU.down)) { this.mapSel = wrapIndex(this.mapSel + 1, n); this.audio.sfx("ui_move"); }
        if (m & MENU.confirm && n) {
          cmds.push({ c: "chooseNode", node: cur.next[Math.min(this.mapSel, n - 1)]! });
          this.mapSel = 0;
          this.audio.sfx("ui_confirm");
        }
        break;
      }
      case "levelup":
        for (const h of humans) {
          const m = menuOf(h);
          const cards = run.pendingCards[h.id] ?? run.pendingSubclass[h.id];
          if (!cards) continue;
          let i = this.sel.get(h.id) ?? 0;
          if (m & MENU.left) i = wrapIndex(i - 1, cards.length);
          if (m & MENU.right) i = wrapIndex(i + 1, cards.length);
          this.sel.set(h.id, i);
          if (m & MENU.confirm) {
            cmds.push(run.pendingCards[h.id] ? { c: "card", hero: h.id, card: cards[i]! } : { c: "subclass", hero: h.id, sub: cards[i]! });
            this.sel.delete(h.id);
            this.audio.sfx("ui_confirm");
          }
        }
        break;
      case "campfire": {
        for (const dev of this.checkJoins()) {
          if (this.joinDevice(dev)) {
            const p = this.players[this.players.length - 1]!;
            const used = new Set(s.heroes.map((h) => h.cls));
            p.cls = this.unlockedClasses().find((c) => !used.has(c)) ?? p.cls;
            cmds.push({ c: "join", slot: p.slot, cls: p.cls, ctrl: "human" });
          }
        }
        for (const h of humans) {
          if (run.campfireDone[h.id]) {
            if (h === humans[0] && menuOf(h) & MENU.confirm) cmds.push({ c: "continue" });
            continue;
          }
          const m = menuOf(h);
          let i = this.sel.get(h.id) ?? 0;
          if (m & MENU.up) i = wrapIndex(i - 1, 3);
          if (m & MENU.down) i = wrapIndex(i + 1, 3);
          this.sel.set(h.id, i);
          if (m & MENU.confirm) {
            const prim = CLASSES[h.cls]!.attack.ability as "str";
            cmds.push(i === 0 ? { c: "campfire", hero: h.id, choice: "rest" } : { c: "campfire", hero: h.id, choice: "upgrade", ability: i === 1 ? prim : "con" });
            this.audio.sfx("ui_confirm");
          }
        }
        break;
      }
      case "merchant": {
        const stock = [...run.merchantStock, "potion_healing"];
        for (const h of humans) {
          const m = menuOf(h);
          if (m & MENU.up) this.shopSel = wrapIndex(this.shopSel - 1, stock.length + 1);
          if (m & MENU.down) this.shopSel = wrapIndex(this.shopSel + 1, stock.length + 1);
          if (m & MENU.confirm) {
            if (this.shopSel >= stock.length) cmds.push({ c: "leave" });
            else cmds.push({ c: "buy", hero: h.id, item: stock[this.shopSel]! });
            this.audio.sfx("coin");
          }
          if (m & MENU.back && h === humans[0]) cmds.push({ c: "leave" });
        }
        break;
      }
      case "skill": {
        const sc = SCENES.scenes.find((x) => x.id === run.scene?.id);
        if (!sc) break;
        for (const h of humans.slice(1)) if (menuOf(h) & MENU.help) this.helping.add(h.id);
        const m = this.input.takeMenu(p1dev);
        if (run.scene?.result) {
          if (m & MENU.confirm) cmds.push({ c: "continue" });
          break;
        }
        if (m & MENU.up) this.skillSel = wrapIndex(this.skillSel - 1, sc.options.length);
        if (m & MENU.down) this.skillSel = wrapIndex(this.skillSel + 1, sc.options.length);
        if (m & MENU.help && humans.length === 1 && s.heroes.length > 1) this.helping.add(s.heroes.find((x) => x.ctrl === "ai")!.id);
        if (m & MENU.confirm) {
          const opt = sc.options[this.skillSel]!;
          // The hero best at the skill rolls; anyone who pressed Help gives advantage.
          let best = humans[0] ?? s.heroes[0]!;
          for (const h of s.heroes.filter((x) => !x.fallen)) if (bonusFor(h, opt.skill) > bonusFor(best, opt.skill)) best = h;
          const helper = [...this.helping].find((id) => id !== best.id) ?? null;
          cmds.push({ c: "skill", option: this.skillSel, hero: best.id, helper });
          this.helping.clear();
        }
        break;
      }
      case "loot": {
        const lv = run.loot[0];
        if (!lv) break;
        for (const h of humans) {
          if (lv.votes[h.id] !== null) continue;
          const m = menuOf(h);
          if (m & MENU.confirm) cmds.push({ c: "vote", hero: h.id, vote: "need" });
          else if (m & MENU.alt) cmds.push({ c: "vote", hero: h.id, vote: "greed" });
          else if (m & MENU.back) cmds.push({ c: "vote", hero: h.id, vote: "pass" });
        }
        break;
      }
    }
    return cmds;
  }

  private async endRun(): Promise<void> {
    const s = this.sim!.s;
    const victory = !!s.run.ended?.victory;
    const renown = renownFor(s);
    this.meta.renown += renown;
    this.meta.totalRenown += renown;
    if (victory) this.meta.stats.wins++;
    this.meta.stats.bestAct = Math.max(this.meta.stats.bestAct, s.run.act + 1);
    if (victory && s.run.persona === "killer") this.meta.stats.killerTier = Math.max(this.meta.stats.killerTier, s.run.killerTier);
    const lines = [`Renown earned: ${renown}`, `Rooms cleared: ${s.run.nodesCleared}`, `Bosses beaten: ${s.run.bossesBeaten}`];
    // Hall of Heroes: the fallen get a plaque; their best item may return as an Heirloom.
    const fallen = victory ? s.heroes.filter((h) => h.fallen) : s.heroes;
    for (const h of fallen) {
      const best = [...h.items].sort((a, b) => rarityRank(ITEMS.items[b]!.rarity) - rarityRank(ITEMS.items[a]!.rarity))[0] ?? null;
      const plaque: Plaque = { name: `${PLAYER_IDENTITY[h.slot]!.name} ${CLASSES[h.cls]!.name}`, cls: h.cls, level: h.level, act: s.run.act + 1, cause: victory ? "Fell in glory" : "Total party kill", date: new Date().toISOString().slice(0, 10), bestItem: best, kills: h.stats.kills };
      this.meta.hall.unshift(plaque);
      if (best && this.meta.heirlooms.length < 5) this.meta.heirlooms.push(best);
      lines.push(`${plaque.name} (lvl ${h.level}) joins the Hall of Heroes${best ? `; heirloom: ${ITEMS.items[best]!.name}` : ""}.`);
    }
    this.meta.hall = this.meta.hall.slice(0, 40);
    await this.saveMeta();
    await storage.remove("run");
    this.hasSave = false;
    this.summary = { victory, renown, lines };
    this.screen = "summary";
  }

  // ------------------------------------------------------------------------------------- keys
  private onKeyDown(e: KeyboardEvent): void {
    this.audio.unlock();
    // Hold Shift while the game starts to reopen the launcher.
    if ((e.key === "Shift") && performance.now() - this.startTime < 1500 && window.rfr && !this.opts.look) {
      void window.rfr.openLauncher();
      return;
    }
    if (!this.renderer) return;
    const t = this.renderer.post.toggles;
    switch (e.code) {
      case "F1": t.outline = !t.outline; break;
      case "F2": t.tiltShift = !t.tiltShift; break;
      case "F3": t.ui = !t.ui; break;
      case "F4": t.quantize = !t.quantize; break;
      case "F5": t.dither = !t.dither; break;
      case "F9": this.showStats = !this.showStats; break;
      case "F12": void this.screenshot(); break;
      default: return;
    }
    e.preventDefault();
  }

  async screenshot(): Promise<string> {
    const url = this.screenCanvas.toDataURL("image/png");
    const b64 = url.slice(url.indexOf(",") + 1);
    const path = window.rfr ? await window.rfr.screenshot(b64) : url;
    this.hud.narrate("Screenshot saved.");
    return path;
  }

  // ------------------------------------------------------------------------------------- pause
  private pauseItems(): MenuItem[] {
    const a = this.settings.accessibility, au = this.settings.audio;
    return [
      { label: "Resume" },
      { label: "Music", value: `${Math.round(au.music * 100)}%` },
      { label: "Sound effects", value: `${Math.round(au.sfx * 100)}%` },
      { label: "Combat speed", value: `${Math.round(a.combatSpeed * 100)}%` },
      { label: "Screen shake", value: a.noShake ? "Off" : "On" },
      { label: "Large text", value: a.largeText ? "On" : "Off" },
      { label: "Hold actions", value: a.holdMode === "hold" ? "Hold" : "Toggle" },
      { label: "Player colours", value: a.altIdentityColors ? "Alternative" : "Default" },
      { label: "Save and return to tavern" },
      { label: "Return to launcher", disabled: !window.rfr },
      { label: "Quit game" },
    ];
  }

  private async updatePause(): Promise<void> {
    const dev = this.players[0]?.device ?? "kbA";
    const m = this.input.takeMenu(dev) | (this.input.escPressed ? MENU.back : 0);
    this.input.escPressed = false;
    const items = this.pauseItems();
    if (m & MENU.up) this.pauseSel = wrapIndex(this.pauseSel - 1, items.length);
    if (m & MENU.down) this.pauseSel = wrapIndex(this.pauseSel + 1, items.length);
    const it = items[this.pauseSel]!;
    const dir = m & MENU.right ? 1 : m & MENU.left ? -1 : 0;
    const a = this.settings.accessibility, au = this.settings.audio;
    let changed = false;
    if (dir) {
      changed = true;
      switch (it.label) {
        case "Music": au.music = Math.max(0, Math.min(1, Math.round((au.music + dir * 0.1) * 10) / 10)); break;
        case "Sound effects": au.sfx = Math.max(0, Math.min(1, Math.round((au.sfx + dir * 0.1) * 10) / 10)); break;
        case "Combat speed": a.combatSpeed = Math.max(0.7, Math.min(1, Math.round((a.combatSpeed + dir * 0.05) * 100) / 100)); break;
        case "Screen shake": a.noShake = !a.noShake; break;
        case "Large text": a.largeText = !a.largeText; break;
        case "Hold actions": a.holdMode = a.holdMode === "hold" ? "toggle" : "hold"; break;
        case "Player colours": a.altIdentityColors = !a.altIdentityColors; break;
        default: changed = false;
      }
    }
    if (changed) {
      this.audio.applyVolumes(this.settings);
      this.applyAccessibility();
      this.renderer.noShake = a.noShake;
      if (window.rfr) this.settings = await window.rfr.setSettings(this.settings);
    }
    if (m & MENU.back || (m & MENU.start)) this.paused = false;
    if (m & MENU.confirm) {
      if (it.label === "Resume") this.paused = false;
      else if (it.label === "Save and return to tavern") {
        if (this.sim && !this.sim.s.run.ended) await this.saveRun();
        this.paused = false;
        this.enterTavern();
      } else if (it.label === "Return to launcher") {
        if (this.sim && this.screen === "run" && !this.sim.s.run.ended) await this.saveRun();
        void window.rfr?.openLauncher();
      } else if (it.label === "Quit game") {
        if (this.sim && this.screen === "run" && !this.sim.s.run.ended) await this.saveRun();
        void window.rfr?.quit();
      }
    }
  }

  // ------------------------------------------------------------------------------------- loop
  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fpsT += dt;
    this.fpsN++;
    if (this.fpsT >= 0.5) {
      this.renderer.stats.fps = this.fpsN / this.fpsT;
      this.fpsT = 0;
      this.fpsN = 0;
    }
    this.input.poll(now);
    if (this.input.tabPressed) {
      this.hud.showLog = !this.hud.showLog;
      this.input.tabPressed = false;
    }
    void this.update(dt);
    const W = Math.max(1, Math.floor(this.screenCanvas.clientWidth * devicePixelRatio));
    const H = Math.max(1, Math.floor(this.screenCanvas.clientHeight * devicePixelRatio));
    const alpha = this.frozen || this.paused ? 1 : this.acc / STEP;
    const s = this.sim?.s;
    if (s) {
      const onMap = s.run.phase === "map" || (s.run.phase === "actIntro" && this.screen === "run") || (s.run.phase === "levelup" && !s.room);
      if (onMap && this.screen === "run") {
        const cur = nodeById(s.run.map, s.run.map.current);
        this.renderer.showMap(s, s.run.phase === "map" ? cur.next[this.mapSel] ?? null : null, this.paused ? 0 : dt);
      } else if (s.room) {
        this.renderer.showRoom();
        this.renderer.sync(s, alpha, this.frozen || this.paused ? 0 : dt);
        if (this.opts.look) this.renderer.settleRoom();
        this.renderer.frame(s, 3.5, 12, 20, this.frozen ? 1 : dt);
      }
    }
    this.hud.update(this.paused ? 0 : dt);
    this.drawUi();
    this.renderer.render(W, H, dt, true);
    requestAnimationFrame((t) => this.frame(t));
  }

  private async update(dt: number): Promise<void> {
    if (!this.ready) return;
    if (this.paused) {
      await this.updatePause();
      return;
    }
    const startDev = this.screen === "run" && this.sim?.s.run.phase === "room" ? this.players.find((p) => (this.input.peekMenu(p.device) & MENU.start) !== 0) : undefined;
    if (startDev) this.input.takeMenu(startDev.device);
    const pausePressed = !!startDev;
    if (this.screen === "run" && this.input.escPressed && !this.frozen) {
      this.input.escPressed = false;
      this.input.flushMenus(); // the same Esc must not also close the menu
      this.paused = true;
      this.pauseSel = 0;
      return;
    }
    if (pausePressed && this.screen === "run" && !this.frozen) {
      this.input.flushMenus();
      this.paused = true;
      this.pauseSel = 0;
      return;
    }
    this.input.escPressed = false;
    switch (this.screen) {
      case "tavern":
        this.updateTavern();
        this.tickSim(dt, []);
        break;
      case "run": {
        if (this.frozen || !this.sim) break;
        const s = this.sim.s;
        if (s.run.ended) {
          if (!this.summary) await this.endRun();
          break;
        }
        const cmds = this.runMenus();
        this.tickSim(dt, cmds);
        if (s.run.phase !== this.lastPhase) {
          this.lastPhase = s.run.phase;
          this.input.flushMenus();
          if (s.run.phase === "map") void this.saveRun();
          if (s.run.phase === "actIntro" || s.run.phase === "map") this.audio.playMusic(ACTS.acts[s.run.act]!.music);
        }
        break;
      }
      case "summary": {
        const dev = this.players[0]?.device ?? "kbA";
        if (this.input.takeMenu(dev) & MENU.confirm || this.demo) {
          if (!this.demo) this.enterTavern();
        }
        break;
      }
      case "shop": this.updateShop(); break;
      case "hall": case "credits": {
        const m = this.input.takeMenu(this.players[0]?.device ?? "kbA") | this.input.takeMenu("kbA");
        if (m & MENU.down) this.creditsScroll++;
        if (m & MENU.up) this.creditsScroll = Math.max(0, this.creditsScroll - 1);
        if (m & (MENU.back | MENU.confirm)) this.enterTavern();
        break;
      }
    }
  }

  private tickSim(dt: number, cmds: Command[]): void {
    if (!this.sim) return;
    const speed = this.demo ? Math.max(1, Number(this.opts.speed ?? 1)) : 1;
    const maxSteps = 8 * speed;
    this.acc += dt * this.settings.accessibility.combatSpeed * speed;
    let first = true;
    let steps = 0;
    while (this.acc >= STEP && steps < maxSteps) {
      const inputs = this.screen === "run" || this.screen === "tavern" ? this.gatherInputs() : [];
      const extra = this.demo && this.sim.s.tick % 30 === 0 ? botCommandsLazy(this.sim.s) : [];
      this.stepSim(inputs, first ? [...cmds, ...extra] : extra);
      first = false;
      this.acc -= STEP;
      steps++;
    }
    if (steps >= maxSteps) this.acc = 0;
    if (first && cmds.length) this.stepSim([], cmds); // menus must not wait for the next tick
  }

  private updateShop(): void {
    const dev = this.players[0]?.device ?? "kbA";
    const m = this.input.takeMenu(dev) | this.input.takeMenu("kbA");
    const list = META.unlocks;
    if (m & MENU.up) this.listSel = wrapIndex(this.listSel - 1, list.length);
    if (m & MENU.down) this.listSel = wrapIndex(this.listSel + 1, list.length);
    if (m & MENU.back) this.enterTavern();
    if (m & MENU.confirm) {
      const u = list[this.listSel]!;
      if (!this.meta.unlocked.includes(u.id) && this.meta.renown >= u.cost) {
        this.meta.renown -= u.cost;
        this.meta.unlocked.push(u.id);
        if (u.kind === "dice") this.meta.diceSkin = u.ref;
        this.applyMetaVisuals();
        this.audio.sfx("loot");
        void this.saveMeta();
      } else this.audio.sfx("ui_back");
    }
  }

  // ------------------------------------------------------------------------------------- drawing
  private drawUi(): void {
    const d = this.ui;
    d.clear();
    d.scale = 1;
    const s = this.sim?.s;
    if (this.screen === "tavern") this.drawTavern();
    else if (this.screen === "run" && s) this.drawRun(s);
    else if (this.screen === "summary") this.drawSummary();
    else if (this.screen === "shop") this.drawShop();
    else if (this.screen === "hall") this.drawHall();
    else if (this.screen === "credits") this.drawCredits();
    this.hud.drawNarration();
    if (this.paused) {
      d.dim();
      drawMenu(d, 150, 40, 180, "Paused", this.pauseItems(), this.pauseSel, this.settings.accessibility.largeText ? 12 : 8);
    }
    if (this.showStats) {
      const st = this.renderer.stats;
      d.panel(4, 4, 150, 62);
      d.text(`FPS ${st.fps.toFixed(0)}  frame ${st.frameMs.toFixed(1)}ms`, 10, 10);
      d.text(`calls ${st.calls} tris ${st.tris}`, 10, 20);
      d.text(`lights ${this.renderer.lightsUsed}/8  vfx ${this.renderer.vfx.count}`, 10, 30);
      d.text(`tick ${s?.tick ?? 0} actors ${(s?.heroes.length ?? 0) + (s?.enemies.length ?? 0)}`, 10, 40);
      d.text(`seed ${this.seedText || s?.run.seed}`, 10, 50);
    }
  }

  private drawTavern(): void {
    const d = this.ui;
    d.text("Roll for Ruin", UI_W / 2, 26, PAL.amber, 16, "center");
    d.text("a tabletop roguelite", UI_W / 2, 44, PAL.fog, 8, "center");
    drawMenu(d, 8, 60, 190, "The Tavern", this.tavernItems(), this.tavernSel, this.settings.accessibility.largeText ? 12 : 8);
    // Party slots.
    for (let i = 0; i < 4; i++) {
      const p = this.players.find((x) => x.slot === i);
      const x = 212 + i * 66, y = 196;
      d.panel(x, y, 62, 50, p ? "nine_path_4" : "nine_path_4");
      const id = PLAYER_IDENTITY[i]!;
      d.shape(id.shape, x + 9, y + 9, 4, this.hud.idColor(i));
      d.text(id.name, x + 16, y + 4, this.hud.idColor(i), 8);
      if (p) {
        d.text(CLASSES[p.cls]!.name, x + 6, y + 18, PAL.bone, 8);
        d.text(p.device.startsWith("pad") ? "Controller" : p.device === "kbA" ? "Keys WASD" : "Keys Arrows", x + 6, y + 30, PAL.fog, 8);
        if (i > 0) d.text("◀ ▶ class", x + 6, y + 40, PAL.mist, 8);
      } else {
        d.text("Press", x + 6, y + 18, PAL.fog, 8);
        d.text("A/Start", x + 6, y + 28, PAL.fog, 8);
        d.text("Enter/RShift", x + 6, y + 38, PAL.mist, 8);
      }
    }
    if (!this.input.hasPads()) d.text("Controllers appear after their first button press.", 212, 184, PAL.mist, 8);
    d.text(`Renown ${this.meta.renown}   Runs ${this.meta.stats.runs}   Wins ${this.meta.stats.wins}`, 470, 4, PAL.gold, 8, "right");
  }

  private drawRun(s: SimState): void {
    const d = this.ui;
    const run = s.run;
    const labels = new Map(s.heroes.map((h) => [h.id, h.ctrl === "ai" ? "AI" : PLAYER_IDENTITY[h.slot]!.name]));
    const act = ACTS.acts[run.act]!;
    if (run.phase === "actIntro") {
      d.panel(110, 90, 260, 70);
      d.text(act.name, 240, 102, PAL.amber, 16, "center");
      d.text(`Boss: ${act.boss.replace(/_/g, " ")}   Levels ${act.levels[0]}→${act.levels[1]}`, 240, 124, PAL.fog, 8, "center");
      d.text("Press A / Enter to begin", 240, 140, PAL.bone, 8, "center");
      return;
    }
    if (run.phase === "map" || (run.phase === "levelup" && !s.room)) {
      this.drawMap(s);
      if (run.phase === "levelup") this.drawLevelUp(s);
      this.drawTopBar(s);
      return;
    }
    // Room-based phases.
    this.hud.drawPopups();
    this.drawTelegraphHints(s);
    this.hud.drawPanels(s, labels);
    this.drawTopBar(s);
    this.hud.drawLog();
    if (s.init) this.drawInitiative(s);
    if (run.phase === "room" && s.room?.cleared && s.room.fight) d.text("Room clear! Walk to the stairs and press Interact.", 240, 214, PAL.leaf, 8, "center");
    if (run.phase === "room" && s.room && !s.room.fight && s.room.cleared) d.text("Walk to the stairs and press Interact to move on.", 240, 214, PAL.fog, 8, "center");
    if (run.phase === "campfire") this.drawCampfire(s);
    if (run.phase === "merchant") this.drawMerchant(s);
    if (run.phase === "skill") this.drawSkill(s);
    if (run.phase === "loot") this.drawLoot(s);
    if (run.phase === "levelup") this.drawLevelUp(s);
    if (run.mode === "party" && run.phase === "room") {
      const order = s.heroes.find((h) => h.ctrl === "ai")?.order ?? "follow";
      d.text(`Companions: ${order.toUpperCase()}  (D-pad ↑ Follow → Focus ↓ Hold ← Defensive)`, 4, 216, PAL.fog, 8);
    }
  }

  private drawTopBar(s: SimState): void {
    const d = this.ui;
    d.text(`${ACTS.acts[s.run.act]!.name.split(":")[0]}  Gold ${s.run.gold}`, 4, 4, PAL.gold, 8);
    const dm = s.director;
    d.text("Bored", 436, 2, PAL.fog, 8, "right");
    d.bar(438, 5, 38, 4, dm.boredom / DIRECTOR.boredom.max, PAL.wine);
    d.text("Delight", 436, 12, PAL.fog, 8, "right");
    d.bar(438, 15, 38, 4, dm.delight / DIRECTOR.delight.max, PAL.gold);
  }

  private drawTelegraphHints(s: SimState): void {
    // A small "!" over enemies telegraphing at a hero, with the reaction button hint for that hero.
    for (const e of s.enemies) {
      const t = e.telegraph;
      if (!t || t.cancelled) continue;
      const p = this.renderer.actorScreen(e.id, 2.6);
      if (!p) continue;
      this.ui.text("!", p.x, p.y - 8, PAL.gold, 16, "center");
      const target = s.heroes.find((h) => h.id === t.targetId);
      const dev = target ? this.deviceOf(target.slot) : null;
      if (target && dev && target.clock.reaction) this.ui.text(`React: ${buttonLabel(this.input, dev, "reaction")}`, p.x, p.y + 6, PAL.bone, 8, "center");
    }
  }

  private drawMap(s: SimState): void {
    const d = this.ui;
    const run = s.run;
    const icons: Record<string, string> = { encounter: "Fight", elite: "Elite", skill: "Skill", merchant: "Shop", campfire: "Camp", mystery: "?", boss: "BOSS", start: "Start" };
    for (const n of run.map.nodes) {
      if (!n.revealed) continue;
      const p = this.renderer.mapScreen(n.row, n.col);
      const cur = nodeById(run.map, run.map.current);
      const isOpt = cur.next.includes(n.id);
      d.text(icons[n.kind] ?? n.kind, p.x, p.y - 18, n.visited ? PAL.mist : isOpt ? PAL.gold : PAL.bone, 8, "center");
    }
    const cur = nodeById(run.map, run.map.current);
    const opt = cur.next[this.mapSel];
    const node = opt !== undefined ? nodeById(run.map, opt) : null;
    d.panel(8, 200, 200, 36);
    d.text(node ? `Next: ${node.kind.toUpperCase()}` : "", 16, 206, PAL.amber, 8);
    d.text("◀ ▶ choose path   A / Enter travel", 16, 220, PAL.fog, 8);
    this.hud.drawPanels(s, new Map(s.heroes.map((h) => [h.id, h.ctrl === "ai" ? "AI" : PLAYER_IDENTITY[h.slot]!.name])));
  }

  private drawLevelUp(s: SimState): void {
    const d = this.ui;
    const run = s.run;
    const pending = s.heroes.filter((h) => run.pendingCards[h.id] || run.pendingSubclass[h.id]);
    d.dim();
    d.text("LEVEL UP!", 240, 24, PAL.gold, 16, "center");
    pending.forEach((h, row) => {
      const cards = run.pendingCards[h.id];
      const subs = run.pendingSubclass[h.id];
      const list = cards ?? subs ?? [];
      const sel = this.sel.get(h.id) ?? 0;
      const y = 48 + row * 56;
      d.shape(PLAYER_IDENTITY[h.slot]!.shape, 18, y + 20, 5, this.hud.idColor(h.slot));
      d.text(`${CLASSES[h.cls]!.name} ${h.level}`, 26, y + 16, this.hud.idColor(h.slot), 8);
      list.forEach((id, i) => {
        const x = 90 + i * 128;
        const name = cards ? CARDS.cards.find((c) => c.id === id)!.name : SUBCLASSES[id]!.name;
        const desc = cards ? CARDS.cards.find((c) => c.id === id)!.desc : SUBCLASSES[id]!.desc;
        d.panel(x, y, 122, 50, i === sel ? "t1_nine_path_focus" : "nine_path_4");
        d.text(name, x + 6, y + 5, i === sel ? PAL.gold : PAL.bone, 8);
        d.wrap(desc, 110, 8).slice(0, 3).forEach((ln, k) => d.text(ln, x + 6, y + 17 + k * 10, PAL.fog, 8, "left", false));
      });
    });
  }

  private drawCampfire(s: SimState): void {
    const d = this.ui;
    d.text("CAMPFIRE — short rest (spend Hit Dice) or train (+2 to an ability)", 240, 36, PAL.amber, 8, "center");
    const humans = s.heroes.filter((h) => h.ctrl === "human");
    humans.forEach((h, i) => {
      const x = 20 + i * 115, y = 60;
      const done = s.run.campfireDone[h.id];
      const sel = this.sel.get(h.id) ?? 0;
      const prim = CLASSES[h.cls]!.attack.ability.toUpperCase();
      drawMenu(d, x, y, 108, `${PLAYER_IDENTITY[h.slot]!.name} ${CLASSES[h.cls]!.name}`, done ? [{ label: "Resting…" }] : [{ label: `Rest (${h.hitDice} HD)` }, { label: `Train ${prim}` }, { label: "Train CON" }], done ? 0 : sel);
    });
    d.text("New players: press A/Start or Enter/RShift to join the party here.", 240, 170, PAL.fog, 8, "center");
    if (humans.every((h) => s.run.campfireDone[h.id])) d.text("P1: press A / Enter to break camp", 240, 182, PAL.bone, 8, "center");
  }

  private drawMerchant(s: SimState): void {
    const d = this.ui;
    const stock = [...s.run.merchantStock, "potion_healing"];
    const items: MenuItem[] = stock.map((id) => {
      if (id === "potion_healing") return { label: "Potion of Healing", value: `${ITEMS.consumables.potion_healing!.price}g` };
      const it = ITEMS.items[id]!;
      return { label: `${it.name}${it.attune ? " (A)" : ""}`, value: `${ITEMS.prices[it.rarity]}g`, hint: `${it.rarity.replace("_", " ")}: ${it.desc}` };
    });
    items.push({ label: "Leave" });
    drawMenu(d, 120, 40, 240, `Merchant — party gold ${s.run.gold}`, items, this.shopSel);
  }

  private drawSkill(s: SimState): void {
    const d = this.ui;
    const run = s.run;
    const sc = SCENES.scenes.find((x) => x.id === run.scene?.id);
    if (!sc) return;
    d.panel(70, 40, 340, 130);
    d.wrap(sc.text, 320, 8).forEach((ln, i) => d.text(ln, 80, 48 + i * 11, PAL.bone, 8));
    if (run.scene?.result) {
      d.wrap(run.scene.result, 320, 8).forEach((ln, i) => d.text(ln, 80, 100 + i * 11, PAL.gold, 8));
      d.text("A / Enter: continue", 240, 150, PAL.fog, 8, "center");
      return;
    }
    sc.options.forEach((o, i) => {
      const y = 82 + i * 22;
      if (i === this.skillSel) d.rect(76, y - 2, 328, 20, PAL.dusk);
      d.text(`${o.label}`, 84, y, i === this.skillSel ? PAL.gold : PAL.bone, 8);
      d.text(`${o.skill.replace(/_/g, " ")} DC ${o.dc}`, 84, y + 9, PAL.fog, 8);
    });
    d.text(this.helping.size ? "Help given: advantage!" : "Other players: press Help to assist (advantage)", 240, 154, this.helping.size ? PAL.leaf : PAL.fog, 8, "center");
  }

  private drawLoot(s: SimState): void {
    const d = this.ui;
    const lv = s.run.loot[0];
    if (!lv) return;
    const it = ITEMS.items[lv.itemId]!;
    d.panel(110, 50, 260, 110);
    d.text(it.name, 240, 58, PAL.gold, 8, "center");
    d.text(`${it.rarity.replace("_", " ")}${it.attune ? " — requires attunement" : ""}`, 240, 70, PAL.fog, 8, "center");
    d.wrap(it.desc, 240, 8).forEach((ln, i) => d.text(ln, 240, 82 + i * 10, PAL.bone, 8, "center"));
    s.heroes.filter((h) => !h.fallen).forEach((h, i) => {
      const v = lv.votes[h.id];
      d.shape(PLAYER_IDENTITY[h.slot]!.shape, 128 + i * 60, 118, 4, this.hud.idColor(h.slot));
      d.text(v ? v.toUpperCase() : "…", 136 + i * 60, 114, v === "need" ? PAL.gold : v === "greed" ? PAL.sky : PAL.fog, 8);
    });
    d.text("Need: Attack   Greed: Action   Pass: Dodge   (d20 roll-off)", 240, 140, PAL.fog, 8, "center");
  }

  private drawInitiative(s: SimState): void {
    const d = this.ui;
    const init = s.init!;
    d.text("INITIATIVE BREAK", 240, 30, PAL.gold, 16, "center");
    if (init.phase === "plan") {
      d.bar(170, 50, 140, 4, init.planT / 600, PAL.amber);
      d.text("Move your marker (6 tiles), then: Attack · Action · Dodge · Help", 240, 58, PAL.bone, 8, "center");
      for (const h of s.heroes) {
        const plan = init.plans[h.id];
        if (!plan) continue;
        const p = this.renderer.toScreen(plan.x, 0.1, plan.z);
        d.shape(PLAYER_IDENTITY[h.slot]!.shape, p.x, p.y, 5, plan.ready ? PAL.mist : this.hud.idColor(h.slot));
        if (plan.ready) d.text(plan.action.toUpperCase(), p.x, p.y + 6, this.hud.idColor(h.slot), 8, "center");
      }
    }
    // Initiative order down the left side.
    d.panel(4, 70, 92, 14 + init.order.length * 10);
    d.text("Order", 10, 74, PAL.amber, 8);
    init.order.forEach((o, i) => {
      const a = s.heroes.find((h) => h.id === o.id) ?? s.enemies.find((e) => e.id === o.id);
      if (!a) return;
      const isHero = (a as Hero).kind === "hero";
      d.text(`${o.total} ${a.name.slice(0, 12)}`, 10, 84 + i * 10, i === init.turn && init.phase === "resolve" ? PAL.gold : isHero ? this.hud.idColor((a as Hero).slot) : PAL.fog, 8, "left", false);
    });
  }

  private drawSummary(): void {
    const d = this.ui;
    const sm = this.summary;
    if (!sm) return;
    d.panel(70, 40, 340, 190);
    d.text(sm.victory ? "VICTORY! The Lich is undone." : "DEFEAT. The DM closes the screen.", 240, 50, sm.victory ? PAL.gold : PAL.blood, 16, "center");
    sm.lines.slice(0, 12).forEach((l, i) => d.wrap(l, 320, 8).slice(0, 1).forEach((ln) => d.text(ln, 80, 76 + i * 12, PAL.bone, 8)));
    d.text("A / Enter: back to the tavern", 240, 214, PAL.fog, 8, "center");
  }

  private drawShop(): void {
    const d = this.ui;
    const items: MenuItem[] = META.unlocks.map((u) => ({ label: u.name, value: this.meta.unlocked.includes(u.id) ? "owned" : `${u.cost}`, disabled: this.meta.unlocked.includes(u.id) }));
    const start = Math.max(0, this.listSel - 12);
    drawMenu(d, 110, 8, 260, `Renown shop — ${this.meta.renown} Renown`, items.slice(start, start + 16), this.listSel - start);
  }

  private drawHall(): void {
    const d = this.ui;
    d.panel(40, 10, 400, 250);
    d.text("Hall of Heroes", 240, 16, PAL.amber, 16, "center");
    if (!this.meta.hall.length) d.text("No plaques yet. Every hero who falls is remembered here.", 240, 60, PAL.fog, 8, "center");
    this.meta.hall.slice(this.creditsScroll, this.creditsScroll + 18).forEach((p, i) => {
      d.text(`${p.date}  ${p.name} — level ${p.level}, Act ${p.act}. ${p.cause}. Kills ${p.kills}.${p.bestItem ? ` Heirloom: ${ITEMS.items[p.bestItem]?.name}` : ""}`, 50, 40 + i * 11, PAL.bone, 8);
    });
    d.text(`Heirlooms waiting: ${this.meta.heirlooms.map((h) => ITEMS.items[h]?.name).join(", ") || "none"}`, 50, 244, PAL.gold, 8);
  }

  private drawCredits(): void {
    const d = this.ui;
    d.panel(10, 6, 460, 258);
    this.credits.slice(this.creditsScroll, this.creditsScroll + 23).forEach((l, i) => d.text(l, 20, 12 + i * 11, PAL.bone, 8, "left", false));
    d.text("↑↓ scroll   Back: return", 460, 252, PAL.fog, 8, "right");
  }
}

function rarityRank(r: string): number {
  return ["common", "uncommon", "rare", "very_rare", "legendary"].indexOf(r);
}

function bonusFor(h: Hero, skill: string): number {
  const ab = SCENES.skills[skill] as "str";
  return Math.floor((h.scores[ab] - 10) / 2) + (CLASSES[h.cls]!.skills.includes(skill) ? h.prof : 0);
}

// Demo mode reuses the headless bot for menu decisions.
import { botCommands } from "../sim/bot";
function botCommandsLazy(s: SimState): Command[] {
  return botCommands(s);
}
void BTN; void EMPTY_INPUT; void makeHero;
