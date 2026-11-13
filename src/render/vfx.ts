import * as THREE from "three";
import type { Assets } from "./assets";
import type { LightPool } from "./lights";

const vert = /* glsl */ `
uniform vec2 frameUv; uniform vec2 frameOffset; uniform vec2 size; uniform vec2 pivot;
varying vec2 vUv;
void main() {
  vUv = frameOffset + uv * frameUv;
  // Camera-facing billboard: expand in view space.
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += (position.xy - pivot) * size;
  gl_Position = projectionMatrix * mv;
}
`;
const frag = /* glsl */ `
uniform sampler2D map; uniform float opacity;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.35) discard;
  gl_FragColor = vec4(c.rgb, c.a * opacity);
}
`;

interface Live {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  id: string;
  age: number;
  life: number;
  frames: number;
  fps: number;
  loop: boolean;
  cols: number;
  rows: number;
  follow?: () => THREE.Vector3 | null;
  light?: { color: string; intensity: number; range: number };
  pos: THREE.Vector3;
  vel: THREE.Vector3;
}

/**
 * UV-animated pixel VFX billboards with nearest filtering. Each effect that declares a light
 * borrows a slot from the 8-light pool for its lifetime (fading with it), so a Fireball
 * lights up the walls it passes.
 */
export class VfxSystem {
  private live: Live[] = [];
  private geo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
  constructor(private readonly scene: THREE.Scene, private readonly assets: Assets) {}

  spawn(id: string, pos: THREE.Vector3, opts: { life?: number; follow?: () => THREE.Vector3 | null; vel?: THREE.Vector3; scale?: number; opacity?: number; flip?: boolean; rot?: number } = {}): void {
    const entry = this.assets.vfx.get(id);
    const def = this.assets.vfxDef(id);
    if (!entry || !def) return;
    const s = entry.sheet;
    const rows = Math.ceil(s.frames / s.cols);
    const worldW = (def.size ?? 1) * (opts.scale ?? 1);
    const worldH = worldW * (s.frameH / s.frameW);
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, depthTest: true,
      uniforms: {
        map: { value: entry.tex },
        frameUv: { value: new THREE.Vector2((1 / s.cols) * (opts.flip ? -1 : 1), 1 / rows) },
        frameOffset: { value: new THREE.Vector2() },
        size: { value: new THREE.Vector2(worldW, worldH) },
        pivot: { value: new THREE.Vector2(s.pivot[0] / s.frameW, 1 - s.pivot[1] / s.frameH) },
        opacity: { value: opts.opacity ?? 1 },
      },
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.layers.set(1);
    mesh.frustumCulled = false;
    mesh.position.copy(pos);
    mesh.renderOrder = 10;
    this.scene.add(mesh);
    const life = opts.life ?? (s.loop ? 1.2 : s.frames / s.fps);
    const light = "light" in def && def.light ? { color: def.light, intensity: def.intensity ?? 1, range: def.range ?? 3 } : undefined;
    this.live.push({ mesh, mat, id, age: 0, life, frames: s.frames, fps: s.fps, loop: s.loop, cols: s.cols, rows, follow: opts.follow, light, pos: pos.clone(), vel: opts.vel?.clone() ?? new THREE.Vector3() });
  }

  update(dt: number, lights: LightPool): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const v = this.live[i]!;
      v.age += dt;
      if (v.age >= v.life) {
        this.scene.remove(v.mesh);
        v.mat.dispose();
        this.live.splice(i, 1);
        continue;
      }
      if (v.follow) {
        const p = v.follow();
        if (p) v.pos.copy(p);
      }
      v.pos.addScaledVector(v.vel, dt);
      v.mesh.position.copy(v.pos);
      let f = Math.floor(v.age * v.fps);
      f = v.loop ? f % v.frames : Math.min(f, v.frames - 1);
      const col = f % v.cols, row = Math.floor(f / v.cols);
      const fu = v.mat.uniforms.frameUv!.value as THREE.Vector2;
      (v.mat.uniforms.frameOffset!.value as THREE.Vector2).set(fu.x < 0 ? (col + 1) / v.cols : col / v.cols, 1 - (row + 1) / v.rows);
      if (v.light) {
        const k = v.life - v.age < 0.3 ? (v.life - v.age) / 0.3 : Math.min(1, v.age / 0.08);
        lights.request({ x: v.pos.x, y: v.pos.y + 0.8, z: v.pos.z, color: v.light.color, intensity: v.light.intensity * k, range: v.light.range, priority: 5 });
      }
    }
  }

  get count(): number {
    return this.live.length;
  }

  clear(): void {
    for (const v of this.live) {
      this.scene.remove(v.mesh);
      v.mat.dispose();
    }
    this.live = [];
  }
}
