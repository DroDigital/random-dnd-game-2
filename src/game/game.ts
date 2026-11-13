import { Assets } from "../render/assets";
import { GameRenderer } from "../render/renderer";
import { Draw } from "../ui/draw";
import { lookTestSim } from "./looktest";
import { useAbility } from "../sim/abilities";
import type { Sim } from "../sim/sim";
import type { SimEvent } from "../sim/types";
import { PAL } from "../render/palette";
import type { RfrApi } from "../shared/api";
import { defaultSettings, type Settings } from "../shared/settings";

declare global {
  interface Window { rfr?: RfrApi }
}

const STEP = 1 / 60;

export interface GameOptions { look: string | null }

/** Top-level game: owns the loop, the sim, the renderer, input, audio and UI. */
export class Game {
  readonly assets = new Assets();
  readonly ui: Draw;
  readonly uiCanvas: HTMLCanvasElement;
  renderer!: GameRenderer;
  sim: Sim | null = null;
  settings: Settings = defaultSettings();
  private acc = 0;
  private last = 0;
  paused = false;
  frozen = false;
  private fpsT = 0;
  private fpsN = 0;
  showStats = false;
  ready = false;
  events: SimEvent[] = [];

  constructor(readonly screen: HTMLCanvasElement, readonly opts: GameOptions) {
    this.uiCanvas = document.createElement("canvas");
    this.ui = new Draw(this.uiCanvas);
  }

  async start(): Promise<void> {
    if (window.rfr) this.settings = await window.rfr.getSettings();
    this.loading(0);
    await this.assets.loadAll((p) => this.loading(p));
    this.renderer = new GameRenderer(this.screen, this.assets, this.uiCanvas);
    this.loadCanvas?.remove();
    this.loadCanvas = null;
    this.renderer.post.toggles.dither = this.settings.accessibility.dither;
    window.addEventListener("keydown", (e) => this.debugKey(e));
    if (this.opts.look) await this.lookTest(this.opts.look);
    this.ready = true;
    (window as unknown as { __rfrReady: boolean }).__rfrReady = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
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
    this.sim = lookTestSim();
    if (mode === "off") {
      const t = this.renderer.post.toggles;
      t.outline = t.tiltShift = t.quantize = t.dither = false;
    }
    if (mode === "fireball") {
      // Let the skeletons close in, have the Wizard cast Fireball, and hold the frame mid-flight.
      for (let i = 0; i < 70; i++) this.stepSim();
      const wiz = this.sim.s.heroes.find((h) => h.cls === "wizard")!;
      useAbility(this.sim.world, wiz, "fireball", "action");
      const fb = this.sim.s.projectiles.find((p) => p.kind === "fireball");
      const half = fb ? Math.max(4, Math.floor(fb.life * 0.55)) : 10;
      for (let k = 0; k < half; k++) this.stepSim();
      this.frozen = true;
    } else {
      for (let i = 0; i < 90; i++) this.stepSim();
      this.frozen = true;
    }
  }

  private stepSim(): void {
    if (!this.sim) return;
    const r = this.renderer;
    for (const a of [...this.sim.s.heroes, ...this.sim.s.enemies, ...this.sim.s.summons]) r.prev.set(a.id, { x: a.x, z: a.z, facing: a.facing });
    for (const p of this.sim.s.projectiles) r.prev.set(p.id, { x: p.x, z: p.z, facing: 0 });
    const ev = this.sim.step([], []);
    r.onEvents(ev);
    this.events.push(...ev);
  }

  private debugKey(e: KeyboardEvent): void {
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
    const url = this.screen.toDataURL("image/png");
    const b64 = url.slice(url.indexOf(",") + 1);
    return window.rfr ? window.rfr.screenshot(b64) : url;
  }

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
    if (this.sim && !this.paused && !this.frozen) {
      this.acc += dt * this.settings.accessibility.combatSpeed;
      while (this.acc >= STEP) {
        this.stepSim();
        this.acc -= STEP;
      }
    }
    const alpha = this.frozen ? 1 : this.acc / STEP;
    const W = Math.max(1, Math.floor(this.screen.clientWidth * devicePixelRatio));
    const H = Math.max(1, Math.floor(this.screen.clientHeight * devicePixelRatio));
    if (this.sim) {
      this.renderer.sync(this.sim.s, alpha, this.frozen ? 0 : dt);
      if (this.opts.look) this.renderer.settleRoom();
      this.renderer.frame(this.sim.s, 3.5, 12, 20, this.frozen ? 1 : dt);
    }
    this.drawUi();
    this.renderer.render(W, H, dt, true);
    requestAnimationFrame((t) => this.frame(t));
  }

  private drawUi(): void {
    const d = this.ui;
    d.clear();
    if (this.showStats) {
      const s = this.renderer.stats;
      d.panel(4, 4, 140, 52);
      d.text(`FPS ${s.fps.toFixed(0)}  ${s.frameMs.toFixed(1)}ms`, 10, 10);
      d.text(`calls ${s.calls} tris ${s.tris}`, 10, 20);
      d.text(`lights ${this.renderer.lightsUsed}/8 vfx ${this.renderer.vfx.count}`, 10, 30);
      d.text(`tick ${this.sim?.s.tick ?? 0}`, 10, 40);
      if (this.sim) for (const h of this.sim.s.heroes) {
        const p = this.renderer.actorScreen(h.id, 0);
        if (p) d.text(`P${h.slot + 1}`, p.x, p.y, PAL.gold, 8, "center");
      }
    }
  }
}
