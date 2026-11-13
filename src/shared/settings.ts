import { z } from "zod";

/** Current on-disk settings version. Bump and add a migration step when the shape changes. */
export const SETTINGS_VERSION = 2;

export const KeyboardSchemeSchema = z.object({
  up: z.string(),
  down: z.string(),
  left: z.string(),
  right: z.string(),
  attack: z.string(),
  action: z.string(),
  bonus: z.string(),
  dodge: z.string(),
  reaction: z.string(),
  interact: z.string(),
  help: z.string(),
  join: z.string(),
});
export type KeyboardScheme = z.infer<typeof KeyboardSchemeSchema>;

export const PadMapSchema = z.object({
  attack: z.number().int(),
  dodge: z.number().int(),
  action: z.number().int(),
  bonus: z.number().int(),
  reaction: z.number().int(),
  interact: z.number().int(),
  help: z.number().int(),
});
export type PadMap = z.infer<typeof PadMapSchema>;

export const DEFAULT_KEYS_A: KeyboardScheme = {
  up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD",
  attack: "KeyF", action: "KeyG", bonus: "KeyH", dodge: "KeyR",
  reaction: "KeyT", interact: "KeyE", help: "KeyQ", join: "Enter",
};
export const DEFAULT_KEYS_B: KeyboardScheme = {
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
  attack: "Numpad1", action: "Numpad2", bonus: "Numpad3", dodge: "Numpad0",
  reaction: "Numpad4", interact: "Numpad5", help: "Numpad6", join: "ShiftRight",
};
/** Standard-mapping button indices. */
export const DEFAULT_PAD: PadMap = { attack: 0, dodge: 1, action: 2, bonus: 3, reaction: 5, interact: 4, help: 6 };

export const SettingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  display: z.object({
    mode: z.enum(["windowed", "fullscreen", "borderless"]),
    monitor: z.number().int().min(0),
    renderScale: z.number().int().min(2).max(6),
    vsync: z.boolean(),
  }),
  audio: z.object({
    master: z.number().min(0).max(1),
    music: z.number().min(0).max(1),
    sfx: z.number().min(0).max(1),
    ui: z.number().min(0).max(1),
  }),
  launcher: z.object({ skip: z.boolean() }),
  accessibility: z.object({
    holdMode: z.enum(["hold", "toggle"]),
    altIdentityColors: z.boolean(),
    combatSpeed: z.number().min(0.7).max(1),
    largeText: z.boolean(),
    noShake: z.boolean(),
    glyphs: z.enum(["auto", "xbox", "playstation", "switch"]),
    dither: z.boolean(),
  }),
  input: z.object({
    keysA: KeyboardSchemeSchema,
    keysB: KeyboardSchemeSchema,
    pad: PadMapSchema,
    deadzone: z.number().min(0).max(0.6),
  }),
  steam: z.object({ enabled: z.boolean() }),
});
export type Settings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    display: { mode: "windowed", monitor: 0, renderScale: 3, vsync: true },
    audio: { master: 0.8, music: 0.6, sfx: 0.8, ui: 0.7 },
    launcher: { skip: false },
    accessibility: {
      holdMode: "hold", altIdentityColors: false, combatSpeed: 1, largeText: false,
      noShake: false, glyphs: "auto", dither: true,
    },
    input: { keysA: { ...DEFAULT_KEYS_A }, keysB: { ...DEFAULT_KEYS_B }, pad: { ...DEFAULT_PAD }, deadzone: 0.2 },
    steam: { enabled: false },
  };
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep-merge `over` onto `base`, keeping only keys `base` knows. */
function mergeKnown(base: Json, over: Json): Json {
  const out: Json = { ...base };
  for (const k of Object.keys(base)) {
    const b = base[k];
    const o = over[k];
    if (o === undefined) continue;
    out[k] = isObj(b) && isObj(o) ? mergeKnown(b, o) : o;
  }
  return out;
}

/** Ordered upgrade steps; each mutates the raw JSON up to version `to`. */
const MIGRATIONS: { to: number; run: (d: Json) => void }[] = [
  {
    // v0 (pre-release) stored the music volume at the top level.
    to: 1,
    run: (d) => {
      if (typeof d.musicVolume === "number") d.audio = { ...(isObj(d.audio) ? d.audio : {}), music: d.musicVolume };
    },
  },
  // v2 added accessibility.dither and steam; defaults fill them in.
  { to: 2, run: () => undefined },
];

/**
 * Upgrade any older settings JSON to the current version. Unknown or invalid
 * fields fall back to defaults instead of throwing, so a bad file never bricks the game.
 */
export function migrateSettings(raw: unknown): Settings {
  const defaults = defaultSettings();
  if (!isObj(raw)) return defaults;
  const data: Json = { ...raw };
  const from = typeof data.version === "number" ? data.version : 0;
  for (const step of MIGRATIONS) if (from < step.to) step.run(data);
  data.version = SETTINGS_VERSION;
  const merged = mergeKnown(defaults as unknown as Json, data);
  const parsed = SettingsSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  // Field-level repair: reset each top-level section that fails.
  const repaired: Json = { ...merged };
  for (const issue of parsed.error.issues) {
    const top = issue.path[0];
    if (typeof top === "string") repaired[top] = (defaults as unknown as Json)[top];
  }
  const again = SettingsSchema.safeParse(repaired);
  return again.success ? again.data : defaults;
}
