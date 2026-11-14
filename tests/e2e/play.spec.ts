import { test, expect, type Page } from "@playwright/test";
import { launch } from "./helpers";
import { defaultSettings } from "../../src/shared/settings";

const settings = { ...defaultSettings(), display: { ...defaultSettings().display, renderScale: 2 } };
type G = { screen: string; players: { slot: number; device: string }[]; sim: { s: { tick: number; heroes: { slot: number; hp: number }[]; enemies: unknown[]; run: { phase: string; map: { current: number } }; room: unknown } } | null };
const game = (page: Page): Promise<{ screen: string; players: number; phase: string; tick: number; heroes: number; enemies: number; room: boolean; node: number }> =>
  page.evaluate(() => {
    const g = (window as unknown as { __rfr: G }).__rfr;
    const s = g.sim?.s;
    return { screen: g.screen, players: g.players.length, phase: s?.run.phase ?? "", tick: s?.tick ?? 0, heroes: s?.heroes.length ?? 0, enemies: s?.enemies.length ?? 0, room: !!s?.room, node: s?.run.map.current ?? -1 };
  });

test("two players join on one keyboard, start a run, pick a node and fight", async () => {
  const { app } = await launch({ args: ["--skip-launcher"], settings });
  const page = await app.firstWindow();
  await page.waitForFunction(() => (window as unknown as { __rfrReady?: boolean }).__rfrReady === true, null, { timeout: 60_000 });
  await page.keyboard.press("Enter"); // P1 joins (WASD scheme)
  await page.keyboard.press("ShiftRight"); // P2 joins (arrows + numpad)
  await page.waitForTimeout(300);
  expect((await game(page)).players).toBe(2);
  await page.keyboard.press("KeyF"); // P1 confirms "Start a new run"
  await expect.poll(async () => (await game(page)).phase, { timeout: 10_000 }).toBe("actIntro");
  await page.keyboard.press("KeyF"); // begin the act
  await expect.poll(async () => (await game(page)).phase, { timeout: 10_000 }).toBe("map");
  await page.waitForTimeout(1200);
  await page.keyboard.press("KeyF"); // travel to the first node
  await expect.poll(async () => (await game(page)).room, { timeout: 10_000 }).toBe(true);
  const before = await game(page);
  expect(before.heroes).toBe(2);
  expect(before.enemies).toBeGreaterThan(0);
  // Walk and swing for a few seconds with both players.
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ArrowUp");
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("KeyF");
    await page.keyboard.press("Numpad1");
    await page.waitForTimeout(200);
  }
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ArrowUp");
  const after = await game(page);
  expect(after.tick).toBeGreaterThan(before.tick + 60);
  // Pause menu opens with Esc.
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __rfr: { paused: boolean } }).__rfr.paused)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("pause.png") });
  await app.close();
});

test("an AI party autoplays rooms with the full UI (4 heroes)", async () => {
  const { app } = await launch({ args: ["--skip-launcher", "--demo=4", "--seed=5"], settings });
  const page = await app.firstWindow();
  await page.waitForFunction(() => (window as unknown as { __rfrReady?: boolean }).__rfrReady === true, null, { timeout: 60_000 });
  await expect.poll(async () => (await game(page)).node, { timeout: 60_000 }).toBeGreaterThan(1);
  await page.screenshot({ path: test.info().outputPath("demo.png") });
  await app.close();
});
