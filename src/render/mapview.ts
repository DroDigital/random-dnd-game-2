import * as THREE from "three";
import type { Assets } from "./assets";
import { proceduralModel, type ProcModel } from "./procedural";
import { PAL } from "./palette";
import type { ActMap, MapNode, NodeKind } from "../sim/types";
import type { VfxSystem } from "./vfx";

const HEX = 1.15; // scale of the KayKit hexes on the table
const DX = 2 * HEX, DZ = 1.732 * HEX;

const DECOR: Record<NodeKind, string> = {
  start: "building_tavern_blue", encounter: "weaponrack", elite: "building_tower_A_red", skill: "building_well_green",
  merchant: "building_market_blue", campfire: "tent", mystery: "building_destroyed", boss: "building_castle_red",
};
const FILL = ["hex_grass", "hex_grass", "trees_A_medium", "trees_B_medium", "mountain_A", "hills_A_trees", "rock_single_A", "hex_water"];

interface Placement { obj: THREE.Object3D; target: THREE.Vector3; t: number; placed: boolean }

/** The act's hex map on the table, revealed by the DM's hand tile by tile. */
export class MapView {
  readonly group = new THREE.Group();
  private hand: ProcModel;
  private handPos = new THREE.Vector3(0, 6, 0);
  private queue: { node: MapNode | null; pos: THREE.Vector3; key: string }[] = [];
  private placing: Placement | null = null;
  private placed = new Map<string, THREE.Object3D>();
  private highlight: THREE.Mesh;
  private options: THREE.Mesh[] = [];
  private roads = new THREE.Group();
  private act = -1;
  private time = 0;
  center = new THREE.Vector3();

