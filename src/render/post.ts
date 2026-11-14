import * as THREE from "three";
import { LOW_H, LOW_W, MARGIN, RT_H, RT_W } from "./camera";
import { PALETTE_HEX, hexToRgb01 } from "./palette";

export interface PostToggles {
  outline: boolean;
  tiltShift: boolean;
  ui: boolean;
  quantize: boolean;
  dither: boolean;
}

const fsVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const outlineFrag = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tNormal;
uniform vec2 texel; uniform float near; uniform float far; uniform float enabled; uniform vec3 ink;
varying vec2 vUv;
float lin(float d) { return d * (far - near) + near; } // orthographic depth is already linear
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main() {
  // The scene target holds linear light; everything after this pass works in sRGB like the palette and UI.
  vec4 c = vec4(toSRGB(texture2D(tColor, vUv).rgb), 1.0);
  if (enabled < 0.5) { gl_FragColor = c; return; }
  float d = lin(texture2D(tDepth, vUv).r);
  vec3 n = texture2D(tNormal, vUv).rgb * 2.0 - 1.0;
  float edge = 0.0;
  vec2 offs[4];
  offs[0] = vec2(texel.x, 0.0); offs[1] = vec2(-texel.x, 0.0); offs[2] = vec2(0.0, texel.y); offs[3] = vec2(0.0, -texel.y);
  for (int i = 0; i < 4; i++) {
    float dn = lin(texture2D(tDepth, vUv + offs[i]).r);
    vec3 nn = texture2D(tNormal, vUv + offs[i]).rgb * 2.0 - 1.0;
    // Only draw on the nearer side of a depth step so lines stay exactly 1px.
    if (dn - d > 0.35) edge = 1.0;
    if (dot(n, nn) < 0.55 && dn >= d - 0.05) edge = max(edge, 0.85);
  }
  bool bg = texture2D(tDepth, vUv).r >= 0.9999;
  if (bg) edge = 0.0;
  gl_FragColor = vec4(mix(c.rgb, ink, edge), 1.0);
}
`;

const tiltFrag = /* glsl */ `
uniform sampler2D tColor; uniform vec2 texel; uniform float enabled; uniform float focusY; uniform float band;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tColor, vUv);
  if (enabled < 0.5) { gl_FragColor = c; return; }
  float dist = max(0.0, abs(vUv.y - focusY) - band);
  float r = clamp(dist * 9.0, 0.0, 2.2);
  if (r < 0.05) { gl_FragColor = c; return; }
  vec3 acc = c.rgb; float w = 1.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 2.39996;
    float rr = r * sqrt((float(i) + 0.5) / 12.0);
    vec2 o = vec2(cos(a), sin(a)) * rr * texel;
    acc += texture2D(tColor, vUv + o).rgb; w += 1.0;
  }
  gl_FragColor = vec4(acc / w, 1.0);
}
`;

const uiFrag = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tUI; uniform float enabled; uniform vec2 marginUv; uniform vec2 innerUv;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tColor, vUv);
  vec2 uiUv = (vUv - marginUv) / innerUv;
  vec4 u = (enabled > 0.5 && uiUv.x >= 0.0 && uiUv.x <= 1.0 && uiUv.y >= 0.0 && uiUv.y <= 1.0) ? texture2D(tUI, uiUv) : vec4(0.0);
  // Alpha carries the UI mask for the upscale pass (UI must not take the sub-texel shift).
  // Hard alpha threshold keeps pixel-font edges crisp (no half-covered pixels to dither).
  float a = step(0.5, u.a);
  gl_FragColor = vec4(mix(c.rgb, u.rgb, a), a);
}
`;

const quantFrag = /* glsl */ `
uniform sampler2D tColor; uniform vec3 palette[16]; uniform float enabled; uniform float dither; uniform vec2 res;
varying vec2 vUv;
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0)); int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16];
  m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
  m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
  float v = 0.0;
  for (int k = 0; k < 16; k++) if (k == i) v = m[k];
  return v / 16.0 - 0.5;
}
vec3 toLab(vec3 c) { // cheap perceptual weighting (redmean-ish)
  return vec3(c.r * 0.8, c.g * 1.0, c.b * 0.6);
}
void main() {
  vec4 c = texture2D(tColor, vUv);
  if (enabled < 0.5) { gl_FragColor = c; return; }
  vec3 col = c.rgb;
  if (dither > 0.5 && c.a < 0.5) col += bayer(floor(vUv * res)) * 0.09;
  float best = 1e9; vec3 bc = palette[0];
  for (int i = 0; i < 16; i++) {
    vec3 d = toLab(col) - toLab(palette[i]);
    float e = dot(d, d);
    if (e < best) { best = e; bc = palette[i]; }
  }
  gl_FragColor = vec4(bc, c.a);
}
`;

