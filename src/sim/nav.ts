import type { CellType, RoomState } from "./types";

export const walkable = (c: CellType | undefined): boolean => c === 0 || c === 3;

export function cellAt(room: RoomState, x: number, z: number): CellType {
  const cx = Math.floor(x), cz = Math.floor(z);
  if (cx < 0 || cz < 0 || cx >= room.w || cz >= room.h) return 4;
  return room.cells[cz * room.w + cx]!;
}

export function isBlocked(room: RoomState, x: number, z: number): boolean {
  return !walkable(cellAt(room, x, z));
}

/** Grid line-of-sight (supercover-ish sampling every 0.25 m). */
export function lineOfSight(room: RoomState, ax: number, az: number, bx: number, bz: number): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(d / 0.25);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const c = cellAt(room, ax + (bx - ax) * t, az + (bz - az) * t);
    if (c === 1 || c === 4) return false;
  }
  return true;
}

/** Nearest walkable cell centre to (x, z) (the point itself if it is already walkable). */
export function nearestWalkable(room: RoomState, x: number, z: number): { x: number; z: number } {
  if (!isBlocked(room, x, z)) return { x, z };
  const cx = Math.floor(x), cz = Math.floor(z);
  for (let r = 1; r < Math.max(room.w, room.h); r++) {
    let best: { x: number; z: number } | null = null, bd = Infinity;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= room.w || nz >= room.h || !walkable(room.cells[nz * room.w + nx])) continue;
      const d = (nx + 0.5 - x) ** 2 + (nz + 0.5 - z) ** 2;
      if (d < bd) { bd = d; best = { x: nx + 0.5, z: nz + 0.5 }; }
    }
    if (best) return best;
  }
  return { x, z };
}

/** Can an actor of `radius` walk straight from a to b? Cover blocks movement (unlike sight). */
export function walkLine(room: RoomState, ax: number, az: number, bx: number, bz: number, radius = 0.35): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(d / 0.2);
  const nx = d > 0 ? -(bz - az) / d : 0, nz = d > 0 ? (bx - ax) / d : 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    for (const o of [0, radius, -radius]) if (!walkable(cellAt(room, x + nx * o, z + nz * o))) return false;
  }
  return true;
}

/**
 * A* over the 1 m nav grid with 8-way moves (no corner cutting). Returns cell-centre waypoints
 * from start (exclusive) to goal (inclusive), simplified with line-of-sight string pulling.
 */
export function findPath(room: RoomState, sx: number, sz: number, gx: number, gz: number, maxNodes = 2000): { x: number; z: number }[] {
  const w = room.w, h = room.h;
  const start = Math.floor(sz) * w + Math.floor(sx);
  let goal = Math.floor(gz) * w + Math.floor(gx);
  if (!walkable(room.cells[goal])) {
    // Goal inside cover: pick the nearest walkable neighbour.
    let best = -1, bd = Infinity;
    const gcx = Math.floor(gx), gcz = Math.floor(gz);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const x = gcx + dx, z = gcz + dz;
      if (x < 0 || z < 0 || x >= w || z >= h) continue;
      if (!walkable(room.cells[z * w + x])) continue;
      const dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = z * w + x; }
    }
    if (best < 0) return [];
    goal = best;
  }
  if (start === goal) return [{ x: gx, z: gz }];
  const g = new Float64Array(w * h).fill(Infinity);
  const f = new Float64Array(w * h).fill(Infinity);
  const came = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const open: number[] = [start];
  g[start] = 0;
  const hx = goal % w, hz = Math.floor(goal / w);
  const heur = (i: number): number => {
    const dx = Math.abs((i % w) - hx), dz = Math.abs(Math.floor(i / w) - hz);
    return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
  };
  f[start] = heur(start);
  let expanded = 0;
  while (open.length && expanded < maxNodes) {
    // Binary-heap-free selection is fine for rooms of a few hundred cells; ties break by index for determinism.
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i]!, b = open[bi]!;
      if (f[a]! < f[b]! || (f[a] === f[b] && a < b)) bi = i;
    }
    const cur = open[bi]!;
    open.splice(bi, 1);
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    const cx = cur % w, cz = Math.floor(cur / w);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
      const ni = nz * w + nx;
      if (closed[ni] || !walkable(room.cells[ni])) continue;
      if (dx && dz && (!walkable(room.cells[cz * w + nx]) || !walkable(room.cells[nz * w + cx]))) continue;
      const cost = (dx && dz ? 1.4142 : 1) + (room.cells[ni] === 3 ? 2 : 0);
      const ng = g[cur]! + cost;
      if (ng < g[ni]!) {
        g[ni] = ng;
        f[ni] = ng + heur(ni);
        came[ni] = cur;
        open.push(ni);
      }
    }
  }
  if (came[goal] === -1) return [];
  const cells: number[] = [];
  for (let c = goal; c !== start && c !== -1; c = came[c]!) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => ({ x: (c % w) + 0.5, z: Math.floor(c / w) + 0.5 }));
  // String pulling.
  const out: { x: number; z: number }[] = [];
  let ax = sx, az = sz;
  for (let i = 0; i < pts.length; i++) {
    const next = pts[i + 1];
    if (next && walkLine(room, ax, az, next.x, next.z)) continue;
    out.push(pts[i]!);
    ax = pts[i]!.x;
    az = pts[i]!.z;
  }
  return out;
}
