import * as THREE from "three";
import { toonMaterial } from "./toon";
import { PAL } from "./palette";

/**
 * Procedural kitbashes for things the CC0 packs do not contain (beasts, oozes, the dragon,
 * the DM hand, dice, the candle table). Each returns a group plus an `animate` callback the
 * renderer calls with (time, moving, attacking).
 */
export interface ProcModel {
  root: THREE.Group;
  animate(t: number, speed: number, attack: number): void;
}

const box = (w: number, h: number, d: number, color: string, opts: { transparent?: boolean; opacity?: number; emissive?: string } = {}): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMaterial({ color, ...opts }));
  return m;
};

function quadruped(color: string, size: number, long: boolean): ProcModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const len = long ? 2.2 : 1.2;
  const torso = box(0.5 * size, 0.42 * size, len * size, color);
  torso.position.y = 0.55 * size;
  body.add(torso);
  const head = box(0.42 * size, 0.38 * size, 0.5 * size, color);
  head.position.set(0, 0.72 * size, (len / 2 + 0.2) * size);
  body.add(head);
  const snout = box(0.24 * size, 0.2 * size, 0.3 * size, PAL.night);
  snout.position.set(0, 0.64 * size, (len / 2 + 0.55) * size);
  body.add(snout);
  for (const sx of [-1, 1]) {
    const ear = box(0.08 * size, 0.18 * size, 0.08 * size, color);
    ear.position.set(sx * 0.14 * size, 0.97 * size, (len / 2 + 0.12) * size);
    body.add(ear);
    const eye = box(0.06 * size, 0.06 * size, 0.04 * size, PAL.gold, { emissive: PAL.amber });
    eye.position.set(sx * 0.12 * size, 0.78 * size, (len / 2 + 0.46) * size);
    body.add(eye);
  }
  const tail = box(0.1 * size, 0.1 * size, 0.6 * size, color);
  tail.position.set(0, 0.62 * size, -(len / 2 + 0.25) * size);
  body.add(tail);
  const legs: THREE.Mesh[] = [];
  for (const [lx, lz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const leg = box(0.14 * size, 0.4 * size, 0.14 * size, color);
    leg.geometry.translate(0, -0.2 * size, 0);
    leg.position.set(lx * 0.18 * size, 0.4 * size, lz * (len / 2 - 0.12) * size);
    legs.push(leg);
    body.add(leg);
  }
  return {
    root,
    animate(t, speed, attack) {
      const s = Math.min(1, speed);
      legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 12 + (i % 2 === (i < 2 ? 0 : 1) ? 0 : Math.PI)) * 0.6 * s));
      body.position.y = Math.abs(Math.sin(t * 12)) * 0.05 * s * size;
      head.rotation.x = -attack * 0.5;
      body.rotation.x = -attack * 0.15;
      tail.rotation.y = Math.sin(t * 6) * 0.3;
    },
  };
}

function frog(color: string, size: number): ProcModel {
  const q = quadruped(color, size, false);
  q.root.scale.set(1.3, 0.7, 0.8);
  return q;
}

function spider(color: string, size: number): ProcModel {
  const root = new THREE.Group();
  const body = box(0.7 * size, 0.4 * size, 0.9 * size, color);
  body.position.y = 0.5 * size;
  root.add(body);
  const head = box(0.4 * size, 0.3 * size, 0.35 * size, color);
  head.position.set(0, 0.5 * size, 0.6 * size);
  root.add(head);
  for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) {
    const eye = box(0.06 * size, 0.06 * size, 0.04 * size, PAL.blood, { emissive: PAL.blood });
    eye.position.set(sx * (0.06 + k * 0.08) * size, 0.6 * size, 0.78 * size);
    root.add(eye);
  }
  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.3 * size, 0.55 * size, (0.3 - i * 0.22) * size);
    const leg = box(0.8 * size, 0.07 * size, 0.07 * size, color);
    leg.position.x = sx * 0.4 * size;
    leg.rotation.z = sx * -0.6;
    pivot.add(leg);
    legs.push(pivot);
    root.add(pivot);
  }
  return {
    root,
    animate(t, speed, attack) {
      legs.forEach((l, i) => (l.rotation.y = Math.sin(t * 14 + i * 1.7) * 0.35 * Math.min(1, speed + 0.1)));
      head.rotation.x = -attack * 0.4;
    },
  };
}

function bats(color: string, size: number): ProcModel {
  const root = new THREE.Group();
  const flock: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const b = box(0.16 * size, 0.14 * size, 0.2 * size, color);
    g.add(b);
    const wl = box(0.36 * size, 0.03 * size, 0.18 * size, PAL.dusk);
    wl.geometry.translate(-0.18 * size, 0, 0);
    const wr = wl.clone();
    wr.geometry = wl.geometry.clone().translate(0.36 * size, 0, 0);
    g.add(wl, wr);
    g.userData = { wl, wr, phase: i * 1.1, r: 0.3 + (i % 3) * 0.25 };
    flock.push(g);
    root.add(g);
  }
  return {
    root,
    animate(t) {
      for (const g of flock) {
        const { wl, wr, phase, r } = g.userData as { wl: THREE.Mesh; wr: THREE.Mesh; phase: number; r: number };
        g.position.set(Math.cos(t * 3 + phase) * r * size, (1.2 + Math.sin(t * 5 + phase) * 0.25) * size, Math.sin(t * 3 + phase) * r * size);
        wl.rotation.z = Math.sin(t * 30 + phase) * 0.9;
        wr.rotation.z = -Math.sin(t * 30 + phase) * 0.9;
      }
    },
  };
}

