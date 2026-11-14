import * as THREE from "three";

let gradient: THREE.DataTexture | null = null;

/** Shared 3-step gradient map for MeshToonMaterial. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([70, 70, 70, 255, 165, 165, 165, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export function toonMaterial(opts: { color?: THREE.ColorRepresentation; map?: THREE.Texture | null; transparent?: boolean; opacity?: number; emissive?: THREE.ColorRepresentation } = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color: opts.color ?? 0xffffff,
    map: opts.map ?? null,
    gradientMap: toonGradient(),
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
  if (opts.emissive !== undefined) m.emissive = new THREE.Color(opts.emissive);
  if (m.map) {
    m.map.magFilter = THREE.NearestFilter;
    m.map.minFilter = THREE.NearestFilter;
    m.map.generateMipmaps = false;
    m.map.colorSpace = THREE.SRGBColorSpace;
  }
  return m;
}

/** Replace every material in a loaded model with a toon equivalent (keeps map/colour/emissive). */
export function toonify(root: THREE.Object3D, cache = new Map<THREE.Material, THREE.Material>()): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const conv = (mat: THREE.Material): THREE.Material => {
      const hit = cache.get(mat);
      if (hit) return hit;
      const src = mat as THREE.MeshStandardMaterial;
      const glow = src.name === "Glow" || (src.emissive && src.emissive.getHex() !== 0 && src.emissiveIntensity > 0);
      const t = toonMaterial({ color: src.color ?? 0xffffff, map: src.map ?? null, transparent: src.transparent, opacity: src.opacity });
      if (glow) {
        t.emissive = src.emissive?.clone() ?? new THREE.Color(0x5fc77a);
        if (src.emissiveMap) t.emissiveMap = src.emissiveMap;
      }
      t.name = src.name;
      cache.set(mat, t);
      return t;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
  });
}
