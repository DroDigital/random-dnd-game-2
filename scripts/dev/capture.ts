// Dev helper: run an autoplay demo and screenshot when conditions are met.
import { chromium } from "playwright";
const out = process.argv[2] ?? "/tmp";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`http://localhost:5173/index.html?demo=4&seed=${process.argv[3] ?? 5}&speed=6`);
await page.waitForFunction(() => (window as unknown as { __rfrReady?: boolean }).__rfrReady === true, null, { timeout: 120000 });
type S = { s: { run: { phase: string; act: number }; init: unknown; enemies: { boss: boolean }[]; room: unknown } };
const want: Record<string, string> = { map: "phase=map", init: "initiative", boss: "boss room" };
const done = new Set<string>();
for (let i = 0; i < 400 && done.size < 3; i++) {
  const st = await page.evaluate(() => { const s = (window as unknown as { __rfr: { sim: S } }).__rfr.sim.s; return { phase: s.run.phase, act: s.run.act, init: !!s.init, boss: s.enemies.some((e) => e.boss) && !!s.room }; });
  const hit = !done.has("map") && st.phase === "map" ? "map" : !done.has("init") && st.init ? "init" : !done.has("boss") && st.boss && !st.init ? "boss" : null;
  if (hit) {
    if (hit === "map") await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/cap-${hit}.png` });
    console.log("captured", hit, want[hit], JSON.stringify(st));
    done.add(hit);
  }
  await page.waitForTimeout(250);
}
await browser.close();