function cube(color: string, size: number): ProcModel {
  const root = new THREE.Group();
  const c = box(size, size, size, color, { transparent: true, opacity: 0.55 });
  c.position.y = size / 2;
  c.renderOrder = 2;
  root.add(c);
  const bone = box(0.15 * size, 0.4 * size, 0.15 * size, PAL.bone);
  bone.position.set(0.1 * size, 0.4 * size, 0);
  bone.rotation.z = 0.6;
  root.add(bone);
  return { root, animate(t) { c.scale.set(1 + Math.sin(t * 3) * 0.04, 1 - Math.sin(t * 3) * 0.04, 1 + Math.sin(t * 3) * 0.04); } };
}

function mimic(color: string, size: number): ProcModel {
  const root = new THREE.Group();
  const base = box(1.1 * size, 0.6 * size, 0.8 * size, color);
  base.position.y = 0.3 * size;
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.6 * size, -0.4 * size);
  const lid = box(1.1 * size, 0.3 * size, 0.8 * size, color);
  lid.position.set(0, 0.15 * size, 0.4 * size);
  lidPivot.add(lid);
  const band = box(1.14 * size, 0.1 * size, 0.84 * size, PAL.gold);
  band.position.y = 0.55 * size;
  root.add(base, lidPivot, band);
  for (let i = 0; i < 6; i++) {
    const tooth = box(0.08 * size, 0.14 * size, 0.06 * size, PAL.bone);
    tooth.position.set((-0.45 + i * 0.18) * size, 0.66 * size, 0.38 * size);
    root.add(tooth);
  }
  const tongue = box(0.2 * size, 0.06 * size, 0.6 * size, PAL.blood);
  tongue.position.set(0, 0.62 * size, 0.6 * size);
  root.add(tongue);
  return { root, animate(t, _s, attack) { lidPivot.rotation.x = -0.25 - attack * 0.9 - Math.abs(Math.sin(t * 4)) * 0.1; tongue.visible = attack > 0.1; } };
}

function wisp(color: string, size: number): ProcModel {
  const root = new THREE.Group();
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35 * size, 0), toonMaterial({ color, emissive: color }));
  orb.position.y = 1.2;
  root.add(orb);
  return { root, animate(t) { orb.position.y = 1.2 + Math.sin(t * 2) * 0.2; orb.rotation.y = t; } };
}

function dragon(color: string, size: number): ProcModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = box(1.1 * size, 0.9 * size, 2.0 * size, color);
  torso.position.y = 1.0 * size;
  body.add(torso);
  const belly = box(0.8 * size, 0.2 * size, 1.6 * size, PAL.moss);
  belly.position.y = 0.6 * size;
  body.add(belly);
  const neck = new THREE.Group();
  neck.position.set(0, 1.3 * size, 0.9 * size);
  body.add(neck);
  const neckMesh = box(0.45 * size, 0.45 * size, 1.0 * size, color);
  neckMesh.position.set(0, 0.25 * size, 0.45 * size);
  neckMesh.rotation.x = -0.5;
  neck.add(neckMesh);
  const head = new THREE.Group();
  head.position.set(0, 0.55 * size, 0.95 * size);
  neck.add(head);
  const skull = box(0.6 * size, 0.45 * size, 0.8 * size, color);
  head.add(skull);
  const jaw = box(0.5 * size, 0.15 * size, 0.7 * size, PAL.night);
  jaw.position.set(0, -0.28 * size, 0.1 * size);
  head.add(jaw);
  for (const sx of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08 * size, 0.6 * size, 4), toonMaterial({ color: PAL.bone }));
    horn.position.set(sx * 0.2 * size, 0.3 * size, -0.35 * size);
    horn.rotation.x = -1.1;
    head.add(horn);
    const eye = box(0.08 * size, 0.06 * size, 0.04 * size, PAL.leaf, { emissive: PAL.leaf });
    eye.position.set(sx * 0.2 * size, 0.08 * size, 0.38 * size);
    head.add(eye);
  }
  const wings: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sx * 0.5 * size, 1.4 * size, 0.2 * size);
    const membrane = box(2.0 * size, 0.06 * size, 1.2 * size, PAL.wine);
    membrane.position.x = sx * 1.0 * size;
    const spar = box(2.1 * size, 0.12 * size, 0.12 * size, color);
    spar.position.set(sx * 1.05 * size, 0.06 * size, 0.55 * size);
    w.add(membrane, spar);
    wings.push(w);
    body.add(w);
  }
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = body;
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.9 * size : 0, i === 0 ? -1.0 * size : -0.55 * size);
    const m = box((0.45 - i * 0.08) * size, (0.4 - i * 0.07) * size, 0.6 * size, color);
    m.position.z = -0.3 * size;
    seg.add(m);
    parent.add(seg);
    tail.push(seg);
    parent = seg;
  }
  const legs: THREE.Mesh[] = [];
  for (const [lx, lz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const leg = box(0.3 * size, 0.7 * size, 0.3 * size, color);
    leg.geometry.translate(0, -0.35 * size, 0);
    leg.position.set(lx * 0.5 * size, 0.75 * size, lz * 0.7 * size);
    legs.push(leg);
    body.add(leg);
  }
  return {
    root,
    animate(t, speed, attack) {
      wings.forEach((w, i) => (w.rotation.z = (i === 0 ? 1 : -1) * (0.25 + Math.sin(t * 3) * 0.35)));
      tail.forEach((s, i) => (s.rotation.y = Math.sin(t * 2 - i * 0.7) * 0.25));
      legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 8 + (i % 2) * Math.PI) * 0.4 * Math.min(1, speed)));
      neck.rotation.x = -attack * 0.4;
      jaw.rotation.x = attack * 0.6;
      body.position.y = Math.sin(t * 1.5) * 0.04 * size;
    },
  };
}

