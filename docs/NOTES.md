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
