import * as THREE from "three";

export const LIGHT_POOL_SIZE = 8;

export interface LightRequest {
  x: number; y: number; z: number;
  color: THREE.ColorRepresentation;
  intensity: number;
  range: number;
  /** Higher wins when more than 8 lights want a slot. */
  priority: number;
}

/**
 * A fixed pool of 8 PointLights. The count never changes (three.js would recompile every
 * lit shader); each frame the most important requests are assigned to the pool and unused
 * lights are parked at zero intensity.
 */
export class LightPool {
  readonly lights: THREE.PointLight[] = [];
  private requests: LightRequest[] = [];
  used = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 1.5);
      l.castShadow = false;
      this.lights.push(l);
      scene.add(l);
    }
  }

  request(r: LightRequest): void {
    this.requests.push(r);
  }

  /** Assign requests to lights, nearest-to-focus / highest priority first. */
  flush(focusX: number, focusZ: number): void {
    const reqs = this.requests;
    reqs.sort((a, b) => b.priority - a.priority || Math.hypot(a.x - focusX, a.z - focusZ) - Math.hypot(b.x - focusX, b.z - focusZ));
    this.used = Math.min(reqs.length, LIGHT_POOL_SIZE);
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const l = this.lights[i]!;
      const r = reqs[i];
      if (r) {
        l.position.set(r.x, r.y, r.z);
        l.color.set(r.color);
        l.intensity = r.intensity;
        l.distance = r.range;
      } else {
        l.intensity = 0;
      }
    }
    this.requests = [];
  }
}
