import type { Settings } from "../shared/settings";

type Bus = "music" | "sfx" | "ui";

/**
 * Web Audio with three buses (music / sfx / ui) into a master gain. Music ducks on crits and
 * during an Initiative Break. SFX are synthesized (the Ninja Adventure repo ships no SFX).
 */
export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = {} as Record<Bus, GainNode>;
  private duck!: GainNode;
  private music: { el: HTMLAudioElement; src: MediaElementAudioSourceNode; track: string } | null = null;
  private noise: AudioBuffer | null = null;
  private settings: Settings;
  private lastPlay = new Map<string, number>();

  constructor(settings: Settings) {
    this.settings = settings;
  }

  /** Browsers need a user gesture before audio can start. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.duck = ctx.createGain();
    this.duck.connect(this.master);
    for (const b of ["music", "sfx", "ui"] as Bus[]) {
      const g = ctx.createGain();
      g.connect(b === "music" ? this.duck : this.master);
      this.buses[b] = g;
    }
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }
    this.applyVolumes(this.settings);
  }

  applyVolumes(s: Settings): void {
    this.settings = s;
    if (!this.ctx) return;
    const a = s.audio;
    this.master.gain.value = a.master;
    this.buses.music.gain.value = a.music * 0.55;
    this.buses.sfx.gain.value = a.sfx;
    this.buses.ui.gain.value = a.ui;
  }

  /** Duck the music bus for `seconds` (crit, Initiative Break). */
  duckMusic(amount: number, seconds: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.duck.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(amount, t, 0.04);
    if (seconds > 0) g.setTargetAtTime(1, t + seconds, 0.25);
  }

  holdDuck(on: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(on ? 0.3 : 1, t, 0.15);
  }

  playMusic(track: string): void {
    if (!this.ctx || this.music?.track === track) return;
    const old = this.music;
    const el = new window.Audio(`./assets/music/${track}.ogg`);
    el.loop = true;
    el.crossOrigin = "anonymous";
    const src = this.ctx.createMediaElementSource(el);
    const fade = this.ctx.createGain();
    fade.gain.value = 0;
    src.connect(fade).connect(this.buses.music);
    void el.play().catch(() => undefined);
    fade.gain.setTargetAtTime(1, this.ctx.currentTime, 0.6);
    this.music = { el, src, track };
    if (old) setTimeout(() => { old.el.pause(); old.src.disconnect(); }, 1500);
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(bus: Bus, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(this.buses[bus]);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(bus: Bus, dur: number, vol: number, freq: number, q = 1, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, dur);
    s.connect(f).connect(g).connect(this.buses[bus]);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  /** Play a named effect. Rate-limited per id so a big fight doesn't clip. */
  sfx(id: string): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if ((this.lastPlay.get(id) ?? -1) > now - 0.045) return;
    this.lastPlay.set(id, now);
    switch (id) {
      case "swing": this.hiss("sfx", 0.09, 0.25, 2500, 0.7); break;
      case "swing_hit": this.hiss("sfx", 0.08, 0.3, 2000, 0.7); this.tone("sfx", "square", 180, 60, 0.08, 0.18, 0.03); break;
      case "bolt": this.tone("sfx", "sawtooth", 600, 200, 0.18, 0.12); this.hiss("sfx", 0.15, 0.1, 3000); break;
      case "fireball_cast": this.tone("sfx", "sawtooth", 200, 700, 0.25, 0.12); break;
      case "explosion": this.hiss("sfx", 0.6, 0.6, 400, 0.6); this.tone("sfx", "sine", 120, 35, 0.5, 0.5); break;
      case "ignite": this.hiss("sfx", 0.8, 0.35, 900, 0.5); break;
      case "dodge": this.hiss("sfx", 0.12, 0.2, 1200, 0.5); break;
      case "whiff": this.hiss("sfx", 0.1, 0.15, 3200, 1); break;
      case "parry": this.tone("sfx", "square", 1400, 1200, 0.15, 0.2); this.tone("sfx", "square", 2100, 1800, 0.12, 0.12, 0.02); break;
      case "reaction": this.tone("ui", "triangle", 700, 1000, 0.1, 0.15); break;
      case "clock": this.tone("ui", "sine", 1320, 1320, 0.06, 0.05); break;
      case "kill": this.tone("sfx", "square", 300, 80, 0.2, 0.15); this.hiss("sfx", 0.2, 0.15, 600); break;
      case "down": this.tone("sfx", "triangle", 400, 90, 0.6, 0.25); break;
      case "fallen": this.tone("sfx", "sine", 220, 55, 1.2, 0.3); break;
      case "stabilize": this.tone("sfx", "sine", 500, 750, 0.3, 0.2); break;
      case "holy": this.tone("sfx", "sine", 660, 990, 0.5, 0.2); this.tone("sfx", "sine", 880, 1320, 0.5, 0.15, 0.05); break;
      case "blink": this.tone("sfx", "sine", 1500, 400, 0.2, 0.15); break;
      case "grease": this.hiss("sfx", 0.3, 0.2, 300, 2); break;
      case "telegraph": this.tone("sfx", "sawtooth", 110, 160, 0.3, 0.1); break;
      case "coin": this.tone("ui", "square", 1320, 1320, 0.05, 0.1); this.tone("ui", "square", 1760, 1760, 0.1, 0.1, 0.06); break;
      case "pickup": this.tone("ui", "triangle", 660, 990, 0.15, 0.15); break;
      case "loot": this.tone("ui", "triangle", 523, 523, 0.1, 0.2); this.tone("ui", "triangle", 784, 784, 0.2, 0.2, 0.1); break;
      case "victory": [523, 659, 784, 1046].forEach((f, i) => this.tone("ui", "triangle", f, f, 0.18, 0.18, i * 0.1)); break;
      case "crit": this.tone("sfx", "square", 880, 1760, 0.12, 0.2); this.hiss("sfx", 0.25, 0.3, 1500); break;
      case "dice": for (let i = 0; i < 4; i++) this.hiss("ui", 0.03, 0.2, 2500 + i * 300, 3, i * 0.05); break;
      case "ui_move": this.tone("ui", "square", 880, 880, 0.03, 0.06); break;
      case "ui_confirm": this.tone("ui", "square", 660, 990, 0.08, 0.1); break;
      case "ui_back": this.tone("ui", "square", 660, 440, 0.08, 0.08); break;
      case "join": [392, 523, 659].forEach((f, i) => this.tone("ui", "triangle", f, f, 0.12, 0.15, i * 0.07)); break;
      case "initiative": this.tone("sfx", "sawtooth", 98, 98, 0.6, 0.2); this.tone("sfx", "sawtooth", 147, 147, 0.6, 0.15, 0.1); break;
      case "type": this.tone("ui", "square", 1800 + Math.random() * 300, 1800, 0.015, 0.03); break;
      default: this.tone("sfx", "square", 440, 220, 0.06, 0.08);
    }
  }
}
