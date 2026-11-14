// Turns the fetched packs in .cache/asset-src into game-ready files in public/assets and
// writes public/assets/manifest.json. Models go through glTF-Transform: unused animations
// are dropped, then dedup + prune + resample. Recolors for kitbashed characters are baked here.
import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, resample } from "@gltf-transform/functions";
import { PNG } from "pngjs";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import models from "../src/data/models.json" with { type: "json" };
import { SRC_ROOT } from "./fetch-assets";

const OUT = join(process.cwd(), "public", "assets");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const PACK = {
  adventurers: join(SRC_ROOT, "KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures"),
  skeletons: join(SRC_ROOT, "KayKit-Character-Pack-Skeletons-1.0/addons/kaykit_character_pack_skeletons"),
  dungeon: join(SRC_ROOT, "KayKit-Dungeon-Remastered-1.0/addons/kaykit_dungeon_remastered/Assets/gltf"),
  hex: join(SRC_ROOT, "KayKit-Medieval-Hexagon-Pack-1.0/addons/kaykit_medieval_hexagon_pack/Assets/gltf"),
  ninja: join(SRC_ROOT, "NinjaAdventure"),
};

interface ManifestEntry { id: string; kind: string; file: string; bytes: number; source: string; license: string; animations?: string[]; note?: string }
const manifest: ManifestEntry[] = [];

function add(e: Omit<ManifestEntry, "bytes">): void {
  manifest.push({ ...e, bytes: statSync(join(OUT, e.file)).size });
}

const keepAnims = new Set(Object.values(models.anims).flat());