const upFrag = /* glsl */ `
uniform sampler2D tColor; uniform vec2 outSize; uniform vec2 origin; uniform float scale; uniform vec2 shift; uniform vec2 rtSize; uniform float margin; uniform vec3 letterbox;
varying vec2 vUv;
vec4 at(vec2 lowPx) { return texture2D(tColor, (floor(lowPx) + margin + 0.5) / rtSize); }
void main() {
  vec2 p = vUv * outSize - origin;              // output pixels inside the game rect, y up
  vec2 low = vec2(480.0, 270.0);
  if (p.x < 0.0 || p.y < 0.0 || p.x >= low.x * scale || p.y >= low.y * scale) { gl_FragColor = vec4(letterbox, 1.0); return; }
  vec4 plain = at(p / scale);
  if (plain.a > 0.5) { gl_FragColor = vec4(plain.rgb, 1.0); return; } // UI: no shift
  vec4 shifted = at((p + shift) / scale);
  gl_FragColor = vec4(shifted.a > 0.5 ? plain.rgb : shifted.rgb, 1.0);
}
`;

function makeRT(w: number, h: number, depth = false): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace,
  });
  if (depth) {
    rt.depthTexture = new THREE.DepthTexture(w, h);
    rt.depthTexture.type = THREE.UnsignedIntType;
    rt.depthTexture.minFilter = THREE.NearestFilter;
    rt.depthTexture.magFilter = THREE.NearestFilter;
  }
  return rt;
}

/**
 * The post chain: scene (480x270 + 1px margin) with depth → normals pass → 1px ink outline →
 * tilt-shift → UI composite → palette quantize (+ optional 4x4 Bayer) → integer nearest upscale.
 */
export class PostChain {
  readonly rtScene = makeRT(RT_W, RT_H, true);
  readonly rtNormal = makeRT(RT_W, RT_H, true);
  private readonly rtA = makeRT(RT_W, RT_H);
  private readonly rtB = makeRT(RT_W, RT_H);
  private readonly quad: THREE.Mesh;
  private readonly fsScene = new THREE.Scene();
  private readonly fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly normalMat = new THREE.MeshNormalMaterial();
  readonly uiTexture: THREE.CanvasTexture;
  readonly toggles: PostToggles = { outline: true, tiltShift: true, ui: true, quantize: true, dither: true };
  private readonly mOutline: THREE.ShaderMaterial;
  private readonly mTilt: THREE.ShaderMaterial;
  private readonly mUI: THREE.ShaderMaterial;
  private readonly mQuant: THREE.ShaderMaterial;
  private readonly mUp: THREE.ShaderMaterial;
  scale = 1;
  tiltFocusY = 0.5;

