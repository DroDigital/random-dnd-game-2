// Dev helper: screenshot every UI screen via ?ui=<screen> (Vite dev server must be running).
import { chromium } from "playwright";
const out = process.argv[2] ?? "/tmp";
const screens = (process.argv[3] ?? "tavern,intro,map,room,init,levelup,campfire,merchant,skill,loot,pause,summary,shop,hall,credits,large").split(",");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const s of screens) {
  const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 960), height: Number(process.env.H ?? 540) } });
  page.on("pageerror", (e) => console.log(s, "pageerror:", e.message));
  await page.goto(`http://localhost:5173/index.html?ui=${s}`);
  await page.waitForFunction(() => (window as unknown as { __rfrReady?: boolean }).__rfrReady === true, null, { timeout: 120000 });
  await page.waitForTimeout(s === "credits" ? 2500 : 4000);
  await page.screenshot({ path: `${out}/ui-${s}.png` });
  await page.close();
  console.log("ok", s);
}
await browser.close();
