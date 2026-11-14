import { BTN, EMPTY_INPUT, type InputFrame } from "../sim/types";
import type { KeyboardScheme, PadMap, Settings } from "../shared/settings";

export type DeviceId = "kbA" | "kbB" | `pad${number}`;
export type GlyphSet = "xbox" | "playstation" | "switch" | "keyboard";

const SQ = Math.SQRT1_2;
/** Screen-relative stick (right, up) → world ground direction for the 45° yaw camera. */
export function screenToWorld(sx: number, sy: number): { x: number; z: number } {
  return { x: sx * SQ - sy * SQ, z: -sx * SQ - sy * SQ };
}

/** Radial deadzone with rescale so small stick drift never moves a hero. */
export function applyDeadzone(x: number, y: number, dz: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}

const PAD_START = 9, PAD_BACK = 8, PAD_UP = 12, PAD_DOWN = 13, PAD_LEFT = 14, PAD_RIGHT = 15;

interface DeviceState {
  sx: number;
  sy: number;
  down: number;
  /** Accumulated since the last sim tick so short taps between ticks are never lost. */
  pending: number;
  pendingUp: number;
  menu: number; // menu edges since last UI read
  start: boolean;
  back: boolean;
  lastSeen: number;
  id: string;
}

/** Menu bits, read by the UI (separate from game buttons so menus work during pause). */
export const MENU = { up: 1, down: 2, left: 4, right: 8, confirm: 16, back: 32, start: 64, help: 128, alt: 256, tab: 512 } as const;

/**
 * Polls the keyboard (two shared-keyboard schemes) and the Gamepad API every frame.
 * Pads appear only after their first button press (browser rule), so the UI shows a hint.
 */
export class Input {
  private devices = new Map<DeviceId, DeviceState>();
  private keys = new Set<string>();
  private prevPadButtons = new Map<number, boolean[]>();
  settings: Settings;
  holdToggle = new Map<DeviceId, boolean>();
  /** Last key pressed (for rebinding UI). */
  lastKey: string | null = null;
  tabPressed = false;
  escPressed = false;

  constructor(settings: Settings) {
    this.settings = settings;
    for (const d of ["kbA", "kbB"] as const) this.devices.set(d, this.fresh(d));
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("blur", () => this.keys.clear());
    window.addEventListener("gamepadconnected", () => undefined);
    window.addEventListener("gamepaddisconnected", (e) => this.devices.delete(`pad${(e as GamepadEvent).gamepad.index}`));
  }

