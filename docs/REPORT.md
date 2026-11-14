# Roll for Ruin — final report

State of the build at the end of the eight-step plan. Everything below is reproducible from the
repository: `npm ci && npm run assets && npm run lint && npm test && npm run build && npm run test:e2e`.

## What's done

**Platform and release**
- Electron app with a launcher (Play, Settings incl. display mode / monitor / render scale 2–6× /
  vsync / volumes / accessibility, 4-pad controller tester, Credits & Licenses, update status, Open
  logs, Skip launcher, Shift-at-startup to reopen). `contextIsolation`, `sandbox`, no
  `nodeIntegration`, typed preload API only, `backgroundThrottling: false`.
- Versioned settings/meta/run saves (zod + migrations, atomic writes), rotating logs, crash reports.
- electron-builder: Windows NSIS + portable, macOS universal dmg (+ zip), Linux AppImage/deb/tar.gz;
  electron-updater against GitHub Releases. Signing/notarization only when secrets exist; unsigned
  builds documented in the README.
- GitHub Actions on Windows, macOS, Linux: lint → Vitest → Playwright (xvfb on Linux) → installers;
  a `v*` tag publishes a release. Green on the latest pushed commits.

**Look ("Candlelit Diorama")**
- 480×270 (+1 px margin) render target with depth texture, normals pass, 1 px depth+normal ink
  outline, tilt-shift, UI composite, 16-colour palette quantize with optional 4×4 Bayer, integer
  nearest upscale with letterbox. Orthographic 35°/45° camera snapped to the texel grid with the
  sub-texel remainder applied in the upscale. MeshToonMaterial with a 3-step gradient everywhere.
  Fixed pool of 8 point lights reassigned per frame; VFX borrow lights for their lifetime.
- KayKit models through glTF-Transform; rooms drop onto a wooden table with dust; candle and
  per-player dice; per-act ambient mood. pixelfx VFX exported with its own exporter.
- Debug keys F1–F5 (passes), F9 (stats), F12 (screenshot). Screenshots in `docs/`.

**Rules and simulation**
- `src/rules` at 100% statement/branch/function/line coverage (enforced): xoshiro128**, dice,
  advantage/disadvantage, attacks (nat 20 doubles dice + 80 ms hitstop, nat 1 stagger, Graze), saves,
  checks, death saves, conditions, Round Clock, initiative, SRD 5.2 XP budgets.
- Deterministic 60 Hz sim with no three.js/DOM (ESLint-enforced). Tests prove same seed + same inputs
  → same state, and save → JSON → load continues bit-identically.
- 10 classes (4 starting + 6 unlockable), 2 subclasses each, level-up cards, Round Clock gating,
  reactions only inside telegraphs, i-frame dodges, AoE saves for half, all 7 conditions, downed state
  with death saves every 3 s, stabilize by holding Interact, Healing Word revives, fallen heroes
  return at a campfire one level down with an injury, TPK ends the run.
- Combos verified by tests: Grease + fire → burning field; shove/prone → advantage → Sneak Attack;
  Spiritual Weapon counts as a flanking ally.
- 31 enemies with SRD 5.2 stats (27 regular + Wight, Owlbear, Young Black Dragon, Lich), state-machine
  AI (idle → chase → telegraph → attack → recover) with A* on a 1 m nav grid; Legendary Actions start
  Initiative Breaks (simultaneous planning, 10 s cap, initiative order, max 3 per boss).
- Four acts on branching hex maps revealed by the DM's hand; Encounter / Elite / Skill / Merchant /
  Campfire / Mystery (Mimic) nodes; hand-authored room templates filled procedurally; long rest
  between acts; 62 items with rarity and 3 attunement slots; Need/Greed rolls; shared gold.
- DM Director: Boredom → twists (ambush, rival party, collapsing floor), Mercy potion, Delight →
  Inspiration and better Mystery rooms; typewriter narration; four personas incl. 10 Killer tiers.
- Tavern hub: joining, class/background pick, solo modes (Lone Hero, or 3 AI companions with D-pad
  orders and full control in an Initiative Break), personas, Renown shop (classes, backgrounds,
  personas, start items, dice skins, decor, capped permanent bonuses), Hall of Heroes with Heirlooms,
  resume saved run.
- Input: keyboard (two shared-keyboard schemes) + Gamepad API (standard mapping, deadzone, hot-plug,
  first-press hint); rebindable; Xbox/PlayStation/Switch glyphs. Player identity is colour + shape on
  the ground ring, model rim and dice; ally VFX at 60% opacity; one shared camera with a zoom cap and a
  deterministic edge leash.
- Accessibility: hold/toggle, alternative identity colours, combat speed 70–100%, large text, no
  shake, dithering toggle, glyph override.
- Steamworks (steamworks.js) behind a flag: achievements, overlay for Remote Play Together.
- Balance simulator: `npm run balance` → `docs/BALANCE.md` (1,000 runs per party size).

