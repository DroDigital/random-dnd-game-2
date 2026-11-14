// Exports pixelfx effects to sprite sheets + JSON with pixelfx's own documented exporter
// (`node tools/render.mjs <id> --sheet`), then copies them to public/assets/vfx/<game-id>.{png,json}.
import { execFileSync } from "node:child_process";
import { PNG } from "pngjs";
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import vfx from "../src/data/vfx.json" with { type: "json" };
import { SRC_ROOT } from "./fetch-assets";

const PFX = join(SRC_ROOT, "pixelfx");
const OUT = join(process.cwd(), "public", "assets", "vfx");
const TMP = join(process.cwd(), ".cache", "vfx-render");
const MAX_FRAMES = 40;
const MAX_SIDE = 4096;
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

interface Sheet { meta: { size: { w: number; h: number }; pixelfx: { fps: number; loop: boolean; frames: number; frameSize: [number, number]; pivot: [number, number] } }; frames: { frame: { x: number; y: number; w: number; h: number }; duration: number }[] }
const index: Record<string, { file: string; w: number; h: number; frameW: number; frameH: number; frames: number; fps: number; loop: boolean; pivot: [number, number]; cols: number }> = {};

for (const [id, def] of Object.entries(vfx)) {
  const args = [join(PFX, "tools/render.mjs"), def.src, "--sheet", "--no-actor", "--out", TMP];
  if ("palette" in def && def.palette) args.push("--opts", JSON.stringify({ palette: def.palette }));
  execFileSync(process.execPath, args, { cwd: PFX, stdio: ["ignore", "pipe", "inherit"] });
  const name = def.src.split("/")[1]!;
  const dir = join(TMP, def.src);
  const sheet = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as Sheet;
  const px = sheet.meta.pixelfx;
  // Repack: keep at most MAX_FRAMES (dropping evenly, fps scaled to keep duration) in a <=4096px grid.
  const src = PNG.sync.read(readFileSync(join(dir, `${name}.png`)));
  const [fw, fh] = px.frameSize;
  const step = Math.max(1, Math.ceil(sheet.frames.length / MAX_FRAMES));
  const keep = sheet.frames.filter((_, i) => i % step === 0);
  const cols = Math.max(1, Math.min(keep.length, Math.floor(MAX_SIDE / fw)));
  const rows = Math.ceil(keep.length / cols);
  const out = new PNG({ width: cols * fw, height: rows * fh });
  keep.forEach((f, i) => PNG.bitblt(src, out, f.frame.x, f.frame.y, fw, fh, (i % cols) * fw, Math.floor(i / cols) * fh));
  writeFileSync(join(OUT, `${id}.png`), PNG.sync.write(out));
  index[id] = { file: `vfx/${id}.png`, w: out.width, h: out.height, frameW: fw, frameH: fh, frames: keep.length, fps: px.fps / step, loop: px.loop, pivot: px.pivot, cols };
  console.log(`${id.padEnd(18)} ${def.src.padEnd(28)} ${keep.length}f ${px.frameSize.join("x")} ${out.width}x${out.height} ${statSync(join(OUT, `${id}.png`)).size}B`);
}
writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 1));
console.log(`exported ${Object.keys(index).length} effects`);
