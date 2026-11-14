import * as THREE from "three";
import type { PlayerShape } from "./palette";

/** Flat ground marker in a player's shape (circle/square/triangle/diamond) — never colour alone. */
export function shapeRing(shape: PlayerShape, color: string, size = 0.62): THREE.Mesh {
  const outer = new THREE.Shape();
  const inner = new THREE.Path();
  const pts = (r: number): [number, number][] => {
    switch (shape) {
      case "square": return [[-r, -r], [r, -r], [r, r], [-r, r]];
      case "triangle": return [0, 1, 2].map((i) => [Math.sin((i / 3) * Math.PI * 2) * r * 1.25, Math.cos((i / 3) * Math.PI * 2) * r * 1.25] as [number, number]);
      case "diamond": return [[0, -r * 1.25], [r, 0], [0, r * 1.25], [-r, 0]];
      default: return Array.from({ length: 20 }, (_, i) => [Math.sin((i / 20) * Math.PI * 2) * r, Math.cos((i / 20) * Math.PI * 2) * r] as [number, number]);
    }
  };
  const o = pts(size), n = pts(size * 0.78);
  outer.moveTo(o[0]![0], o[0]![1]);
  for (const p of o.slice(1)) outer.lineTo(p[0], p[1]);
  outer.closePath();
  inner.moveTo(n[0]![0], n[0]![1]);
  for (const p of [...n.slice(1)]) inner.lineTo(p[0], p[1]);
  inner.closePath();
  outer.holes.push(inner);
  const geo = new THREE.ShapeGeometry(outer);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }));
  m.position.y = 0.03;
  m.renderOrder = 1;
  return m;
}

/** Inverted-hull rim in the player's colour around a (possibly skinned) model. */
export function addRim(root: THREE.Object3D, color: string, width = 0.018): THREE.Object3D[] {
  const added: THREE.Object3D[] = [];
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\ntransformed += normalize(normal) * ${width.toFixed(4)} / 0.7;`);
  };
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.visible && !(m.material as THREE.Material).transparent) meshes.push(m);
  });
  for (const m of meshes) {
    let rim: THREE.Mesh;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = m as THREE.SkinnedMesh;
      const r = new THREE.SkinnedMesh(sm.geometry, mat);
      r.bind(sm.skeleton, sm.bindMatrix);
      rim = r;
    } else {
      rim = new THREE.Mesh(m.geometry, mat);
    }
    rim.frustumCulled = false;
    rim.name = "rim";
    rim.layers.set(2); // colour pass only: no need for rims in the normals/outline pass
    m.parent?.add(rim);
    rim.position.copy(m.position);
    rim.quaternion.copy(m.quaternion);
    rim.scale.copy(m.scale);
    added.push(rim);
  }
  return added;
}
