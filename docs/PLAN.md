# Roll for Ruin — Plan

Build order from the brief. Each step is committed when done; status is kept current here.

| # | Step | Status |
|---|---|---|
| 1 | Scaffold, launcher, CI, installers for all 3 OSes | done |
| 2 | Look pipeline (one-room test) + 3 Playwright screenshots in `docs/` | done |
| 3 | Rules, Round Clock, 4 classes, Skeletons, 1–4 player co-op, downed state | done |
| 4 | Act I end to end: hex map, nodes, rooms, level-ups, rests, Wight + Initiative Break, save/resume | done |
| 5 | DM Director, skill checks, loot, tavern, Renown, Hall of Heroes | done |
| 6 | Acts II–III, finale, all enemies, items, subclasses | todo |
| 7 | Balance simulator (1,000 seeded headless runs per party size) | todo |
| 8 | Accessibility, Steam, final credits, legal review | todo |

## Architecture

- `electron/` main + sandboxed preload (typed `window.rfr` API, see `src/shared/api.ts`).
- `src/shared/` code shared by main and renderers (settings schema + migrations, IPC types).
- `src/rules/` pure dice math. No state besides an injected RNG. 100% unit-tested.
- `src/sim/` deterministic 60 Hz fixed-step simulation. No three.js, no DOM (enforced by ESLint).
- `src/data/` JSON balance data validated by zod at load.
- `src/render/` three.js renderer reading sim snapshots, interpolating between the last two.
- `src/input/` keyboard + Gamepad API polling → per-player input frames.
- `src/audio/` Web Audio buses (music / sfx / ui) with ducking.
- `src/ui/` everything drawn on the 480×270 UI canvas.
- `src/launcher/` the launcher window (DOM).
- `scripts/` asset fetch / build / VFX export, balance simulator, icon.
