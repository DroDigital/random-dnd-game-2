// Dev helper: screenshot the look test in plain Chromium against the Vite dev server.
import { chromium } from "playwright";
const mode = process.argv[2] ?? "on";
const out = process.argv[3] ?? `/tmp/look-${mode}.png`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
const seen = new Set<string>(); page.on("console", (m) => { const t = m.text().slice(0, 1500); if ((m.type() === "error" || m.type() === "warning") && !seen.has(t)) { seen.add(t); console.log("console:", t); } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`http://localhost:5173/index.html?look=${mode}`);
await page.waitForFunction(() => (window as unknown as { __rfrReady?: boolean }).__rfrReady === true, null, { timeout: 120000 });
await page.waitForTimeout(2500); if (process.env.STATS) await page.keyboard.press("F9"); await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
console.log("wrote", out);
