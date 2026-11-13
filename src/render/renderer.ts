import * as THREE from "three";
import { ACTS, MODELS, type ActDef } from "../data";
import type { Assets, ModelInstance } from "./assets";
import { DioramaCamera, LOW_H } from "./camera";
import { LightPool } from "./lights";
import { PostChain } from "./post";
import { VfxSystem } from "./vfx";
import { toonMaterial } from "./toon";
import { d20Mesh, tableTexture, proceduralModel, type ProcModel } from "./procedural";
import { PAL, PLAYER_IDENTITY } from "./palette";
import { shapeRing, addRim } from "./identity";
import type { AnyActor, Hero, RoomProp, RoomState, SimEvent, SimState } from "../sim/types";

const DUNGEON = MODELS.unitScale.dungeon;

interface ActorVis {
  id: number;
  model: ModelInstance;
  root: THREE.Group;
  ring: THREE.Mesh | null;
  shadow: THREE.Mesh;
  animSeq: number;
  anim: string;
  hitT: number;
  bar: number;
}

interface DropIn {
  obj: THREE.Object3D;
  delay: number;
  t: number;
  y: number;
  dusted: boolean;
}

export interface PrevPose { x: number; z: number; facing: number }

/** Reads sim state and draws the candlelit diorama. Owns the three.js scene; the sim never sees it. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam = new DioramaCamera();
  readonly lights: LightPool;
  readonly post: PostChain;
  readonly vfx: VfxSystem;
  private roomGroup = new THREE.Group();
  private actorsGroup = new THREE.Group();
  private fxGroup = new THREE.Group();
  private actors = new Map<number, ActorVis>();
  private drops: DropIn[] = [];
  private roomKey = "";
  private torches: THREE.Vector3[] = [];
  private candle = new THREE.Vector3(0, 0, 0);
  private dice: THREE.Mesh[] = [];
  private diceSpin: number[] = [0, 0, 0, 0];
  private telegraphMeshes = new Map<number, THREE.Mesh>();
  private zoneMeshes = new Map<number, THREE.Mesh>();
  private projVis = new Map<number, THREE.Object3D>();
  private pickupVis = new Map<number, THREE.Object3D>();
  private weaponVis = new Map<number, ProcModel>();
  private time = 0;
  private shake = 0;
  noShake = false;
  altColors = false;
  roomOrigin = new THREE.Vector3();
  stats = { fps: 0, frameMs: 0, calls: 0, tris: 0 };
  /** Last-sim-step poses for interpolation, captured by the game loop before each step. */
  prev = new Map<number, PrevPose>();

  constructor(readonly canvas: HTMLCanvasElement, readonly assets: Assets, uiCanvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = true;
    this.scene.background = new THREE.Color(PAL.ink);
    this.lights = new LightPool(this.scene);
    this.scene.add(new THREE.HemisphereLight(0x8a80b0, 0x2a2438, 1.4));
    const moon = new THREE.DirectionalLight(0x9aa8dd, 0.9);
    moon.position.set(-10, 20, 6);
    this.scene.add(moon);
    this.post = new PostChain(uiCanvas);
    this.vfx = new VfxSystem(this.scene, assets);
    this.scene.add(this.roomGroup, this.actorsGroup, this.fxGroup);
    this.buildTable();
  }

  private buildTable(): void {
    const tex = tableTexture();
    tex.repeat.set(8, 8);
    const table = new THREE.Mesh(new THREE.BoxGeometry(80, 1, 80), toonMaterial({ map: tex, color: 0xffffff }));
    table.position.y = -0.55;
    this.scene.add(table);
    // A candle and the dice live on the table, near the board.
    const candle = this.assets.prop("candle_lit");
    candle.scale.setScalar(1.2);
    this.candleObj = candle;
    this.scene.add(candle);
    for (let i = 0; i < 4; i++) {
      const d = d20Mesh(PLAYER_IDENTITY[i]!.color, 0.32);
      this.dice.push(d);
      this.scene.add(d);
    }
  }
  private candleObj: THREE.Object3D | null = null;

  /** Room geometry with a drop-in animation for each tile. Rebuilt when the room changes. */
  setRoom(room: RoomState | null, actIndex: number, key: string): void {
    if (key === this.roomKey) return;
    this.roomKey = key;
    this.roomGroup.clear();
    this.drops = [];
    this.torches = [];
    this.clearActors();
    if (!room) return;
    const act: ActDef = ACTS.acts[actIndex] ?? ACTS.acts[0]!;
    this.roomOrigin.set(0, 0, 0);
    const place = (name: string, p: RoomProp, scale = DUNGEON, yOff = 0): THREE.Object3D => {
      const o = this.assets.prop(name);
      o.scale.setScalar(scale);
      o.position.set(p.x, yOff, p.z);
      o.rotation.y = p.rot;
      this.roomGroup.add(o);
      const order = (p.x + p.z) * 0.035;
      this.drops.push({ obj: o, delay: order, t: 0, y: yOff, dusted: false });
      o.position.y = yOff + 6;
      return o;
    };
    for (const p of room.props) {
      switch (p.kind) {
        case "floor": place(p.variant ? act.floorAlt : act.floor, p); break;
        case "wall": {
          // Walls near the camera are low so the diorama stays readable.
          const o = place(act.wall, p);
          if (p.variant) o.scale.y = DUNGEON * 0.28;
          break;
        }
        case "torch": {
          const o = place("torch_mounted", p, DUNGEON * 1.4, 1.0);
          o.rotation.y = p.rot + Math.PI;
          this.torches.push(new THREE.Vector3(p.x - Math.sin(p.rot) * 0.3, 1.5, p.z - Math.cos(p.rot) * 0.3));
          break;
        }
        case "cover": place(act.cover[p.variant % act.cover.length]!, p, act.setting === "wild" ? 1.3 : DUNGEON * 1.25); break;
        case "pillar": place(act.setting === "vault" ? "pillar_decorated" : "pillar", p); break;
        case "rubble": place("rubble_large", p, DUNGEON * 0.45); break;
        case "hazard": place(act.hazard, p); break;
        case "grate": place("floor_tile_big_grate", p, DUNGEON, 0.01); break;
        case "chest": place("chest_gold", p); break;
        case "exit": {
          place(act.floor, p);
          const st = place("stairs", { ...p, z: p.z - 0.9 }, DUNGEON * 0.38);
          st.rotation.y = Math.PI;
          this.torches.push(new THREE.Vector3(p.x, 1.2, p.z - 0.5));
          break;
        }
        case "campfire": {
          place("trunk_large_A", p, DUNGEON * 0.6);
          this.torches.push(new THREE.Vector3(p.x, 0.6, p.z));
          this.vfx.spawn("campfire", new THREE.Vector3(p.x, 0.1, p.z), { life: 99999 });
          break;
        }
        case "merchant": place("table_medium", p); place("bottle_A_green", { ...p, z: p.z - 0.2 }, DUNGEON, 1.0); break;
        case "skill": place("shelf_small_candles", p); break;
        case "decor": place(act.decor[p.variant % act.decor.length]!, p); break;
      }
    }
    // Candle and dice sit on the table just outside the room's near corner.
    this.candle.set(room.w + 1.6, 0, room.h + 0.5);
    this.candleObj?.position.copy(this.candle);
    this.dice.forEach((d, i) => d.position.set(room.w + 0.5 + (i % 2) * 0.9, 0.3, room.h - 1.8 + Math.floor(i / 2) * 0.9));
  }

  /** Finish every pending drop-in immediately (screenshots, tests). */
  settleRoom(): void {
    for (const d of this.drops) {
      d.t = 1;
      d.dusted = true;
      d.obj.position.y = d.y;
    }
  }

  private clearActors(): void {
    for (const v of this.actors.values()) this.actorsGroup.remove(v.root);
    this.actors.clear();
    for (const m of [...this.telegraphMeshes.values(), ...this.zoneMeshes.values(), ...this.projVis.values(), ...this.pickupVis.values()]) this.fxGroup.remove(m);
    this.telegraphMeshes.clear();
    this.zoneMeshes.clear();
    this.projVis.clear();
    this.pickupVis.clear();
    this.weaponVis.clear();
    this.vfx.clear();
  }

  private makeActor(a: AnyActor): ActorVis {
    const root = new THREE.Group();
    let model: ModelInstance;
    if (a.kind === "summon") {
      const p = proceduralModel("wisp", PAL.gold, 0.6);
      this.weaponVis.set(a.id, p);
      model = { id: "spiritual_weapon", root: p.root, height: 1, play() {}, update(_d, t) { p.animate(t, 0, 0); }, setTint() {} };
      p.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial; m.transparent = true; m.opacity = 0.6; o.layers.set(1); } });
    } else {
      model = this.assets.model(a.model);
    }
    root.add(model.root);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(a.radius * 1.1, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0.45, depthWrite: false }));
    shadow.position.y = 0.025;
    root.add(shadow);
    let ring: THREE.Mesh | null = null;
    if (a.kind === "hero") {
      const id = PLAYER_IDENTITY[(a as Hero).slot % 4]!;
      const color = this.altColors ? id.alt : id.color;
      ring = shapeRing(id.shape, color, 0.6);
      root.add(ring);
      addRim(model.root, color);
    }
    this.actorsGroup.add(root);
    return { id: a.id, model, root, ring, shadow, animSeq: -1, anim: "", hitT: 0, bar: 1 };
  }

  /** Apply sim events that need visuals (VFX, shakes, dice). */
  onEvents(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.t) {
        case "vfx": {
          const follow = e.follow;
          this.vfx.spawn(e.id, new THREE.Vector3(e.x, e.y ?? 0.2, e.z), {
            follow: follow ? () => {
              const v = this.actors.get(follow);
              return v ? new THREE.Vector3(v.root.position.x, e.y ?? 0.2, v.root.position.z) : null;
            } : undefined,
            life: e.life, scale: e.scale, opacity: e.ally ? 0.6 : 1, flip: e.dirX !== undefined && e.dirX < 0,
          });
          break;
        }
        case "shake": this.shake = Math.max(this.shake, e.amount); break;
        case "damage": {
          const v = this.actors.get(e.id);
          if (v) v.hitT = 0.12;
          break;
        }
        case "roll": if (e.slot >= 0 && e.slot < 4) this.diceSpin[e.slot] = 0.6; break;
      }
    }
  }

  /** Sync visuals to the sim, interpolating between the previous and current tick by `alpha`. */
  sync(s: SimState, alpha: number, dt: number): void {
    this.time += dt;
    const room = s.room;
    this.setRoom(room, s.run.act, room ? `${s.run.act}:${s.run.map.current}:${room.template}:${room.startTick}` : "none");
    if (!room) return;
    const seen = new Set<number>();
    const all: AnyActor[] = [...s.heroes, ...s.enemies, ...s.summons];
    for (const a of all) {
      seen.add(a.id);
      let v = this.actors.get(a.id);
      if (!v) {
        v = this.makeActor(a);
        this.actors.set(a.id, v);
      }
      const p = this.prev.get(a.id);
      const x = p ? p.x + (a.x - p.x) * alpha : a.x;
      const z = p ? p.z + (a.z - p.z) * alpha : a.z;
      let f = a.facing;
      if (p) {
        let df = a.facing - p.facing;
        while (df > Math.PI) df -= Math.PI * 2;
        while (df < -Math.PI) df += Math.PI * 2;
        f = p.facing + df * alpha;
      }
      const hover = a.tags.includes("hover") ? 0.35 + Math.sin(this.time * 3 + a.id) * 0.1 : 0;
      v.root.position.set(x, hover, z);
      v.model.root.rotation.y = f;
      if (v.ring) v.ring.rotation.y = this.time * 0.6;
      // Animations.
      const wantAnim = a.anim;
      if (a.animSeq !== v.animSeq || wantAnim !== v.anim) {
        const once = !["idle", "run", "walk", "downed", "sit", "dead"].includes(wantAnim);
        v.model.play(wantAnim, { once, restart: a.animSeq !== v.animSeq });
        v.animSeq = a.animSeq;
        v.anim = wantAnim;
      }
      const speed = Math.hypot(a.vx, a.vz);
      const attack = a.state === "windup" ? Math.min(1, a.stateT / 8) : 0;
      v.model.update(dt * (s.hitstop > 0 ? 0 : 1), this.time, speed, attack);
      // Hit flash.
      if (v.hitT > 0) {
        v.hitT -= dt;
        v.model.setTint(new THREE.Color(PAL.bone), 0.8);
        if (v.hitT <= 0) v.model.setTint(null, 0);
      }
      v.shadow.visible = a.state !== "dead";
      if (v.ring) v.ring.visible = !(a as Hero).fallen;
      const ghost = a.kind === "hero" && (a as Hero).buffs.hidden;
      v.model.root.visible = !ghost || Math.floor(this.time * 8) % 2 === 0;
    }
    for (const [id, v] of this.actors) {
      if (!seen.has(id)) {
        this.actorsGroup.remove(v.root);
        this.actors.delete(id);
      }
    }
    this.syncTelegraphs(s);
    this.syncZones(s);
    this.syncProjectiles(s, alpha);
    this.syncPickups(s);
  }

  private syncTelegraphs(s: SimState): void {
    const live = new Set<number>();
    for (const e of s.enemies) {
      const t = e.telegraph;
      if (!t || t.cancelled) continue;
      live.add(e.id);
      let m = this.telegraphMeshes.get(e.id);
      if (!m) {
        let geo: THREE.BufferGeometry;
        if (t.shape === "circle") geo = new THREE.RingGeometry(Math.max(0.1, t.radius - 0.12), t.radius, 32);
        else if (t.shape === "line") geo = new THREE.PlaneGeometry(t.width, t.length).translate(0, t.length / 2, 0);
        else geo = new THREE.RingGeometry(0.0, 0.5, 3, 1, -Math.PI / 6, Math.PI / 3).translate(0, 0.9, 0);
        geo.rotateX(-Math.PI / 2);
        m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: PAL.blood, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
        m.renderOrder = 2;
        this.fxGroup.add(m);
        this.telegraphMeshes.set(e.id, m);
      }
      const k = Math.min(1, (s.tick - t.start) / Math.max(1, t.end - t.start));
      (m.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.5 * k;
      (m.material as THREE.MeshBasicMaterial).color.set(k > 0.75 ? PAL.gold : PAL.blood);
      if (t.shape === "circle") m.position.set(t.x, 0.05, t.z);
      else m.position.set(e.x, 0.05, e.z);
      m.rotation.y = Math.atan2(t.dirX, t.dirZ);
      m.scale.setScalar(t.shape === "melee" ? 1 + k * 0.5 : 1);
    }
    for (const [id, m] of this.telegraphMeshes) if (!live.has(id)) { this.fxGroup.remove(m); this.telegraphMeshes.delete(id); }
  }

  private syncZones(s: SimState): void {
    const live = new Set<number>();
    const colors: Record<string, string> = { grease: PAL.dusk, fire: PAL.ember, poison: PAL.moss, acid: PAL.leaf, darkness: PAL.ink, entangle: PAL.moss, spikes: PAL.mist };
    for (const z of s.zones) {
      live.add(z.id);
      let m = this.zoneMeshes.get(z.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.CircleGeometry(z.r, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: colors[z.kind] ?? PAL.mist, transparent: true, opacity: 0.55, depthWrite: false }));
        m.renderOrder = 1;
        this.fxGroup.add(m);
        this.zoneMeshes.set(z.id, m);
      }
      m.position.set(z.x, 0.04, z.z);
      (m.material as THREE.MeshBasicMaterial).color.set(colors[z.kind] ?? PAL.mist);
      if (z.kind === "fire") {
        this.lights.request({ x: z.x, y: 0.8, z: z.z, color: PAL.ember, intensity: 18 + Math.sin(this.time * 17 + z.id) * 4, range: z.r * 3, priority: 4 });
        if (Math.floor(this.time * 6 + z.id) % 4 === 0 && Math.random() < 0.15) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * z.r;
          this.vfx.spawn("burning", new THREE.Vector3(z.x + Math.sin(a) * r, 0.1, z.z + Math.cos(a) * r), { life: 0.6, scale: 0.8 });
        }
      }
    }
    for (const [id, m] of this.zoneMeshes) if (!live.has(id)) { this.fxGroup.remove(m); this.zoneMeshes.delete(id); }
  }

  private syncProjectiles(s: SimState, alpha: number): void {
    const live = new Set<number>();
    for (const p of s.projectiles) {
      live.add(p.id);
      let o = this.projVis.get(p.id);
      if (!o) {
        o = new THREE.Object3D();
        this.fxGroup.add(o);
        this.projVis.set(p.id, o);
        const id = p.id;
        // Point the sprite along the projectile's screen-space direction.
        const a = this.cam.project(new THREE.Vector3(p.x, 1, p.z)), b = this.cam.project(new THREE.Vector3(p.x + p.vx, 1, p.z + p.vz));
        const rot = Math.atan2(-(b.y - a.y), b.x - a.x);
        this.vfx.spawn(p.vfx, new THREE.Vector3(p.x, 1, p.z), { tag: `p${id}`, rot, life: 30, follow: () => { const ob = this.projVis.get(id); return ob ? ob.position.clone() : null; }, opacity: p.team === "party" ? 0.85 : 1, scale: p.kind === "fireball" ? 2 : 1 });
      }
      const pp = this.prev.get(p.id);
      o.position.set(pp ? pp.x + (p.x - pp.x) * alpha : p.x, 1, pp ? pp.z + (p.z - pp.z) * alpha : p.z);
    }
    for (const [id, o] of this.projVis) if (!live.has(id)) {
      this.fxGroup.remove(o);
      this.projVis.delete(id);
      this.vfx.kill(`p${id}`);
    }
  }

  private syncPickups(s: SimState): void {
    const live = new Set<number>();
    for (const p of s.pickups) {
      live.add(p.id);
      let o = this.pickupVis.get(p.id);
      if (!o) {
        o = new THREE.Mesh(p.kind === "gold" ? new THREE.CylinderGeometry(0.18, 0.18, 0.06, 8) : new THREE.OctahedronGeometry(0.18), toonMaterial({ color: p.kind === "gold" ? PAL.gold : PAL.blood, emissive: p.kind === "gold" ? PAL.amber : PAL.wine }));
        this.fxGroup.add(o);
        this.pickupVis.set(p.id, o);
      }
      o.position.set(p.x, 0.35 + Math.sin(this.time * 4 + p.id) * 0.08, p.z);
      o.rotation.y = this.time * 3;
    }
    for (const [id, o] of this.pickupVis) if (!live.has(id)) { this.fxGroup.remove(o); this.pickupVis.delete(id); }
  }

  /** Frame the party: centroid of standing heroes, zoom out to fit up to the cap. */
  frame(s: SimState, padding: number, minH: number, maxH: number, dt: number): void {
    const room = s.room;
    if (!room) return;
    const hs = s.heroes.filter((h) => !h.fallen);
    const pts = hs.length ? hs.map((h) => this.actors.get(h.id)?.root.position ?? new THREE.Vector3(h.x, 0, h.z)) : [new THREE.Vector3(room.w / 2, 0, room.h / 2)];
    let minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity;
    for (const p of pts) {
      const r = p.dot(this.cam.right), u = p.dot(this.cam.up);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r); minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    }
    const c = new THREE.Vector3();
    for (const p of pts) c.add(p);
    c.divideScalar(pts.length);
    // Lean toward the room centre so small parties still see the room.
    c.lerp(new THREE.Vector3(room.w / 2, 0, room.h / 2), 0.3);
    const needH = Math.max((maxU - minU) + padding * 2, ((maxR - minR) + padding * 2) * (LOW_H / 480));
    const targetH = Math.min(maxH, Math.max(minH, needH));
    const k = 1 - Math.exp(-dt * 4);
    this.cam.focus.lerp(c, k);
    this.cam.height += (targetH - this.cam.height) * k;
  }

  /** Render one frame through the post chain. */
  render(outW: number, outH: number, dt: number, uiDirty: boolean): void {
    const t0 = performance.now();
    // Drop-in room tiles with dust.
    for (const d of this.drops) {
      if (d.t >= 1) continue;
      d.delay -= dt;
      if (d.delay > 0) continue;
      d.t = Math.min(1, d.t + dt * 2.6);
      const e = d.t * d.t;
      d.obj.position.y = d.y + (1 - e) * 6;
      if (d.t >= 1 && !d.dusted) {
        d.dusted = true;
        if (Math.random() < 0.25) this.vfx.spawn("dust", new THREE.Vector3(d.obj.position.x, 0.1, d.obj.position.z), { scale: 0.6, opacity: 0.8 });
      }
    }
    // Lights: candle, torches, then VFX borrow the rest.
    const flick = (k: number): number => 1 + Math.sin(this.time * 11 + k) * 0.08 + Math.sin(this.time * 23 + k * 3) * 0.05;
    this.lights.request({ x: this.candle.x, y: 1.6, z: this.candle.z, color: PAL.amber, intensity: 45 * flick(0), range: 24, priority: 10 });
    this.torches.forEach((t, i) => this.lights.request({ x: t.x, y: t.y, z: t.z, color: PAL.amber, intensity: 22 * flick(i + 1), range: 10, priority: 6 }));
    this.vfx.update(dt, this.lights);
    this.lights.flush(this.cam.focus.x, this.cam.focus.z);
    // Dice tumble on rolls.
    this.dice.forEach((d, i) => {
      if (this.diceSpin[i]! > 0) {
        this.diceSpin[i]! -= dt;
        d.rotation.x += dt * 18;
        d.rotation.z += dt * 13;
        d.position.y = 0.3 + Math.sin(Math.max(0, this.diceSpin[i]!) * 5) * 0.5;
      } else d.position.y = 0.3;
    });
    // Shake (in texels).
    if (this.shake > 0 && !this.noShake) {
      this.cam.shake.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake = Math.max(0, this.shake - dt * 20);
    } else this.cam.shake.set(0, 0);
    this.cam.update();
    this.post.tiltFocusY = 0.5;
    if (this.renderer.domElement.width !== outW || this.renderer.domElement.height !== outH) this.renderer.setSize(outW, outH, false);
    this.post.render(this.renderer, this.scene, this.cam.camera, this.cam.remainder, outW, outH, uiDirty);
    const info = this.renderer.info;
    this.stats.calls = info.render.calls;
    this.stats.tris = info.render.triangles;
    this.stats.frameMs = performance.now() - t0;
  }

  /** World position → UI canvas pixel (480x270). */
  toScreen(x: number, y: number, z: number): THREE.Vector2 {
    return this.cam.project(new THREE.Vector3(x, y, z));
  }

  actorScreen(id: number, y = 2.2): THREE.Vector2 | null {
    const v = this.actors.get(id);
    if (!v) return null;
    return this.cam.project(new THREE.Vector3(v.root.position.x, y, v.root.position.z));
  }

  get lightsUsed(): number {
    return this.lights.used;
  }
}
