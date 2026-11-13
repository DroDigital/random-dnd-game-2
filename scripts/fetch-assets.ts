// Fetches third-party asset packs at pinned commits into .cache/asset-src/<name>.
// Uses plain git so it works anywhere git does (CI runners, behind proxies).
//   npm run fetch-assets            fetch missing packs
//   npm run fetch-assets -- --force re-fetch everything
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface AssetSource {
  name: string;
  repo: string;
  commit: string;
  license: string;
}

export const SOURCES: AssetSource[] = [
  { name: "KayKit-Character-Pack-Adventures-1.0", repo: "https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0", commit: "672074b73ba276876a19e8816ecdc5241817ab47", license: "CC0-1.0" },
  { name: "KayKit-Character-Pack-Skeletons-1.0", repo: "https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0", commit: "15b62b9bad122f72926c10fb14d622c73819fa54", license: "CC0-1.0" },
  { name: "KayKit-Dungeon-Remastered-1.0", repo: "https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0", commit: "b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07", license: "CC0-1.0" },
  { name: "KayKit-Medieval-Hexagon-Pack-1.0", repo: "https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0", commit: "84fa4e91af6a88989be7c99e0891cede11f2ca38", license: "CC0-1.0" },
  { name: "pixelfx", repo: "https://github.com/patch-gg/pixelfx", commit: "5294518ce7c72e48b6100a744596e0acf57f2826", license: "MIT" },
  { name: "NinjaAdventure", repo: "https://github.com/pixel-boy/NinjaAdventure", commit: "6ac78232d5aedcc85ce5f27d060ea92366f7c24a", license: "CC0-1.0" },
];

export const SRC_ROOT = join(process.cwd(), ".cache", "asset-src");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function head(dir: string): string | null {
  try {
    return git(dir, "rev-parse", "HEAD");
  } catch {
    return null;
  }
}

function fetchOne(s: AssetSource, force: boolean): void {
  const dir = join(SRC_ROOT, s.name);
  if (!force && existsSync(dir) && head(dir) === s.commit) {
    console.log(`ok    ${s.name} @ ${s.commit.slice(0, 8)}`);
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "remote", "add", "origin", s.repo);
  for (let attempt = 1; ; attempt++) {
    try {
      git(dir, "fetch", "-q", "--depth", "1", "origin", s.commit);
      break;
    } catch (e) {
      if (attempt >= 4) throw e;
      console.warn(`retry ${s.name} (${attempt})`);
    }
  }
  git(dir, "checkout", "-q", "FETCH_HEAD");
  console.log(`fetch ${s.name} @ ${s.commit.slice(0, 8)} (${s.license})`);
}

if (process.argv[1]?.endsWith("fetch-assets.ts")) {
  const force = process.argv.includes("--force");
  mkdirSync(SRC_ROOT, { recursive: true });
  for (const s of SOURCES) fetchOne(s, force);
}
