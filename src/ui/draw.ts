import { PAL } from "../render/palette";

export const UI_W = 480;
export const UI_H = 270;

let fontReady = false;
let fontFamily = "monospace";

/** Load the Ninja Adventure pixel font. Falls back to monospace if missing. */
export async function loadFont(): Promise<void> {
  try {
    const f = new FontFace("NinjaPixel", "url(./assets/ui/font.ttf)");
    await f.load();
    document.fonts.add(f);
    fontFamily = "NinjaPixel";
    fontReady = true;
  } catch {
    fontReady = false;
  }
}
export const hasPixelFont = (): boolean => fontReady;

const images = new Map<string, HTMLImageElement>();
export async function loadUiImages(names: string[]): Promise<void> {
  await Promise.all(names.map((n) => new Promise<void>((res) => {
    const img = new Image();
    img.onload = () => { images.set(n, img); res(); };
    img.onerror = () => res();
    img.src = `./assets/ui/${n}.png`;
  })));
}
export const uiImage = (n: string): HTMLImageElement | undefined => images.get(n);

/** Thin wrapper over the 480x270 UI canvas: pixel text, 9-slice panels, bars, rings. */
export class Draw {
  readonly g: CanvasRenderingContext2D;
  scale = 1;
  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = UI_W;
    canvas.height = UI_H;
    this.g = canvas.getContext("2d", { willReadFrequently: false })!;
    this.g.imageSmoothingEnabled = false;
  }
  clear(): void {
    this.g.clearRect(0, 0, UI_W, UI_H);
  }
  font(size: number): void {
    this.g.font = `${Math.round(size * this.scale)}px ${fontFamily}`;
    // The Ninja Adventure font has a hairline space glyph.
    (this.g as CanvasRenderingContext2D & { wordSpacing: string }).wordSpacing = fontReady ? `${Math.max(2, Math.round(size / 3))}px` : "0px";
  }
  text(s: string, x: number, y: number, color: string = PAL.bone, size = 8, align: CanvasTextAlign = "left", shadow = true): void {
    const g = this.g;
    this.font(size);
    g.textAlign = align;
    g.textBaseline = "top";
    if (shadow) {
      g.fillStyle = PAL.ink;
      g.fillText(s, Math.round(x) + 1, Math.round(y) + 1);
    }
    g.fillStyle = color;
    g.fillText(s, Math.round(x), Math.round(y));
  }
  width(s: string, size = 8): number {
    this.font(size);
    return this.g.measureText(s).width;
  }
  /** Word-wrap into lines no wider than `w`. */
  wrap(s: string, w: number, size = 8): string[] {
    const words = s.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
      const t = cur ? `${cur} ${word}` : word;
      if (this.width(t, size) > w && cur) {
        lines.push(cur);
        cur = word;
      } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.g.fillStyle = color;
    this.g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  frame(x: number, y: number, w: number, h: number, color: string): void {
    const g = this.g;
    g.fillStyle = color;
    g.fillRect(x, y, w, 1);
    g.fillRect(x, y + h - 1, w, 1);
    g.fillRect(x, y, 1, h);
    g.fillRect(x + w - 1, y, 1, h);
  }
  /** Ninja Adventure 9-slice panel, falling back to a flat palette box. */
  panel(x: number, y: number, w: number, h: number, kind = "nine_path_4"): void {
    const img = images.get(kind);
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    if (!img) {
      this.rect(x, y, w, h, PAL.night);
      this.frame(x, y, w, h, PAL.mist);
      return;
    }
    const s = Math.floor(Math.min(img.width, img.height) / 3);
    const g = this.g;
    const sw = img.width - 2 * s, sh = img.height - 2 * s;
    const dw = Math.max(0, w - 2 * s), dh = Math.max(0, h - 2 * s);
    g.drawImage(img, 0, 0, s, s, x, y, s, s);
    g.drawImage(img, s, 0, sw, s, x + s, y, dw, s);
    g.drawImage(img, s + sw, 0, s, s, x + s + dw, y, s, s);
    g.drawImage(img, 0, s, s, sh, x, y + s, s, dh);
    // Centre in a flat palette colour so text on it stays readable after quantizing.
    g.fillStyle = kind === "t1_nine_path_focus" ? PAL.dusk : PAL.night;
    g.fillRect(x + s, y + s, dw, dh);
    g.drawImage(img, s + sw, s, s, sh, x + s + dw, y + s, s, dh);
    g.drawImage(img, 0, s + sh, s, s, x, y + s + dh, s, s);
    g.drawImage(img, s, s + sh, sw, s, x + s, y + s + dh, dw, s);
    g.drawImage(img, s + sw, s + sh, s, s, x + s + dw, y + s + dh, s, s);
  }
  /** 50% checkerboard dim (stays crisp through the alpha threshold and palette quantize). */
  dim(x = 0, y = 0, w = UI_W, h = UI_H): void {
    if (!this.checker) {
      const c = document.createElement("canvas");
      c.width = c.height = 2;
      const g = c.getContext("2d")!;
      g.fillStyle = PAL.ink;
      g.fillRect(0, 0, 1, 1);
      g.fillRect(1, 1, 1, 1);
      this.checker = this.g.createPattern(c, "repeat");
    }
    this.g.fillStyle = this.checker!;
    this.g.fillRect(x, y, w, h);
  }
  private checker: CanvasPattern | null = null;

  bar(x: number, y: number, w: number, h: number, frac: number, color: string, back: string = PAL.ink): void {
    this.rect(x, y, w, h, back);
    this.rect(x, y, Math.max(0, Math.min(1, frac)) * w, h, color);
  }
  /** Ring progress (Round Clock), drawn with stepped pixels. */
  ring(cx: number, cy: number, r: number, frac: number, color: string, back: string = PAL.dusk): void {
    const g = this.g;
    const n = Math.max(12, Math.round(r * 6));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      g.fillStyle = i / n <= frac ? color : back;
      g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
    }
  }
  /** Player identity shape glyph (circle/square/triangle/diamond). */
  shape(kind: string, cx: number, cy: number, r: number, color: string): void {
    const g = this.g;
    g.fillStyle = color;
    g.beginPath();
    if (kind === "square") g.rect(cx - r, cy - r, r * 2, r * 2);
    else if (kind === "triangle") { g.moveTo(cx, cy - r); g.lineTo(cx + r, cy + r); g.lineTo(cx - r, cy + r); g.closePath(); }
    else if (kind === "diamond") { g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath(); }
    else g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  }
}