  constructor(private assets: Assets, private vfx: VfxSystem) {
    this.hand = proceduralModel("hand", PAL.ember, 0.9);
    this.hand.root.rotation.x = 0.4;
    this.group.add(this.hand.root, this.roads);
    this.highlight = new THREE.Mesh(new THREE.RingGeometry(0.85 * HEX, 1.0 * HEX, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: PAL.gold, transparent: true, opacity: 0.9, depthWrite: false }));
    this.highlight.rotation.y = Math.PI / 6;
    this.group.add(this.highlight);
  }

  static pos(n: { row: number; col: number }): THREE.Vector3 {
    return new THREE.Vector3(n.col * DX + (n.row % 2) * (DX / 2), 0, -n.row * DZ);
  }

  private tile(name: string): THREE.Object3D {
    const g = new THREE.Group();
    const base = this.assets.prop(name.startsWith("hex_") ? name : "hex_grass");
    base.scale.setScalar(HEX);
    base.position.y = 0.2; // KayKit hexes hang below y=0
    g.add(base);
    if (!name.startsWith("hex_")) {
      const deco = this.assets.prop(name);
      deco.scale.setScalar(HEX * (name.startsWith("building") ? 0.8 : 1));
      deco.position.y = 0.2;
      g.add(deco);
    }
    return g;
  }

  /** Rebuild for a new act; already-revealed nodes appear instantly, new ones get queued for the hand. */
  sync(map: ActMap, actIndex: number, selected: number | null, dt: number): void {
    this.time += dt;
    if (actIndex !== this.act) {
      this.act = actIndex;
      for (const o of this.placed.values()) this.group.remove(o);
      this.placed.clear();
      this.queue = [];
      this.roads.clear();
      const rows = Math.max(...map.nodes.map((n) => n.row));
      this.center.set(2 * DX, 0, -(rows / 2) * DZ);
      // Filler hexes around the nodes make a full board; they are laid first, quickly.
      for (let r = -1; r <= rows + 1; r++) for (let c = -1; c <= 5; c++) {
        if (map.nodes.some((n) => n.row === r && n.col === c)) continue;
        const key = `f${r}:${c}`;
        const h = (r * 7 + c * 13 + actIndex * 5) & 7;
        const o = this.tile(FILL[h]!);
        o.position.copy(MapView.pos({ row: r, col: c }));
        o.position.y = -0.05;
        this.group.add(o);
        this.placed.set(key, o);
      }
    }
    for (const n of map.nodes) {
      const key = `n${n.id}`;
      if (!n.revealed || this.placed.has(key) || this.queue.some((q) => q.key === key)) continue;
      this.queue.push({ node: n, pos: MapView.pos(n), key });
    }
    // Roads between revealed nodes.
    if (this.roads.children.length === 0 || dt === 0 || Math.floor(this.time * 2) % 2 === 0) {
      this.roads.clear();
      for (const n of map.nodes) {
        if (!this.placed.has(`n${n.id}`)) continue;
        for (const nid of n.next) {
          const m = map.nodes.find((x) => x.id === nid)!;
          if (!this.placed.has(`n${m.id}`)) continue;
          const a = MapView.pos(n), b = MapView.pos(m);
          const len = a.distanceTo(b);
          const road = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, len), new THREE.MeshBasicMaterial({ color: n.visited && m.visited ? PAL.amber : PAL.fog }));
          road.position.copy(a).add(b).multiplyScalar(0.5);
          road.position.y = 0.25;
          road.lookAt(b.x, 0.25, b.z);
          this.roads.add(road);
        }
      }
    }
    // The hand lays one tile at a time.
    if (!this.placing && this.queue.length) {
      const q = this.queue.shift()!;
      const obj = this.tile(DECOR[q.node!.kind]);
      obj.position.set(q.pos.x, 3, q.pos.z);
      this.group.add(obj);
      this.placing = { obj, target: q.pos.clone(), t: 0, placed: false };
      this.placed.set(q.key, obj);
    }
    let grip = 0.2;
    if (this.placing) {
      const p = this.placing;
      p.t += dt * (dt === 0 ? 0 : 2.8);
      const tgt = p.target;
      const hp = new THREE.Vector3(tgt.x + 0.2, 1.4 + (1 - Math.min(1, p.t)) * 2, tgt.z + 0.9);
      this.handPos.lerp(hp, Math.min(1, dt * 10));
      p.obj.position.set(tgt.x, Math.max(-0.05, 3 * (1 - p.t)), tgt.z);
      grip = 0.8 - p.t * 0.6;
      if (p.t >= 1 || dt === 0) {
        p.obj.position.copy(tgt).setY(-0.05);
        this.vfx.spawn("dust", new THREE.Vector3(tgt.x, 0.3, tgt.z), { scale: 0.5 });
        this.placing = null;
      }
    } else {
      const rest = this.center.clone().add(new THREE.Vector3(5.5, 3.2, 2.5));
      this.handPos.lerp(rest, Math.min(1, dt * 2));
    }
    this.hand.root.position.copy(this.handPos);
    this.hand.root.position.y += Math.sin(this.time * 1.7) * 0.08;
    this.hand.animate(this.time, 0, grip);
    // Selection highlight + options pulse.
    const cur = map.nodes.find((n) => n.id === map.current);
    for (const o of this.options) this.group.remove(o);
    this.options = [];
    if (cur) {
      for (const nid of cur.next) {
        const m = map.nodes.find((x) => x.id === nid);
        if (!m || !this.placed.has(`n${m.id}`)) continue;
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.75 * HEX, 0.85 * HEX, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: PAL.bone, transparent: true, opacity: 0.4 + 0.3 * Math.sin(this.time * 5), depthWrite: false }));
        ring.rotation.y = Math.PI / 6;
        ring.position.copy(MapView.pos(m)).setY(0.3);
        this.group.add(ring);
        this.options.push(ring);
      }
    }
    const sel = map.nodes.find((n) => n.id === (selected ?? map.current));
    if (sel) this.highlight.position.copy(MapView.pos(sel)).setY(0.32);
    this.highlight.visible = !!sel;
  }

  /** Has the hand finished revealing everything? */
  get busy(): boolean {
    return this.placing !== null || this.queue.length > 0;
  }
}
