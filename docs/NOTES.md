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