  private fresh(id: string): DeviceState {
    return { sx: 0, sy: 0, down: 0, pending: 0, pendingUp: 0, menu: 0, start: false, back: false, lastSeen: 0, id };
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.code.startsWith("F") && e.code.length <= 3) return; // debug keys
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].includes(e.code)) e.preventDefault();
    if (down) {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.lastKey = e.code;
      if (e.code === "Tab") this.tabPressed = true;
      if (e.code === "Escape") this.escPressed = true;
      for (const [id, scheme] of [["kbA", this.settings.input.keysA], ["kbB", this.settings.input.keysB]] as const) {
        const d = this.devices.get(id)!;
        const bit = this.keyBit(scheme, e.code);
        if (bit) d.pending |= bit;
        const m = this.keyMenu(scheme, e.code, id === "kbA");
        if (m) d.menu |= m;
        if (e.code === scheme.join) d.start = true;
      }
    } else {
      this.keys.delete(e.code);
      for (const [id, scheme] of [["kbA", this.settings.input.keysA], ["kbB", this.settings.input.keysB]] as const) {
        const bit = this.keyBit(scheme, e.code);
        if (bit) this.devices.get(id)!.pendingUp |= bit;
      }
    }
  }

  private keyBit(s: KeyboardScheme, code: string): number {
    switch (code) {
      case s.attack: return BTN.attack;
      case s.action: return BTN.action;
      case s.bonus: return BTN.bonus;
      case s.dodge: return BTN.dodge;
      case s.reaction: return BTN.reaction;
      case s.interact: return BTN.interact;
      case s.help: return BTN.help;
      default: return 0;
    }
  }

  private keyMenu(s: KeyboardScheme, code: string, primary: boolean): number {
    let m = 0;
    if (code === s.up) m |= MENU.up;
    if (code === s.down) m |= MENU.down;
    if (code === s.left) m |= MENU.left;
    if (code === s.right) m |= MENU.right;
    if (code === s.attack || code === s.join) m |= MENU.confirm;
    if (code === s.dodge) m |= MENU.back;
    if (code === s.help) m |= MENU.help;
    if (code === s.action) m |= MENU.alt;
    if (primary && (code === "Enter" || code === "Space")) m |= MENU.confirm;
    if (primary && code === "Escape") m |= MENU.back;
    return m;
  }

  /** Poll gamepads and keyboards. Call once per rendered frame. */
  poll(now: number): void {
    const dz = this.settings.input.deadzone;
    for (const [id, scheme] of [["kbA", this.settings.input.keysA], ["kbB", this.settings.input.keysB]] as const) {
      const d = this.devices.get(id)!;
      const k = this.keys;
      d.sx = (k.has(scheme.right) ? 1 : 0) - (k.has(scheme.left) ? 1 : 0);
      d.sy = (k.has(scheme.up) ? 1 : 0) - (k.has(scheme.down) ? 1 : 0);
      let down = 0;
      for (const b of ["attack", "action", "bonus", "dodge", "reaction", "interact", "help"] as const) if (k.has(scheme[b])) down |= BTN[b];
      d.down = down;
    }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const id: DeviceId = `pad${p.index}`;
      let d = this.devices.get(id);
      const pressedNow = p.buttons.map((b) => b.pressed || b.value > 0.5);
      const prev = this.prevPadButtons.get(p.index) ?? pressedNow.map(() => false);
      if (!d) {
        if (!pressedNow.some(Boolean)) continue;
        d = this.fresh(p.id);
        this.devices.set(id, d);
      }
      d.lastSeen = now;
      d.id = p.id;
      const [ax, ay] = applyDeadzone(p.axes[0] ?? 0, p.axes[1] ?? 0, dz);
      const dpx = (pressedNow[PAD_RIGHT] ? 1 : 0) - (pressedNow[PAD_LEFT] ? 1 : 0);
      const dpy = (pressedNow[PAD_UP] ? 1 : 0) - (pressedNow[PAD_DOWN] ? 1 : 0);
      d.sx = ax || 0;
      d.sy = -ay || 0;
      const map = this.settings.input.pad as PadMap;
      let down = 0;
      for (const b of ["attack", "action", "bonus", "dodge", "reaction", "interact", "help"] as const) if (pressedNow[map[b]]) down |= BTN[b];
      if (pressedNow[PAD_UP]) down |= BTN.up;
      if (pressedNow[PAD_DOWN]) down |= BTN.down;
      if (pressedNow[PAD_LEFT]) down |= BTN.left;
      if (pressedNow[PAD_RIGHT]) down |= BTN.right;
      const edge = (i: number): boolean => !!pressedNow[i] && !prev[i];
      for (const b of ["attack", "action", "bonus", "dodge", "reaction", "interact", "help"] as const) {
        if (edge(map[b])) d.pending |= BTN[b];
        if (!pressedNow[map[b]] && prev[map[b]]) d.pendingUp |= BTN[b];
      }
      if (edge(PAD_UP)) { d.pending |= BTN.up; d.menu |= MENU.up; }
      if (edge(PAD_DOWN)) { d.pending |= BTN.down; d.menu |= MENU.down; }
      if (edge(PAD_LEFT)) { d.pending |= BTN.left; d.menu |= MENU.left; }
      if (edge(PAD_RIGHT)) { d.pending |= BTN.right; d.menu |= MENU.right; }
      // Analog stick also navigates menus (with a simple threshold edge).
      const pa = (prev as boolean[] & { stick?: [number, number] }).stick ?? [0, 0];
      const sxEdge = Math.abs(d.sx) > 0.6 && Math.abs(pa[0]) <= 0.6 ? Math.sign(d.sx) : 0;
      const syEdge = Math.abs(d.sy) > 0.6 && Math.abs(pa[1]) <= 0.6 ? Math.sign(d.sy) : 0;
      if (sxEdge > 0) d.menu |= MENU.right;
      if (sxEdge < 0) d.menu |= MENU.left;
      if (syEdge > 0) d.menu |= MENU.up;
      if (syEdge < 0) d.menu |= MENU.down;
      if (edge(0)) d.menu |= MENU.confirm;
      if (edge(1)) d.menu |= MENU.back;
      if (edge(map.help)) d.menu |= MENU.help;
      if (edge(map.action)) d.menu |= MENU.alt;
      if (edge(PAD_START)) { d.start = true; d.menu |= MENU.start; }
      if (edge(PAD_BACK)) { d.back = true; d.menu |= MENU.tab; }
      d.down = down;
      void dpx; void dpy;
      const st = pressedNow as boolean[] & { stick?: [number, number] };
      st.stick = [d.sx, d.sy];
      this.prevPadButtons.set(p.index, st);
    }
  }

  connectedDevices(): DeviceId[] {
    return [...this.devices.keys()];
  }

  hasPads(): boolean {
    return [...this.devices.keys()].some((k) => k.startsWith("pad"));
  }

  /** Did this device ask to join (A/Start on a pad, Enter / Right Shift on a keyboard)? Consumes it. */
  takeJoin(id: DeviceId): boolean {
    const d = this.devices.get(id);
    if (!d) return false;
    const j = d.start || (id.startsWith("pad") && (d.menu & MENU.confirm) !== 0);
    d.start = false;
    return j;
  }

  takeMenu(id: DeviceId): number {
    const d = this.devices.get(id);
    if (!d) return 0;
    const m = d.menu;
    d.menu = 0;
    return m;
  }

  /** Read menu edges without consuming them. */
  peekMenu(id: DeviceId): number {
    return this.devices.get(id)?.menu ?? 0;
  }

  /** Clear menu edges on every device (e.g. after a screen change). */
  flushMenus(): void {
    for (const d of this.devices.values()) { d.menu = 0; d.start = false; }
    this.tabPressed = false;
  }

  /** Build the sim input frame for a device for one tick (consumes accumulated edges). */
  frame(id: DeviceId, toggleInteract: boolean): InputFrame {
    const d = this.devices.get(id);
    if (!d) return EMPTY_INPUT;
    const w = screenToWorld(d.sx, d.sy);
    let down = d.down | d.pending;
    if (toggleInteract) {
      // Accessibility: Interact latches on press instead of needing to be held.
      if (d.pending & BTN.interact) this.holdToggle.set(id, !this.holdToggle.get(id));
      if (this.holdToggle.get(id)) down |= BTN.interact;
      else down &= ~BTN.interact;
    }
    const f: InputFrame = { mx: w.x, mz: w.z, down, pressed: d.pending, released: d.pendingUp };
    d.pending = 0;
    d.pendingUp = 0;
    return f;
  }

  /** Raw stick for menu cursors (initiative planning). */
  stick(id: DeviceId): { x: number; y: number } {
    const d = this.devices.get(id);
    return d ? { x: d.sx, y: d.sy } : { x: 0, y: 0 };
  }

  glyphsFor(id: DeviceId): GlyphSet {
    if (id === "kbA" || id === "kbB") return "keyboard";
    const pref = this.settings.accessibility.glyphs;
    if (pref !== "auto") return pref;
    const name = (this.devices.get(id)?.id ?? "").toLowerCase();
    if (/054c|dualsense|dualshock|wireless controller|playstation/.test(name)) return "playstation";
    if (/057e|pro controller|joy-con|nintendo|switch/.test(name)) return "switch";
    return "xbox";
  }
}

