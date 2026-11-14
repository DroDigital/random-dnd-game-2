import { ACTS } from "../data";
import type { Rng } from "../rules/rng";
import type { ActMap, MapNode, NodeKind } from "./types";

/**
 * A branching map on a hex grid: row 0 is the entrance, the last row is the boss. Each row has
 * 2–3 nodes; edges only join neighbouring columns so paths look like roads across hexes.
 */
export function generateActMap(rng: Rng, act: number): ActMap {
  const def = ACTS.acts[act]!;
  const cols = ACTS.columns;
  const rows = def.rows;
  const nodes: MapNode[] = [];
  let id = 0;
  const byRow: MapNode[][] = [];
  const mid = Math.floor(cols / 2);
  byRow.push([{ id: id++, row: 0, col: mid, kind: "start", next: [], revealed: true, visited: true }]);
  for (let r = 1; r < rows; r++) {
    const count = rows <= 3 ? 2 : rng.int(2, 3);
    const colsPicked = rng.shuffle([...Array(cols).keys()]).slice(0, count).sort((a, b) => a - b);
    byRow.push(colsPicked.map((col) => ({ id: id++, row: r, col, kind: "encounter" as NodeKind, next: [], revealed: false, visited: false })));
  }
  byRow.push([{ id: id++, row: rows, col: mid, kind: "boss", next: [], revealed: false, visited: false }]);
  // Edges: each node links to next-row nodes within one column; guarantee in/out degree >= 1.
  for (let r = 0; r < byRow.length - 1; r++) {
    const cur = byRow[r]!, nxt = byRow[r + 1]!;
    for (const n of cur) {
      const near = nxt.filter((m) => Math.abs(m.col - n.col) <= 1);
      const links = near.length ? near : [nxt.reduce((a, b) => (Math.abs(a.col - n.col) <= Math.abs(b.col - n.col) ? a : b))];
      n.next = links.map((m) => m.id);
      if (r === 0 || byRow[r + 1]!.length === 1) n.next = nxt.map((m) => m.id);
    }
    for (const m of nxt) {
      if (!cur.some((n) => n.next.includes(m.id))) {
        const closest = cur.reduce((a, b) => (Math.abs(a.col - m.col) <= Math.abs(b.col - m.col) ? a : b));
        closest.next.push(m.id);
      }
    }
  }
  // Node kinds.
  const weights = ACTS.nodeWeights as Record<string, number>;
  const kinds = Object.keys(weights) as NodeKind[];
  for (let r = 1; r < byRow.length - 1; r++) {
    for (const n of byRow[r]!) {
      if (r === 1) n.kind = "encounter";
      else n.kind = rng.weighted(kinds, (k) => (r === 2 && k === "merchant" ? 0 : weights[k] ?? 0));
    }
    // The row before the boss always offers a campfire.
    if (r === byRow.length - 2) byRow[r]![rng.int(0, byRow[r]!.length - 1)]!.kind = "campfire";
  }
  for (const row of byRow) nodes.push(...row);
  for (const n of nodes) if (n.row === 1) n.revealed = true;
  return { act, nodes, current: 0 };
}

export function nodeById(map: ActMap, id: number): MapNode {
  const n = map.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
}

/** Reveal the next row after moving (the DM hand lays these tiles one by one). */
export function revealFrom(map: ActMap, id: number): number[] {
  const n = nodeById(map, id);
  const out: number[] = [];
  for (const nid of n.next) {
    const m = nodeById(map, nid);
    if (!m.revealed) {
      m.revealed = true;
      out.push(nid);
    }
  }
  return out;
}
