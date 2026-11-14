import { CLASSES, ITEMS } from "../data";
import { clockFraction } from "../rules/clock";
import { PAL, PLAYER_IDENTITY } from "../render/palette";
import type { GameRenderer } from "../render/renderer";
import type { Hero, SimEvent, SimState } from "../sim/types";
import { Draw, UI_H, UI_W } from "./draw";

interface Popup { text: string; color: string; x: number; y: number; t: number; life: number; big: boolean; d20?: number; dmg?: number; mode?: string }
interface LogLine { text: string; color: string; slot: number }

/** Heads-up display and transient text: panels, dice popups, DM narration, roll log. */
export class Hud {
  popups: Popup[] = [];
  log: LogLine[] = [];
  showLog = false;
  private narr = { text: "", shown: 0, t: 0, hold: 0 };
  private narrQueue: string[] = [];
  altColors = false;
  largeText = false;
  onType: (() => void) | null = null;

  constructor(readonly d: Draw) {}

  idColor(slot: number): string {
    const id = PLAYER_IDENTITY[slot % 4]!;
    return this.altColors ? id.alt : id.color;
  }

  onEvents(evs: SimEvent[], r: GameRenderer): void {
    for (const e of evs) {
      if (e.t === "roll") {
        const resColor = e.result === "crit" ? PAL.gold : e.result === "fumble" || e.result === "failed" || e.result === "failure" ? PAL.mist : e.result === "graze" ? PAL.fog : PAL.bone;
        const mode = e.mode === "advantage" ? " ADV" : e.mode === "disadvantage" ? " DIS" : "";
        const rolls = e.d20.length > 1 ? `[${e.d20.join(",")}]` : `${e.kept}`;
        const vs = e.vs ? ` vs ${e.vsLabel} ${e.vs}` : "";
        this.log.push({ text: `${e.who}: ${e.what} d20 ${rolls}${mode} = ${e.total}${vs} ${e.result}${e.damage !== undefined && e.result !== "fumble" ? ` (${e.damage} dmg)` : ""}`, color: resColor, slot: e.slot });
        if (this.log.length > 60) this.log.shift();
        if (e.vsLabel === "AC" || e.what.includes("save") || e.what === "Death save") {
          const p = r.toScreen(e.x, 2.4, e.z);
          this.popups.push({ text: "", color: resColor, x: p.x, y: p.y, t: 0, life: 1.1, big: e.result === "crit", d20: e.kept, dmg: e.damage, mode: e.mode });
        }
      } else if (e.t === "popup") {
        // Drop duplicates and stack nearby text so a busy fight stays readable.
        if (this.popups.some((q) => q.text === e.text && q.t < 0.4)) continue;
        const p = e.x === 0 && e.z === 0 ? { x: UI_W / 2, y: 70 } : r.toScreen(e.x, 2.6, e.z);
        const near = this.popups.filter((q) => q.text && Math.abs(q.x - p.x) < 60 && Math.abs(q.y - p.y) < 14 && q.t < 0.6).length;
        const big = !!e.big && !this.popups.some((q) => q.big && q.text && q.t < 0.8);
        this.popups.push({ text: e.text, color: e.color, x: p.x, y: p.y - near * 10, t: 0, life: big ? 1.4 : 1.0, big });
      } else if (e.t === "damage" && e.amount > 0) {
        const p = r.toScreen(e.x, 1.8, e.z);
        this.popups.push({ text: `${e.amount}`, color: e.crit ? PAL.gold : e.graze ? PAL.fog : e.type === "fire" ? PAL.ember : PAL.blood, x: p.x + 8, y: p.y, t: 0, life: 0.9, big: e.crit });
      } else if (e.t === "heal") {
        const p = r.toScreen(e.x, 1.8, e.z);
        this.popups.push({ text: `+${e.amount}`, color: PAL.leaf, x: p.x, y: p.y, t: 0, life: 1, big: false });
      } else if (e.t === "narrate") {
        this.narrate(e.text);
      }
    }
    if (this.popups.length > 40) this.popups.splice(0, this.popups.length - 40);
  }

  narrate(text: string): void {
    if (this.narrQueue[this.narrQueue.length - 1] === text || this.narr.text === text) return;
    this.narrQueue.push(text);
    if (this.narrQueue.length > 3) this.narrQueue.shift();
  }

