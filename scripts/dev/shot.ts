// Dev helper: screenshot any game URL in headless Chromium against the Vite dev server.
//   npx tsx scripts/dev/shot.ts "<query>" out.png [waitMs] [keys...]
import { chromium } from "playwright";
const [query = "", out = "/tmp/shot.png", wait = "3000", ...keys] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const seen = new Set<string>();
page.on("console", (m) => { const t = m.text().slice(0, 600); if ((m.type() === "error" || m.type() === "warning") && !seen.has(t) && !t.includes("404")) { seen.add(t); console.log("console:", t); } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`http://localhost:5173/index.html?${query}`);
await page.waitForFunction(() => (window as unknown as { __rfrReady?: boolean }).__rfrReady === true, null, { timeout: 120000 });
for (const k of keys) { if (k.startsWith("wait:")) await page.waitForTimeout(Number(k.slice(5))); else { await page.keyboard.press(k); await page.waitForTimeout(250); } }
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
await browser.close();
console.log("wrote", out);
