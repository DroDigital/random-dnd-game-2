import { describe, expect, it } from "vitest";
import { defaultSettings, migrateSettings, SETTINGS_VERSION } from "./settings";

describe("settings migration", () => {
  it("returns defaults for garbage", () => {
    expect(migrateSettings("nope")).toEqual(defaultSettings());
    expect(migrateSettings(null)).toEqual(defaultSettings());
  });
  it("upgrades v0 top-level music volume", () => {
    const s = migrateSettings({ musicVolume: 0.25 });
    expect(s.version).toBe(SETTINGS_VERSION);
    expect(s.audio.music).toBe(0.25);
  });
  it("keeps valid fields and repairs invalid sections", () => {
    const s = migrateSettings({ version: 1, display: { renderScale: 99 }, audio: { sfx: 0.1 } });
    expect(s.display).toEqual(defaultSettings().display);
    expect(s.audio.sfx).toBe(0.1);
  });
  it("drops unknown keys", () => {
    const s = migrateSettings({ version: 2, bogus: true }) as unknown as Record<string, unknown>;
    expect("bogus" in s).toBe(false);
  });
});