  update(dt: number): void {
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter((p) => p.t < p.life);
    const n = this.narr;
    if (n.shown < n.text.length) {
      n.t += dt;
      const before = Math.floor(n.shown);
      n.shown = Math.min(n.text.length, n.shown + dt * 40);
      if (Math.floor(n.shown) > before && n.text[Math.floor(n.shown)] !== " ") this.onType?.();
    } else if (n.text) {
      n.hold -= dt;
      if (n.hold <= 0) n.text = "";
    }
    if (!n.text && this.narrQueue.length) {
      n.text = this.narrQueue.shift()!;
      n.shown = 0;
      n.hold = 2.5;
    }
  }

  /** DM narration in a typewriter box at the top. */
  private narrLayout(): { lines: string[]; size: number; h: number } | null {
    const n = this.narr;
    if (!n.text) return null;
    const size = this.largeText ? 16 : 8;
    const lines = this.d.wrap(n.text, 284, size);
    return { lines, size, h: 12 + lines.length * (size + 3) };
  }

  /** Bottom edge of the narration box (0 when hidden), so other top-of-screen UI can sit below it. */
  narrationBottom(): number {
    const l = this.narrLayout();
    return l ? 2 + l.h : 0;
  }

  drawNarration(): void {
    const l = this.narrLayout();
    if (!l) return;
    const d = this.d;
    d.panel(90, 2, 300, l.h, "nine_path_4");
    d.text("DM", 98, 8, PAL.wine, 8, "left", false);
    let left = Math.floor(this.narr.shown);
    l.lines.forEach((ln, i) => {
      const part = ln.slice(0, Math.max(0, left));
      left -= ln.length + 1;
      d.text(part, 116, 8 + i * (l.size + 3) - (l.size > 8 ? 2 : 0), PAL.bone, l.size, "left", false);
    });
  }

  drawPopups(): void {
    const d = this.d;
    for (const p of this.popups) {
      const k = p.t / p.life;
      const y = p.y - k * 16;
      if (p.d20 !== undefined) {
        // Dice popup: the d20 face first, then the damage.
        if (p.t < 0.5) {
          d.shape("diamond", p.x, y, 7, p.mode === "advantage" ? PAL.leaf : p.mode === "disadvantage" ? PAL.wine : PAL.dusk);
          d.text(String(p.d20), p.x, y - 4, p.color, 8, "center");
        } else if (p.dmg !== undefined && p.dmg > 0) {
          d.text(String(p.dmg), p.x, y - 4, p.big ? PAL.gold : PAL.bone, p.big ? 16 : 8, "center");
        }
        continue;
      }
      d.text(p.text, p.x, y, p.color, p.big ? 16 : this.largeText ? 16 : 8, "center");
    }
  }

  drawLog(): void {
    if (!this.showLog) return;
    const d = this.d;
    // Sits under the top bar / narration and stops above the hero panels.
    const top = Math.max(26, this.narrationBottom() + 2);
    const room = Math.floor((UI_H - 46 - top - 22) / 11);
    const n = Math.max(0, Math.min(this.log.length, 16, room));
    const w = 250, x = UI_W - w - 2;
    d.panel(x, top, w, 22 + n * 11, "nine_path_4");
    d.text("Roll log (Tab)", x + 8, top + 6, PAL.amber, 8, "left", false);
    this.log.slice(-n).forEach((l, i) => {
      const y = top + 18 + i * 11;
      if (l.slot >= 0) d.shape(PLAYER_IDENTITY[l.slot % 4]!.shape, x + 10, y + 4, 3, this.idColor(l.slot));
      d.text(d.fit(l.text, w - 26), x + 16, y, l.color, 8, "left", false);
    });
  }

  /** Bottom player panels. */
  drawPanels(s: SimState, labels: Map<number, string>): void {
    const heroes = [...s.heroes].sort((a, b) => a.slot - b.slot);
    const w = 116, h = 38, gap = 4;
    const x0 = Math.round((UI_W - (heroes.length * w + (heroes.length - 1) * gap)) / 2);
    heroes.forEach((hero, i) => this.panel(hero, x0 + i * (w + gap), UI_H - h - 3, w, h, labels.get(hero.id) ?? ""));
  }