/** Button labels per glyph set (standard mapping positions). */
export const GLYPHS: Record<GlyphSet, Record<number, string>> = {
  xbox: { 0: "A", 1: "B", 2: "X", 3: "Y", 4: "LB", 5: "RB", 6: "LT", 7: "RT", 8: "View", 9: "Menu" },
  playstation: { 0: "✕", 1: "○", 2: "□", 3: "△", 4: "L1", 5: "R1", 6: "L2", 7: "R2", 8: "Create", 9: "Options" },
  switch: { 0: "B", 1: "A", 2: "Y", 3: "X", 4: "L", 5: "R", 6: "ZL", 7: "ZR", 8: "-", 9: "+" },
  keyboard: {},
};

export function keyLabel(code: string): string {
  return code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num").replace("ShiftRight", "RShift").replace("ShiftLeft", "LShift").replace(/^Arrow/, "");
}

/** Human label for a logical button on a device. */
export function buttonLabel(input: Input, id: DeviceId, b: "attack" | "action" | "bonus" | "dodge" | "reaction" | "interact" | "help"): string {
  const g = input.glyphsFor(id);
  if (g === "keyboard") return keyLabel((id === "kbA" ? input.settings.input.keysA : input.settings.input.keysB)[b]);
  return GLYPHS[g][input.settings.input.pad[b]] ?? `B${input.settings.input.pad[b]}`;
}
