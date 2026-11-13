import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import modelsData from "../data/models.json";
import vfxData from "../data/vfx.json";
import { toonify, toonMaterial } from "./toon";
import { proceduralModel, type ProcModel } from "./procedural";

type ModelDef = { base?: string; texture?: string; scale?: number; hide?: string[]; attach?: Record<string, string>; ghost?: boolean; procedural?: string; color?: string; size?: number; long?: boolean };
const MODELS = modelsData.models as Record<string, ModelDef>;
const ANIMS = modelsData.anims as Record<string, string[]>;
const CHAR_SCALE = modelsData.unitScale.characters;

export interface VfxSheet { file: string; w: number; h: number; frameW: number; frameH: number; frames: number; fps: number; loop: boolean; pivot: [number, number]; cols: number }

/** A placed, animatable model instance. */
export interface ModelInstance {
  id: string;
  root: THREE.Object3D;
  /** Plays a logical animation (see models.json "anims"). */
  play(anim: string, opts?: { once?: boolean; speed?: number; restart?: boolean }): void;
  update(dt: number, t: number, speed: number, attack: number): void;
  setTint(color: THREE.Color | null, amount: number): void;
  height: number;
}

const BASE = "./assets/";

export class Assets {
  private gltfs = new Map<string, GLTF>();
  private textures = new Map<string, THREE.Texture>();
  private props = new Map<string, THREE.Object3D>();
  readonly vfx = new Map<string, { sheet: VfxSheet; tex: THREE.Texture }>();
  private loader = new GLTFLoader();
  private texLoader = new THREE.TextureLoader();
  private matCache = new Map<THREE.Material, THREE.Material>();
  available = false;
  missing: string[] = [];

  async loadAll(onProgress?: (p: number) => void): Promise<void> {
    let manifestOk: boolean;
    try {
      const r = await fetch(`${BASE}manifest.json`);
      manifestOk = r.ok;
    } catch {
      manifestOk = false;
    }
    this.available = manifestOk;
    const jobs: (() => Promise<void>)[] = [];
    if (manifestOk) {
      for (const [name, rel] of Object.entries(modelsData.bases)) jobs.push(() => this.loadGltf(name, `models/${name}.glb`).catch(() => this.miss(rel)));
      for (const name of Object.keys(modelsData.weapons)) jobs.push(() => this.loadGltf(name, `models/${name}.glb`).catch(() => this.miss(name)));
      for (const name of modelsData.dungeonProps) jobs.push(() => this.loadProp(name, `props/${name}.glb`).catch(() => this.miss(name)));
      for (const rel of modelsData.hexTiles) {
        const id = rel.split("/").pop()!;
        jobs.push(() => this.loadProp(id, `hex/${id}.glb`).catch(() => this.miss(id)));
      }
      for (const name of Object.keys(modelsData.recolors)) jobs.push(() => this.loadTexture(name).catch(() => this.miss(name)));
      jobs.push(() => this.loadVfx().catch(() => this.miss("vfx")));
    }
    let done = 0;
    const total = jobs.length || 1;
    // Small concurrency so the loading bar moves and we don't spike memory.
    const queue = [...jobs];
    const worker = async (): Promise<void> => {
      for (let j = queue.shift(); j; j = queue.shift()) {
        await j();
        onProgress?.(++done / total);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    onProgress?.(1);
  }

  private miss(what: string): void {
    this.missing.push(what);
  }

  private async loadGltf(name: string, file: string): Promise<void> {
    const g = await this.loader.loadAsync(BASE + file);
    toonify(g.scene, this.matCache);
    this.gltfs.set(name, g);
  }

  private async loadProp(name: string, file: string): Promise<void> {
    const g = await this.loader.loadAsync(BASE + file);
    toonify(g.scene, this.matCache);
    this.props.set(name, g.scene);
  }

  private async loadTexture(name: string): Promise<void> {
    const t = await this.texLoader.loadAsync(`${BASE}textures/${name}.png`);
    t.flipY = false; // glTF convention
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(name, t);
  }

  private async loadVfx(): Promise<void> {
    const r = await fetch(`${BASE}vfx/index.json`);
    const index = (await r.json()) as Record<string, VfxSheet>;
    await Promise.all(Object.entries(index).map(async ([id, sheet]) => {
      const tex = await this.texLoader.loadAsync(BASE + sheet.file);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.vfx.set(id, { sheet, tex });
    }));
  }

  /** A static prop clone (dungeon pieces, hex tiles). Falls back to a grey box. */
  prop(name: string): THREE.Object3D {
    const p = this.props.get(name);
    if (p) return p.clone(true);
    const m = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), toonMaterial({ color: 0x463c5e }));
    m.position.y = -0.1;
    const g = new THREE.Group();
    g.add(m);
    return g;
  }