  constructor(uiCanvas: HTMLCanvasElement) {
    this.uiTexture = new THREE.CanvasTexture(uiCanvas);
    this.uiTexture.minFilter = THREE.NearestFilter;
    this.uiTexture.magFilter = THREE.NearestFilter;
    this.uiTexture.generateMipmaps = false;
    this.uiTexture.colorSpace = THREE.NoColorSpace;
    this.uiTexture.flipY = true;
    const texel = new THREE.Vector2(1 / RT_W, 1 / RT_H);
    const ink = new THREE.Vector3(...hexToRgb01(PALETTE_HEX[0]));
    this.mOutline = new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: outlineFrag, uniforms: {
      tColor: { value: null }, tDepth: { value: this.rtScene.depthTexture }, tNormal: { value: this.rtNormal.texture },
      texel: { value: texel }, near: { value: 0.1 }, far: { value: 200 }, enabled: { value: 1 }, ink: { value: ink } } });
    this.mTilt = new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: tiltFrag, uniforms: {
      tColor: { value: null }, texel: { value: texel }, enabled: { value: 1 }, focusY: { value: 0.5 }, band: { value: 0.16 } } });
    this.mUI = new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: uiFrag, uniforms: {
      tColor: { value: null }, tUI: { value: this.uiTexture }, enabled: { value: 1 },
      marginUv: { value: new THREE.Vector2(MARGIN / RT_W, MARGIN / RT_H) }, innerUv: { value: new THREE.Vector2(LOW_W / RT_W, LOW_H / RT_H) } } });
    const pal = PALETTE_HEX.map((h) => new THREE.Vector3(...hexToRgb01(h)));
    this.mQuant = new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: quantFrag, uniforms: {
      tColor: { value: null }, palette: { value: pal }, enabled: { value: 1 }, dither: { value: 1 }, res: { value: new THREE.Vector2(RT_W, RT_H) } } });
    this.mUp = new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: upFrag, uniforms: {
      tColor: { value: null }, outSize: { value: new THREE.Vector2(1, 1) }, origin: { value: new THREE.Vector2() },
      scale: { value: 1 }, shift: { value: new THREE.Vector2() }, rtSize: { value: new THREE.Vector2(RT_W, RT_H) },
      margin: { value: MARGIN }, letterbox: { value: ink } } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mOutline);
    this.quad.frustumCulled = false;
    this.fsScene.add(this.quad);
  }

  private pass(r: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, input: THREE.Texture | null, target: THREE.WebGLRenderTarget | null): void {
    if (mat.uniforms.tColor) mat.uniforms.tColor.value = input;
    this.quad.material = mat;
    r.setRenderTarget(target);
    r.render(this.fsScene, this.fsCam);
  }

  /**
   * Render the whole frame. `vfxLayer` objects (sprites) are drawn after the normals pass so
   * they light and blend but do not get inked.
   */
  render(r: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.OrthographicCamera, remainder: THREE.Vector2, outW: number, outH: number, uiDirty: boolean): void {
    const t = this.toggles;
    // 1. Scene colour + depth (opaque layer 0 only).
    camera.layers.set(0);
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x14121c, 1);
    r.clear();
    r.render(scene, camera);
    // 2. Normals.
    if (t.outline) {
      const bg = scene.background;
      scene.background = null;
      scene.overrideMaterial = this.normalMat;
      r.setRenderTarget(this.rtNormal);
      r.setClearColor(0x8080ff, 1);
      r.clear();
      r.render(scene, camera);
      scene.overrideMaterial = null;
      scene.background = bg;
    }
    // 3. VFX layer on top of the scene colour, depth-tested but not written.
    camera.layers.set(1);
    const autoClear = r.autoClear;
    const bg = scene.background;
    scene.background = null; // a Color background would force a clear and wipe the scene
    r.autoClear = false;
    r.setRenderTarget(this.rtScene);
    r.render(scene, camera);
    r.autoClear = autoClear;
    scene.background = bg;
    camera.layers.set(0);
    // 4. Outline → A, 5. tilt-shift → B, 6. UI → A, 7. quantize → B, 8. upscale → screen.
    this.mOutline.uniforms.enabled!.value = t.outline ? 1 : 0;
    this.pass(r, this.mOutline, this.rtScene.texture, this.rtA);
    this.mTilt.uniforms.enabled!.value = t.tiltShift ? 1 : 0;
    this.mTilt.uniforms.focusY!.value = this.tiltFocusY;
    this.pass(r, this.mTilt, this.rtA.texture, this.rtB);
    if (uiDirty) this.uiTexture.needsUpdate = true;
    this.mUI.uniforms.enabled!.value = t.ui ? 1 : 0;
    this.pass(r, this.mUI, this.rtB.texture, this.rtA);
    this.mQuant.uniforms.enabled!.value = t.quantize ? 1 : 0;
    this.mQuant.uniforms.dither!.value = t.dither ? 1 : 0;
    this.pass(r, this.mQuant, this.rtA.texture, this.rtB);
    const scale = Math.max(1, Math.floor(Math.min(outW / LOW_W, outH / LOW_H)));
    this.scale = scale;
    const ox = Math.floor((outW - LOW_W * scale) / 2), oy = Math.floor((outH - LOW_H * scale) / 2);
    const u = this.mUp.uniforms;
    (u.outSize!.value as THREE.Vector2).set(outW, outH);
    (u.origin!.value as THREE.Vector2).set(ox, oy);
    u.scale!.value = scale;
    // Remainder is in texels (right, up); convert to whole output pixels.
    (u.shift!.value as THREE.Vector2).set(Math.round(remainder.x * scale), Math.round(remainder.y * scale));
    r.setViewport(0, 0, outW, outH);
    this.pass(r, this.mUp, this.rtB.texture, null);
  }

  /** Read back the final low-res frame (for tests/screenshots of the internal image). */
  dispose(): void {
    for (const rt of [this.rtScene, this.rtNormal, this.rtA, this.rtB]) rt.dispose();
  }
}