async function optimise(doc: Document): Promise<void> {
  await doc.transform(dedup(), prune(), resample());
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function recolor(src: Buffer, op: { hueShift: number; sat: number; light: number }): Buffer {
  const png = PNG.sync.read(src);
  for (let i = 0; i < png.data.length; i += 4) {
    const [h, s, l] = rgbToHsl(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
    const [r, g, b] = hslToRgb((((h + op.hueShift) % 360) + 360) % 360, Math.min(1, s * op.sat), Math.min(1, l * op.light));
    png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b;
  }
  return PNG.sync.write(png);
}

async function buildCharacters(): Promise<void> {
  mkdirSync(join(OUT, "models"), { recursive: true });
  mkdirSync(join(OUT, "textures"), { recursive: true });
  const baseTextures: Record<string, Buffer> = {};
  for (const [name, rel] of Object.entries(models.bases)) {
    const [pack, file] = rel.split("/") as ["adventurers" | "skeletons", string];
    const doc = await io.read(join(PACK[pack], "Characters/gltf", `${file}.glb`));
    const root = doc.getRoot();
    for (const a of root.listAnimations()) if (!keepAnims.has(a.getName())) a.dispose();
    for (const t of root.listTextures()) {
      const img = t.getImage();
      if (img && t.getName()) baseTextures[t.getName()] = Buffer.from(img);
    }
    await optimise(doc);
    const out = `models/${name}.glb`;
    await io.write(join(OUT, out), doc);
    add({ id: name, kind: "character", file: out, source: `KayKit ${pack}`, license: "CC0-1.0", animations: root.listAnimations().map((a) => a.getName()) });
  }
  for (const [name, buf] of Object.entries(baseTextures)) {
    writeFileSync(join(OUT, "textures", `${name}.png`), buf);
    add({ id: name, kind: "texture", file: `textures/${name}.png`, source: "KayKit", license: "CC0-1.0" });
  }
  for (const [name, op] of Object.entries(models.recolors)) {
    const src = baseTextures[op.from];
    if (!src) throw new Error(`recolor ${name}: missing base texture ${op.from}`);
    writeFileSync(join(OUT, "textures", `${name}.png`), recolor(src, op));
    add({ id: name, kind: "texture", file: `textures/${name}.png`, source: `recolor of ${op.from}`, license: "CC0-1.0", note: op.why });
  }
  for (const [name, rel] of Object.entries(models.weapons)) {
    const [pack, file] = rel.split("/") as ["skeletons", string];
    const doc = await io.read(join(PACK[pack], "Assets/gltf", `${file}.gltf`));
    await optimise(doc);
    const out = `models/${name}.glb`;
    await io.write(join(OUT, out), doc);
    add({ id: name, kind: "weapon", file: out, source: `KayKit ${pack}`, license: "CC0-1.0" });
  }
}

async function buildDungeon(): Promise<void> {
  mkdirSync(join(OUT, "props"), { recursive: true });
  for (const name of models.dungeonProps) {
    const a = join(PACK.dungeon, `${name}.gltf.glb`), b = join(PACK.dungeon, `${name}.glb`);
    const src = existsSync(a) ? a : b;
    const doc = await io.read(src);
    await optimise(doc);
    const out = `props/${name}.glb`;
    await io.write(join(OUT, out), doc);
    add({ id: name, kind: "prop", file: out, source: "KayKit Dungeon Remastered", license: "CC0-1.0" });
  }
}

async function buildHex(): Promise<void> {
  mkdirSync(join(OUT, "hex"), { recursive: true });
  for (const rel of models.hexTiles) {
    const doc = await io.read(join(PACK.hex, `${rel}.gltf`));
    await optimise(doc);
    const id = basename(rel);
    const out = `hex/${id}.glb`;
    await io.write(join(OUT, out), doc);
    add({ id, kind: "hex", file: out, source: "KayKit Medieval Hexagon", license: "CC0-1.0" });
  }
}

function copyNinja(): void {
  mkdirSync(join(OUT, "ui"), { recursive: true });
  mkdirSync(join(OUT, "music"), { recursive: true });
  const copy = (from: string, to: string, id: string, kind: string): void => {
    copyFileSync(join(PACK.ninja, from), join(OUT, to));
    add({ id, kind, file: to, source: "Ninja Adventure", license: "CC0-1.0" });
  };
  copy("theme/font_normal.ttf", "ui/font.ttf", "font", "font");
  for (const f of readdirSync(join(PACK.ninja, "theme"))) if (f.endsWith(".png")) copy(`theme/${f}`, `ui/${f}`, f.replace(".png", ""), "ui");
  for (const f of readdirSync(join(PACK.ninja, "theme/theme_1"))) if (f.endsWith(".png")) copy(`theme/theme_1/${f}`, `ui/t1_${f}`, `t1_${f.replace(".png", "")}`, "ui");
  for (const f of readdirSync(join(PACK.ninja, "content/ui"))) if (f.endsWith(".png")) copy(`content/ui/${f}`, `ui/${f}`, f.replace(".png", ""), "ui");
  for (const f of readdirSync(join(PACK.ninja, "content/particle"))) if (f.endsWith(".png")) copy(`content/particle/${f}`, `ui/${f}`, f.replace(".png", ""), "particle");
  for (const f of readdirSync(join(PACK.ninja, "audio/music"))) if (f.endsWith(".ogg")) copy(`audio/music/${f}`, `music/${f}`, f.replace(".ogg", ""), "music");
}

/** Every gap the packs leave, and how it is filled. Kept in the manifest so the game and docs agree. */
const GAPS = [
  { gap: "Cleric hero", fill: "Knight rig with recolored 'cleric' texture, badge shield, no helmet" },
  { gap: "Owlbear", fill: "Barbarian rig at 1.7x scale, unarmed, recolored 'owlbear' texture" },
  { gap: "Wight", fill: "Skeleton Warrior at 1.25x, recolored 'wight' texture, blade + large shield" },
  { gap: "Young Black Dragon", fill: "Procedural kitbash of boxes/cones (src/render/procedural.ts) with wing-flap animation" },
  { gap: "Lich", fill: "Skeleton Mage at 1.3x, recolored 'lich' texture, staff" },
  { gap: "DM hand", fill: "Procedural low-poly hand (palm + 5 jointed fingers) in src/render/procedural.ts" },
  { gap: "Beasts (rat, wolf, frog, crocodile, spider, bats)", fill: "Procedural quadruped/spider/bat rigs with code-driven gait" },
  { gap: "Oozes, Mimic, Will-o'-wisp", fill: "Procedural translucent cube, chest prop + teeth, glowing orb" },
  { gap: "Downed crawl animation", fill: "Lie_Idle; revive uses Lie_StandUp" },
  { gap: "Shove animation", fill: "Unarmed_Melee_Attack_Kick" },
  { gap: "Hover/float for ghosts", fill: "Code-driven bob over Idle, translucent material" },
  { gap: "Sound effects", fill: "NinjaAdventure repo has no SFX: synthesized with Web Audio (src/audio/sfx.ts)" },
];

async function main(): Promise<void> {
  if (!existsSync(SRC_ROOT)) throw new Error("run `npm run fetch-assets` first");
  mkdirSync(OUT, { recursive: true });
  await buildCharacters();
  await buildDungeon();
  await buildHex();
  copyNinja();
  const total = manifest.reduce((s, e) => s + e.bytes, 0);
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ generated: "scripts/build-assets.ts", totalBytes: total, gaps: GAPS, assets: manifest }, null, 1));
  console.log(`built ${manifest.length} assets, ${(total / 1024 / 1024).toFixed(1)} MB`);
}

await main();
