import { Game } from "./game";
import { loadFont, loadUiImages } from "../ui/draw";

async function boot(): Promise<void> {
  const screen = document.getElementById("screen") as HTMLCanvasElement;
  const params = new URLSearchParams(location.search);
  await loadFont();
  await loadUiImages(["t1_nine_path_panel", "t1_nine_path_bg", "t1_nine_path_bg_2", "t1_nine_path_focus", "t1_button_normal", "t1_button_hover", "heart", "heart_2", "heart_3", "nine_path_2", "nine_path_3", "nine_path_7", "nine_path_12", "nine_path_4"]);
  const game = new Game(screen, { look: params.get("look"), demo: params.get("demo"), seed: params.get("seed") });
  (window as unknown as { __rfr: Game }).__rfr = game;
  await game.start();
}

void boot().catch((e: unknown) => {
  console.error(e);
  window.rfr?.log("error", `boot failed: ${String((e as Error)?.stack ?? e)}`);
});
