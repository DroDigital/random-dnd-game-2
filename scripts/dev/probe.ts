import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`http://localhost:5173/index.html?look=${process.argv[2] ?? "on"}`);
await page.waitForFunction(() => (window as unknown as { __rfrReady?: boolean }).__rfrReady === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const out = await page.evaluate(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = (window as any).__rfr;
  const r = g.renderer;
  const res: string[] = [];
  for (const [id, v] of r.actors) {
    const h = g.sim.s.heroes.find((x: { id: number }) => x.id === id);
    if (h) {
      const wp = new v.model.root.position.constructor();
      v.model.root.getWorldPosition(wp);
      res.push(`hero ${h.cls} sim ${h.x.toFixed(2)},${h.z.toFixed(2)} root ${v.root.position.x.toFixed(2)},${v.root.position.z.toFixed(2)} modelWorld ${wp.x.toFixed(2)},${wp.z.toFixed(2)}`);
    }
  }
  const kids = r.roomGroup.children.slice(0, 6).map((o: { position: { x: number; y: number; z: number }; rotation: { y: number } }) => `${o.position.x.toFixed(1)},${o.position.y.toFixed(1)},${o.position.z.toFixed(1)} r${o.rotation.y.toFixed(2)}`);
  res.push("room children: " + kids.join(" | "));
  res.push("cam focus " + JSON.stringify(r.cam.focus) + " h " + r.cam.height);
  res.push("proj " + JSON.stringify(g.sim.s.projectiles.map((p: {kind: string; x: number; z: number; life: number}) => [p.kind, p.x.toFixed(1), p.z.toFixed(1), p.life]))); res.push("vfx " + r.vfx.count + " wizard slots " + g.sim.s.heroes[1].slots + " enemies " + g.sim.s.enemies.length);
  return res.join("\n");
});
console.log(out);
await browser.close();
