import { test, expect } from "@playwright/test";
import { launch } from "./helpers";

test("launcher opens, shows settings and credits, and Play opens the game", async () => {
  const { app } = await launch();
  const launcher = await app.firstWindow();
  await expect(launcher.getByTestId("play")).toBeVisible();
  await expect(launcher.getByTestId("set-scale")).toBeVisible();
  await launcher.getByTestId("tab-credits").click();
  await expect(launcher.getByTestId("credits")).toContainText("SRD 5.2");
  await launcher.getByTestId("tab-controllers").click();
  await expect(launcher.getByTestId("pads")).toBeVisible();
  const gamePromise = app.waitForEvent("window");
  await launcher.getByTestId("play").click();
  const game = await gamePromise;
  await game.waitForFunction(() => (window as unknown as { __rfrReady?: boolean }).__rfrReady === true, null, { timeout: 30_000 });
  const sandboxed = await game.evaluate(() => typeof (window as unknown as { require?: unknown }).require === "undefined" && typeof (window as unknown as { rfr?: unknown }).rfr === "object");
  expect(sandboxed).toBe(true);
  await app.close();
});

test("skip launcher opens the game directly", async () => {
  const { app } = await launch({ args: ["--skip-launcher"] });
  const game = await app.firstWindow();
  await game.waitForFunction(() => (window as unknown as { __rfrReady?: boolean }).__rfrReady === true, null, { timeout: 30_000 });
  expect(await game.title()).toBe("Roll for Ruin");
  await app.close();
});
