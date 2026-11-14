# Engineering notes

Running log of decisions, findings and gotchas. Newest last.

## Step 1 — scaffold

- **Versions pinned** with `npm i -E`; lockfile committed. TypeScript is 6.0.3 because
  typescript-eslint 8.72 supports `<6.1`. Electron 45.3.2, three 0.187, Vite 8, Vitest 5, zod 4.
- **Electron output** is compiled by `tsc` to CommonJS in `dist-electron/` (the repo is ESM, so
  `scripts/write-electron-pkg.mjs` drops a `{"type":"commonjs"}` package.json there).
- **Sandboxed preload** can only `require("electron")`, so the IPC channel table is duplicated in
  `electron/preload.ts`; types still come from `src/shared/api.ts` (type-only import).
- **Network in the dev container**: GitHub web/API/release downloads are blocked, but `git` over
  HTTPS works, so `scripts/fetch-assets.ts` uses `git fetch --depth 1 origin <sha>` at pinned
  commits. Electron/electron-builder binaries were fetched locally via
  `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` and
  `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`.
  CI uses the defaults.
- **Shift-to-reopen launcher**: there is no API to read a held key at process start. The game window
  listens for a Shift keydown (OS key-repeat delivers it once the window is focused) during the first
  1.5 s and asks main to open the launcher. `--launcher` also forces it.
- **vsync** can only be changed before the GPU process starts, so it applies on next launch
  (`disable-gpu-vsync` + `disable-frame-rate-limit`).
- **Auto-update** only runs in packaged builds; the Linux deb/tar.gz and Windows portable builds
  cannot self-update, the launcher says so.
- **NinjaAdventure** repository has no LICENSE file; the pack is CC0 per the author's itch.io page.
  That repo only contains a subset of the full pack: the UI 9-slices, the pixel font, 4 music
  tracks and a few particles. It has **no SFX**, so sound effects are synthesized (see gaps).
- **pixelfx** ships `gallery/fonts/PatchPixel-Regular.woff2`, which is not MIT; we never copy it.

## Step 2 — look pipeline

- **Render targets are linear.** three.js only converts to sRGB when drawing to the canvas, so the
  first post pass (outline) converts the scene to sRGB; everything after (UI composite, palette
  quantize) works in sRGB like the palette itself.
- **Colour backgrounds force a clear.** `scene.background = Color` makes `WebGLBackground` clear even
  with `autoClear = false`, which wiped the scene when the VFX layer was drawn on top. The VFX pass
  temporarily sets the background to `null`.
- **Physical light units**: point lights need intensities in the tens (candle 45, torches 22).
- **pixelfx frames are big canvases around small effects**: VFX map 1 effect pixel to 1 low-res texel
  (scale quantized to 0.5 steps) instead of a world size. Billboards get a 1.5 m depth bias toward the
  camera and projectiles rotate along their screen-space velocity.
- KayKit `wall_half` is a half-*length* wall and `stairs` is 5x4x5 units; near walls are regular walls
  scaled to 28% height so the diorama stays readable.
- `docs/look-*.png` come from `tests/e2e/look.spec.ts` (Electron, `--look=on|off|fireball`).
- Headless Chromium for dev screenshots: `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` with
  SwiftShader; WebGL2 works.

## Steps 3–4 — co-op play and Act I

- **Inputs are per-tick frames**: devices accumulate presses/releases between sim ticks so a tap
  shorter than 16 ms is never lost. Menus read separate "menu edge" bits; `peekMenu` exists so the
  pause check doesn't eat other screens' input, and opening a menu flushes the press that opened it.
- **Screen-relative movement**: the stick's (right, up) maps to world `(x, z) = (r−u, −r−u)/√2` for the
  45° yaw camera.
- **The Ninja Adventure font** is crisp at 8/16 px but its space glyph is a hairline, so the UI sets
  canvas `wordSpacing`. The UI layer is composited with a hard alpha threshold (no half-covered
  pixels to dither) and dims with a 50% checkerboard instead of translucent fills.
- **Save files keep the raw JSON**: zod `.passthrough()` rebuilds objects with re-ordered keys, which
  changed the state hash after a load. The save is validated, then the original object is used.
- **Shared camera leash** lives in the sim (deterministic): heroes can't spread further than the
  zoom cap's view, measured in screen axes.
- **Hold vs tap**: Action/Bonus fire on release; holding for 0.4 s fires the alternate (Grease,
  Cunning Hide, Spiritual Weapon). Interact is hold-to-stabilize (or toggle in accessibility).
- Autoplay demo: `?demo=4&seed=5&speed=6` (or `--demo=4 --seed=5 --speed=6` in Electron) runs an
  all-AI party with the full UI; used by e2e tests and for screenshots.

## Step 7 — balance simulator

- `npm run balance` runs N seeded headless runs per party size in `worker_threads` (each worker
  loads TypeScript through `--import tsx`). All heroes are driven by the companion AI and menus by
  `src/sim/bot.ts`, so win rates measure the AI, not people; use them to compare tunings.
- **Real-time scaling** (`balance.json → realtime`): SRD numbers assume one attack per 6 s round, so
  hero HP and healing ×2.8, enemy HP ×5 (bosses a further ×3), hero attack tempo ×1.8 and enemy
  cooldowns ×1.3. Encounter XP budgets then scale per party size
  (`encounter.partySizeMultiplier`), boss HP likewise (`enemy.bossHpByPartySize`), and the Lone Hero
  gets ×1.4 HP plus the extra death save.
- **Bugs the simulator found**: the "collapsing floor" twist crashed with nobody standing; heroes and
  enemies walked into the same crate from opposite sides forever (sight lines ignore cover, but
  movement must not: `walkLine` vs `lineOfSight`, and companions now use A*); spawn rings could put
  enemies inside walls (spawns snap to walkable cells, anything inside geometry is popped out, and
  the DM drags stragglers into a fight that runs past 150 s); a downed Lone Hero ended the run before
  rolling a single death save (a TPK now needs nobody standing **and** nobody still rolling).

## Step 8 — polish and legal review

- **Legal sweep** (`grep -rniE "dungeons ?& ?dragons|d&d|wizards of the coast|dungeon master"`): the
  only hit is the SRD 5.2 attribution sentence in `CREDITS.md`, which CC BY 4.0 requires verbatim
  (it names the licensor; it is not branding). The in-game persona picker says "Game Master"
  instead of "Dungeon Master"; "DM" is used as the generic abbreviation. Monster names come from the
  SRD 5.2 (Owlbear, Young Black Dragon, Lich, Mimic, Wight…). Second subclasses that are not in the
  SRD are original (Shieldwarden, Pyromancer, Shadowblade, Grave Warden, …).
- pixelfx is MIT: licence and NOTICE ship in `LICENSES/`; its non-MIT Patch Pixel font is never
  copied. KayKit and Ninja Adventure are CC0 (the NinjaAdventure repo has no LICENSE file; CC0 per the
  author's itch.io page).
- **Draw calls**: the static room is merged into one mesh per material once the drop-in finishes
  (447 → 236 calls in the look test), and identity rims live on a colour-only layer so the normals
  pass skips them.
