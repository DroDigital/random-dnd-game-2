import { ROOMS, type ActDef } from "../data";
import type { CellType, NodeKind, RoomProp, RoomState } from "./types";
import type { Rng } from "../rules/rng";

const TILE = ROOMS.tileSize;

/** Build a room from a hand-authored template. Spawns/cover/hazards come from markers; props are filled per act. */
export function buildRoom(templateId: string, kind: NodeKind | "tavern", rng: Rng, act: ActDef | null, tick: number, trap = false): RoomState {
  const t = ROOMS.templates[templateId];
  if (!t) throw new Error(`unknown room template ${templateId}`);
  const map = t.map;
  const th = map.length, tw = map[0]!.length;
  const w = tw * TILE, h = th * TILE;
  const cells: CellType[] = new Array(w * h).fill(4);
  const props: RoomProp[] = [];
  const heroSpawns: { x: number; z: number }[] = [];
  const enemySpawns: { x: number; z: number }[] = [];
  const bossSpawns: { x: number; z: number }[] = [];
  let exit = { x: w / 2, z: h - 1 };
  const ch = (x: number, z: number): string => (z >= 0 && z < th && x >= 0 && x < tw ? map[z]![x]! : " ");
  const isWall = (c: string): boolean => c === "#" || c === "T";
  const isInside = (c: string): boolean => c !== " " && !isWall(c);
  const setTile = (tx: number, tz: number, v: CellType): void => {
    for (let dz = 0; dz < TILE; dz++) for (let dx = 0; dx < TILE; dx++) cells[(tz * TILE + dz) * w + tx * TILE + dx] = v;
  };
  for (let tz = 0; tz < th; tz++) for (let tx = 0; tx < tw; tx++) {
    const c = ch(tx, tz);
    const cx = tx * TILE + TILE / 2, cz = tz * TILE + TILE / 2;
    if (c === " ") continue;
    if (isWall(c)) {
      setTile(tx, tz, 1);
      // Wall segments on edges facing the inside of the room.
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (!isInside(ch(tx + dx, tz + dz))) continue;
        const near = dx < 0 || dz < 0 ? 1 : 0; // wall sits on +x/+z side of the floor → near the camera
        props.push({ kind: "wall", x: cx + dx * TILE * 0.5, z: cz + dz * TILE * 0.5, rot: dx !== 0 ? Math.PI / 2 : 0, variant: near });
        if (c === "T") props.push({ kind: "torch", x: cx + dx * TILE * 0.5, z: cz + dz * TILE * 0.5, rot: Math.atan2(dx, dz), variant: 0 });
      }
      continue;
    }
    const floorVariant = rng.float() < 0.18 ? 1 : 0;
    props.push({ kind: "floor", x: cx, z: cz, rot: 0, variant: floorVariant });
    setTile(tx, tz, 0);
    switch (c) {
      case "S": heroSpawns.push({ x: cx, z: cz }); break;
      case "E": enemySpawns.push({ x: cx, z: cz }); break;
      case "B": bossSpawns.push({ x: cx, z: cz }); break;
      case "C": setTile(tx, tz, 2); props.push({ kind: "cover", x: cx, z: cz, rot: rng.int(0, 3) * (Math.PI / 2), variant: rng.int(0, 2) }); break;
      case "P": setTile(tx, tz, 2); props.push({ kind: "pillar", x: cx, z: cz, rot: 0, variant: 0 }); break;
      case "R": setTile(tx, tz, 2); props.push({ kind: "rubble", x: cx, z: cz, rot: rng.float() * Math.PI * 2, variant: 0 }); break;
      case "H": setTile(tx, tz, 3); props.push({ kind: "hazard", x: cx, z: cz, rot: 0, variant: 0 }); break;
      case "G": props.push({ kind: "grate", x: cx, z: cz, rot: 0, variant: 0 }); break;
      case "X": setTile(tx, tz, 2); props.push({ kind: "chest", x: cx, z: cz, rot: 0, variant: 0 }); break;
      case "F": setTile(tx, tz, 2); props.push({ kind: "campfire", x: cx, z: cz, rot: 0, variant: 0 }); break;
      case "M": setTile(tx, tz, 2); props.push({ kind: "merchant", x: cx, z: cz, rot: 0, variant: 0 }); break;
      case "K": setTile(tx, tz, 2); props.push({ kind: "skill", x: cx, z: cz, rot: 0, variant: 0 }); break;
      case "D": exit = { x: cx, z: cz }; props.push({ kind: "exit", x: cx, z: cz, rot: 0, variant: 0 }); break;
      default: break;
    }
  }
  // A little decor on free floor tiles near walls.
  if (act) {
    const n = rng.int(2, 4);
    for (let i = 0; i < n; i++) {
      const tx = rng.int(1, tw - 2), tz = rng.int(1, th - 2);
      if (ch(tx, tz) === "." && isWall(ch(tx, tz - 1))) {
        props.push({ kind: "decor", x: tx * TILE + TILE / 2, z: tz * TILE + 0.5, rot: 0, variant: rng.int(0, act.decor.length - 1) });
      }
    }
  }
  return {
    template: templateId, kind, w, h, cells, props, exit, heroSpawns, enemySpawns, bossSpawns,
    cleared: false, startTick: tick, fight: kind === "encounter" || kind === "elite" || kind === "boss", trap,
  };
}

/** Pick a template for a node kind. */
export function templateFor(kind: NodeKind | "tavern", rng: Rng): string {
  const tag = kind === "encounter" ? "combat" : kind;
  const ids = Object.entries(ROOMS.templates).filter(([, t]) => t.tags.includes(tag)).map(([id]) => id);
  if (ids.length === 0) return "hall";
  return rng.pick(ids);
}
