import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`http://localhost:5173/index.html?${process.argv[2] ?? "look=on"}`);
await page.waitForFunction(() => (window as unknown as { __rfrReady?: boolean }).__rfrReady === true, null, { timeout: 120000 });
await page.waitForTimeout(3000);
const st = await page.evaluate(() => { const g = (window as unknown as { __rfr: { renderer: { stats: unknown; scene: { children: unknown[] } }; sim: { s: { heroes: unknown[]; enemies: unknown[] } } } }).__rfr; return { ...(g.renderer.stats as object), heroes: g.sim.s.heroes.length, enemies: g.sim.s.enemies.length }; });
console.log(JSON.stringify(st));
await browser.close();
