import { test, expect } from "@playwright/test";
import { copyFileSync, mkdirSync } from "node:fs";
import { launch } from "./helpers";
import { defaultSettings } from "../../src/shared/settings";

// Step 2 deliverable: three screenshots of the look pipeline, saved to docs/.
const settings = { ...defaultSettings(), display: { ...defaultSettings().display, renderScale: 2 } };

for (const [mode, file] of [["on", "look-effects-on.png"], ["off", "look-effects-off.png"], ["fireball", "look-mid-fireball.png"]] as const) {
  test(`look test: ${mode}`, async () => {
    const { app } = await launch({ args: ["--skip-launcher", `--look=${mode}`], settings });
    const page = await app.firstWindow();
    await page.waitForFunction(() => (window as unknown as { __rfrReady?: boolean }).__rfrReady === true, null, { timeout: 60_000 });
    await page.waitForTimeout(2500);
    const out = test.info().outputPath(file);
    await page.screenshot({ path: out });
    mkdirSync("docs", { recursive: true });
    copyFileSync(out, `docs/${file}`);
    const stats = await page.evaluate(() => {
      const g = (window as unknown as { __rfr: { renderer: { lightsUsed: number; vfx: { count: number } } } }).__rfr;
      return { lights: g.renderer.lightsUsed, vfx: g.renderer.vfx.count };
    });
    expect(stats.lights).toBeLessThanOrEqual(8);
    await app.close();
  });
}