  hasProp(name: string): boolean {
    return this.props.has(name);
  }

  vfxDef(id: string): (typeof vfxData)[keyof typeof vfxData] | undefined {
    return (vfxData as Record<string, (typeof vfxData)[keyof typeof vfxData]>)[id];
  }

  /** Instantiate a character/enemy model by game id (see models.json). */
  model(id: string): ModelInstance {
    const def = MODELS[id];
    const gltf = def?.base ? this.gltfs.get(def.base) : undefined;
    if (!def || def.procedural || !gltf) return this.proc(id, def);
    const root = cloneSkinned(gltf.scene);
    const scale = CHAR_SCALE * (def.scale ?? 1);
    root.scale.setScalar(scale);
    const hide = new Set(def.hide ?? []);
    const tex = def.texture ? this.textures.get(def.texture) : undefined;
    const tintables: THREE.MeshToonMaterial[] = [];
    root.traverse((o) => {
      if (hide.has(o.name)) o.visible = false;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.frustumCulled = false;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const cloned = mats.map((m) => {
          const c = (m as THREE.MeshToonMaterial).clone();
          if (tex && c.map) c.map = tex;
          if (def.ghost) {
            c.transparent = true;
            c.opacity = 0.7;
          }
          tintables.push(c);
          return c;
        });
        mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
        if (def.ghost) mesh.layers.set(1);
      }
    });
    for (const [bone, weapon] of Object.entries(def.attach ?? {})) {
      const w = this.gltfs.get(weapon);
      const slot = root.getObjectByName(bone);
      if (w && slot) slot.add(w.scene.clone(true));
    }
    const mixer = new THREE.AnimationMixer(root);
    const clips = new Map(gltf.animations.map((a) => [a.name, a]));
    let current: THREE.AnimationAction | null = null;
    let currentName = "";
    const resolve = (logical: string): THREE.AnimationClip | undefined => {
      for (const n of ANIMS[logical] ?? [logical]) {
        const c = clips.get(n);
        if (c) return c;
      }
      return clips.get("Idle");
    };
    const inst: ModelInstance = {
      id,
      root,
      height: 1.8 * (def.scale ?? 1),
      play(anim, opts = {}) {
        if (anim === currentName && !opts.restart) {
          if (current && opts.speed) current.timeScale = opts.speed;
          return;
        }
        const clip = resolve(anim);
        if (!clip) return;
        const next = mixer.clipAction(clip);
        next.reset();
        next.timeScale = opts.speed ?? 1;
        next.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        next.clampWhenFinished = !!opts.once;
        next.play();
        if (current && current !== next) current.crossFadeTo(next, 0.12, false);
        current = next;
        currentName = anim;
      },
      update(dt) {
        mixer.update(dt);
      },
      setTint(color, amount) {
        for (const m of tintables) {
          if (!color) m.emissive.setRGB(0, 0, 0);
          else m.emissive.copy(color).multiplyScalar(amount);
        }
      },
    };
    inst.play("idle");
    return inst;
  }

  private proc(id: string, def: ModelDef | undefined): ModelInstance {
    if (def?.base && !def.procedural) this.miss(`model:${id}`);
    const p: ProcModel = proceduralModel(def?.procedural ?? "pawn", def?.color ?? "#6b6185", def?.size ?? 1, def?.long ?? false);
    const mats: THREE.MeshToonMaterial[] = [];
    p.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
      if (m && "emissive" in m) mats.push(m);
    });
    const base = mats.map((m) => m.emissive.clone());
    return {
      id,
      root: p.root,
      height: 1.4 * (def?.size ?? 1),
      play() { /* procedural models animate from state */ },
      update(_dt, t, speed, attack) { p.animate(t, speed, attack); },
      setTint(color, amount) {
        mats.forEach((m, i) => (color ? m.emissive.copy(color).multiplyScalar(amount) : m.emissive.copy(base[i]!)));
      },
    };
  }
}