**Tests**: 116 unit/integration tests (Vitest) and 7 Playwright `_electron` tests (launcher, skip
launcher, three look-test screenshots, two keyboard players joining and fighting, a 4-hero AI autoplay).

## What's placeholder / kitbashed

- **Models the packs don't have** (all listed in `public/assets/manifest.json` → `gaps`): Cleric
  (recoloured Knight), Owlbear (scaled, recoloured Barbarian), Wight (recoloured Skeleton Warrior),
  Lich (recoloured Skeleton Mage), Young Black Dragon / beasts / oozes / Mimic / Will-o'-wisp / DM
  hand (procedural box-and-cone kitbashes with code-driven animation). Goblins, kobolds, hobgoblins,
  lizardfolk, bandits, cultists, bugbears and ogres are recoloured adventurer rigs.
- **Animations**: no crawl, shove or hover clips; downed uses `Lie_Idle`, shove uses a kick, ghosts
  bob in code.
- **Sound effects** are synthesized in Web Audio: the Ninja Adventure repository ships only the UI,
  font, four music tracks and particles, no SFX.
- **Hero portraits** in the HUD are class-coloured tiles with an initial, not art.
- **Second subclasses** are original designs (only one per class is in the SRD 5.2).
- **Steam achievements** need to be created with the same ids in a real Steam app.

## Known bugs and gaps

- **60 fps on Apple M1 / Intel Iris Xe is not verified**: this environment only has SwiftShader
  (software GL, ~10 fps for everything). Measured here: ~236 draw calls and ~9 ms CPU frame time with
  4 heroes + 4 enemies after merging the static room; 12 enemies add roughly 20 calls each pass.
  Skinned characters are the remaining cost (each is ~9 meshes drawn in two passes).
- **Real controllers were not tested** (no hardware in CI); the Gamepad path is covered by code review
  and the controller tester page only. Keyboard co-op is tested end to end.
- **Balance is tuned against the companion AI**, not people. Latest 1,000-run batch per size: 47.8% /
  59.2% / 63.4% / 71.1% wins for 1–4 heroes, bosses take 1–2 minutes (`docs/BALANCE.md`). Solo
  Wizards and Rogues are much weaker than solo Fighters and Clerics (most die in Act III). Expect
  human runs to be harder than the AI's.
- 9 of 4,000 simulated runs (0.2%) still hit the 90-minute cap, usually a long Act III/finale fight
  against kiting casters; a DM failsafe and "late fight" AI change cut this from ~1%.
- Initiative Break planning in solo-party mode cycles through companions with one controller; it
  works but the UI doesn't yet highlight whose plan you're editing.
- Players who join at a campfire get the first unused class (no class picker mid-run).
- Large text enlarges menus and narration, not the compact HUD panels.
- The Linux `.deb`/`.tar.gz` and the Windows portable build cannot self-update (by design of
  electron-updater); the launcher says so.

## Key tuning values (`src/data/balance.json`)

| Knob | Value | Why |
|---|---|---|
| `realtime.heroHpScale` / `healScale` | 2.8 / 2.8 | SRD HP assumes one hit per 6 s round |
| `realtime.enemyHpScale` / `bossHpScale` | 5 / ×3 more | rooms last ~15–25 s, bosses ~1–1.5 min |
| `realtime.heroAttackTempo` | 1.8 | ~0.8 s per basic attack |
| `realtime.enemyCooldownScale` | 1.3 | enemy attack cadence |
| `encounter.partySizeMultiplier` | 0.85 / 1.1 / 1.75 / 3.0 | flattens win rate across 1–4 players |
| `enemy.damageByPartySize` | 1.0 / 1.0 / 1.15 / 1.5 | enemy counts cap at 14, so big parties also face harder hits |
| `enemy.bossHpByPartySize` | 0.45 / 0.9 / 1.5 / 2.6 | same, for bosses |
| `hero.loneHpMult` | 1.4 × (10 ÷ hit die) | Lone Hero toughness (+1 death save) |
| `hero.dodge` | 18 ticks, 13 i-frames, 24-tick cooldown | |
| `hero.deathSaveTicks` / `stabilizeTicks` | 180 / 120 | 3 s per save, 2 s hold to stabilize |
| `initiativeBreak` | 10 s plan, 6 tiles, max 3 per boss | |
| Director | Boredom 1.6/s idle, twist at 100; Delight +12 per nat 20, +15 per combo, Inspiration at 50 | |

## Installer sizes

| Build | Size | Source |
|---|---|---|
| Linux AppImage | 160.8 MB | local build |
| Linux .deb | 123.9 MB | local build |
| Linux .tar.gz | 154.0 MB | local build |
| Windows NSIS + portable | 282.8 MB together (≈141 MB each) | CI artifact |
| macOS universal .dmg + .zip | 507.0 MB together (≈254 MB each; universal = two Electron copies) | CI artifact |

About 45 MB of the payload is game assets (models 26 MB, VFX 11 MB, music 5 MB); the rest is Electron.