  private panel(h: Hero, x: number, y: number, w: number, hh: number, label: string): void {
    const d = this.d;
    const col = this.idColor(h.slot);
    const id = PLAYER_IDENTITY[h.slot % 4]!;
    d.panel(x, y, w, hh, "nine_path_4");
    // Portrait with the Round Clock ring around it.
    const cx = x + 17, cy = y + 19;
    d.rect(cx - 9, cy - 9, 18, 18, PAL.ink);
    d.rect(cx - 8, cy - 8, 16, 16, CLASSES[h.cls]?.color ?? PAL.dusk);
    d.text(CLASSES[h.cls]!.name[0]!, cx, cy - 6, PAL.ink, 8, "center", false);
    d.ring(cx, cy, 12, clockFraction(h.clock), PAL.amber);
    d.ring(cx, cy, 13, clockFraction(h.clock), PAL.amber);
    d.shape(id.shape, x + 6, y + 6, 3, col);
    // Name + HP.
    // Text column starts right of the clock ring (ring spans x+4..x+30).
    const tx = x + 34, tw = w - 34 - 5;
    d.text(d.fit(`${CLASSES[h.cls]!.name} ${h.level}${label === "AI" ? " (AI)" : ""}`, tw), tx, y + 4, col, 8, "left");
    if (h.fallen) {
      d.text("FALLEN", tx, y + 15, PAL.blood, 8);
      d.text(d.fit("back at camp", tw), tx, y + 25, PAL.fog, 8);
      return;
    }
    if (h.down) {
      const ds = h.down.saves;
      d.text(h.stable ? "STABLE" : "DOWNED", tx, y + 14, h.stable ? PAL.leaf : PAL.blood, 8);
      for (let i = 0; i < 3; i++) {
        d.rect(x + w - 30 + i * 8, y + 15, 6, 6, i < ds.successes ? PAL.leaf : PAL.ink);
        d.rect(x + w - 30 + i * 8, y + 25, 6, 6, i < ds.failures ? PAL.blood : PAL.ink);
      }
      if (!h.stable) d.bar(tx, y + 27, 40, 3, 1 - h.down.timer / 180, PAL.fog);
      return;
    }
    // HP bar fills whatever the HP text leaves free.
    const hpText = `${Math.max(0, h.hp)}/${h.maxHp}`;
    const bw = Math.max(20, Math.floor(x + w - 5 - d.width(hpText) - 4 - tx));
    d.bar(tx, y + 16, bw, 5, h.hp / h.maxHp, h.hp / h.maxHp < 0.3 ? PAL.blood : PAL.leaf);
    if (h.tempHp > 0) d.bar(tx, y + 16, Math.min(bw, (h.tempHp / h.maxHp) * bw), 2, 1, PAL.sky);
    d.text(hpText, x + w - 5, y + 14, PAL.bone, 8, "right");
    // Action / Bonus / Reaction pips.
    const pip = (px: number, on: boolean, ch: string, c: string): void => {
      d.rect(px, y + 25, 9, 9, on ? c : PAL.ink);
      d.text(ch, px + 2, y + 25, on ? PAL.ink : PAL.mist, 8, "left", false);
    };
    pip(tx, h.clock.action, "A", PAL.blood);
    pip(tx + 11, h.clock.bonus, "B", PAL.sky);
    pip(tx + 22, h.clock.reaction, "R", PAL.gold);
    // Inspiration, potions, spell slots (right-aligned so they never touch the frame).
    for (let i = 0; i < Math.min(3, h.inspiration); i++) d.shape("diamond", tx + 37 + i * 6, y + 29, 2, PAL.gold);
    const rx = x + w - 6;
    if (h.cls === "wizard") {
      d.text(`${h.slots}`, rx, y + 25, PAL.bone, 8, "right", false);
      d.rect(rx - d.width(`${h.slots}`) - 6, y + 27, 4, 4, PAL.sky);
    }
    const px = h.cls === "wizard" ? rx - 16 : rx;
    d.text(`${h.potions}`, px, y + 25, PAL.bone, 8, "right", false);
    d.rect(px - d.width(`${h.potions}`) - 6, y + 26, 4, 6, PAL.blood);
    void ITEMS;
  }
}
