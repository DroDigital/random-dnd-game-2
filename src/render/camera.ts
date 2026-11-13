import * as THREE from "three";

export const LOW_W = 480;
export const LOW_H = 270;
/** One texel of margin on each side so the sub-texel shift never exposes an edge. */
export const MARGIN = 1;
export const RT_W = LOW_W + MARGIN * 2;
export const RT_H = LOW_H + MARGIN * 2;

const PITCH = THREE.MathUtils.degToRad(35);
const YAW = THREE.MathUtils.degToRad(45);
const DIST = 60;

/**
 * Orthographic diorama camera (35° pitch, 45° yaw) snapped to the low-res texel grid.
 * The camera only ever moves in whole texels; the remainder is handed to the upscale pass
 * as a sub-texel offset so scrolling is smooth without shimmering.
 */
export class DioramaCamera {
  readonly camera: THREE.OrthographicCamera;
  /** World-space focus (what the camera looks at). */
  readonly focus = new THREE.Vector3();
  /** Frustum height in world units (zoom). */
  height = 14;
  /** Sub-texel remainder in texels, x right / y up, in [-0.5, 0.5]. */
  readonly remainder = new THREE.Vector2();
  readonly forward: THREE.Vector3;
  readonly right: THREE.Vector3;
  readonly up: THREE.Vector3;
  shake = new THREE.Vector2();

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    // Direction from target to camera.
    const back = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH));
    this.forward = back.clone().negate();
    this.right = new THREE.Vector3().crossVectors(this.forward, new THREE.Vector3(0, 1, 0)).normalize();
    this.up = new THREE.Vector3().crossVectors(this.right, this.forward).normalize();
    this.camera.up.copy(this.up);
    this.camera.position.copy(back.multiplyScalar(DIST));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }

  get texel(): number {
    return this.height / LOW_H;
  }

  update(): void {
    const t = this.texel;
    const halfH = (this.height / 2) * (RT_H / LOW_H);
    const halfW = halfH * (RT_W / RT_H);
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
    const f = this.focus.clone();
    f.addScaledVector(this.right, this.shake.x * t).addScaledVector(this.up, this.shake.y * t);
    // Coordinates of the focus in the camera plane, snapped to whole texels.
    const pr = f.dot(this.right) / t;
    const pu = f.dot(this.up) / t;
    const pf = f.dot(this.forward);
    const sr = Math.round(pr), su = Math.round(pu);
    this.remainder.set(pr - sr, pu - su);
    const snapped = new THREE.Vector3()
      .addScaledVector(this.right, sr * t)
      .addScaledVector(this.up, su * t)
      .addScaledVector(this.forward, pf);
    this.camera.position.copy(snapped).addScaledVector(this.forward, -DIST);
    this.camera.updateMatrixWorld();
  }

  /** World point → low-res pixel coords (0..480, 0..270, y down). */
  project(p: THREE.Vector3, out = new THREE.Vector2()): THREE.Vector2 {
    const v = p.clone().project(this.camera);
    out.set(((v.x + 1) / 2) * RT_W - MARGIN - this.remainder.x, ((1 - v.y) / 2) * RT_H - MARGIN + this.remainder.y);
    return out;
  }

  /** How much world (in the ground plane) the view covers, for framing. */
  groundHalfExtents(): { w: number; h: number } {
    const h = this.height / 2 / Math.sin(PITCH);
    return { w: (this.height * (LOW_W / LOW_H)) / 2, h };
  }
}