function hand(color: string, size: number): ProcModel {
  const root = new THREE.Group();
  const palm = box(0.9 * size, 0.25 * size, 1.0 * size, color);
  root.add(palm);
  const cuff = box(1.0 * size, 0.35 * size, 0.5 * size, PAL.wine);
  cuff.position.z = -0.75 * size;
  root.add(cuff);
  const fingers: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group();
    f.position.set((-0.33 + i * 0.22) * size, 0, 0.5 * size);
    const seg1 = box(0.17 * size, 0.18 * size, 0.42 * size, color);
    seg1.position.z = 0.21 * size;
    const knuckle = new THREE.Group();
    knuckle.position.z = 0.42 * size;
    const seg2 = box(0.16 * size, 0.16 * size, 0.34 * size, color);
    seg2.position.z = 0.17 * size;
    knuckle.add(seg2);
    f.add(seg1, knuckle);
    f.userData.knuckle = knuckle;
    fingers.push(f);
    root.add(f);
  }
  const thumb = new THREE.Group();
  thumb.position.set(-0.45 * size, 0, 0.0);
  const th = box(0.18 * size, 0.18 * size, 0.5 * size, color);
  th.position.set(-0.1 * size, 0, 0.25 * size);
  th.rotation.y = 0.6;
  thumb.add(th);
  root.add(thumb);
  return {
    root,
    animate(t, _speed, grip) {
      fingers.forEach((f, i) => {
        f.rotation.x = 0.25 + grip * 0.7 + Math.sin(t * 2 + i) * 0.05;
        (f.userData.knuckle as THREE.Group).rotation.x = 0.3 + grip * 0.8;
      });
      thumb.rotation.y = -grip * 0.5;
    },
  };
}

export function proceduralModel(kind: string, color: string, size: number, long = false): ProcModel {
  switch (kind) {
    case "quadruped": return quadruped(color, size, long);
    case "frog": return frog(color, size);
    case "spider": return spider(color, size);
    case "bats": return bats(color, size);
    case "cube": return cube(color, size);
    case "mimic": return mimic(color, size);
    case "wisp": return wisp(color, size);
    case "dragon": return dragon(color, size);
    case "hand": return hand(color, size);
    default: {
      // Fallback "pawn" (also used when a model file is missing).
      const root = new THREE.Group();
      const b = box(0.5 * size, 1.2 * size, 0.4 * size, color);
      b.position.y = 0.6 * size;
      const h = box(0.4 * size, 0.4 * size, 0.4 * size, color);
      h.position.y = 1.45 * size;
      root.add(b, h);
      return { root, animate(t, speed) { root.position.y = Math.abs(Math.sin(t * 10)) * 0.06 * Math.min(1, speed); } };
    }
  }
}

/** A d20 die mesh with a coloured face for player identity. */
export function d20Mesh(color: string, size = 0.35): THREE.Mesh {
  const g = new THREE.IcosahedronGeometry(size, 0);
  return new THREE.Mesh(g, toonMaterial({ color }));
}

export function d6Mesh(color: string, size = 0.28): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(size, size, size), toonMaterial({ color }));
}

/** Wood-grain table texture drawn on a canvas in palette browns. */
export function tableTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = PAL.night;
  g.fillRect(0, 0, 128, 128);
  for (let plank = 0; plank < 4; plank++) {
    const y0 = plank * 32;
    g.fillStyle = plank % 2 ? "#3a2a2e" : "#33262f";
    g.fillRect(0, y0, 128, 31);
    g.fillStyle = PAL.ink;
    g.fillRect(0, y0 + 31, 128, 1);
    for (let k = 0; k < 7; k++) {
      g.fillStyle = k % 2 ? PAL.rust : "#4a2f2c";
      const yy = y0 + 3 + ((k * 13 + plank * 7) % 26);
      g.fillRect((k * 37 + plank * 11) % 128, yy, 22 + ((k * 7) % 15), 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
