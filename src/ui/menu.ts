import { PAL } from "../render/palette";
import type { Draw } from "./draw";

export interface MenuItem {
  label: string;
  value?: string;
  /** Show ◀ ▶ around the value (Left/Right changes it). */
  cycle?: boolean;
  disabled?: boolean;
  hint?: string;
}

/** A vertical list menu drawn on a Ninja Adventure panel. */
export function drawMenu(d: Draw, x: number, y: number, w: number, title: string, items: MenuItem[], sel: number, size = 8): number {
  const lh = size + 5;
  const h = 18 + items.length * lh + 4;
  d.panel(x, y, w, h, "nine_path_4");
  d.text(title, x + w / 2, y + 6, PAL.amber, size, "center");
  items.forEach((it, i) => {
    const yy = y + 18 + i * lh;
    if (i === sel) {
      d.rect(x + 4, yy - 1, w - 8, lh, PAL.dusk);
      d.text("▶", x + 6, yy, PAL.gold, size);
    }
    const col = it.disabled ? PAL.mist : i === sel ? PAL.bone : PAL.fog;
    const value = it.value === undefined ? "" : it.cycle ? `◀ ${it.value} ▶` : it.value;
    const vw = value ? d.width(value, size) + 6 : 0;
    d.text(d.fit(it.label, w - 26 - vw, size), x + 16, yy, col, size);
    if (value) d.text(value, x + w - 8, yy, i === sel ? PAL.gold : PAL.fog, size, "right");
  });
  const hint = items[sel]?.hint;
  if (hint) {
    // Hints sit on their own plate under the menu so they stay legible over the 3D scene.
    const lines = d.wrap(hint, w - 12, 8);
    const hh = lines.length * 10 + 6;
    d.rect(x, y + h + 2, w, hh, PAL.ink);
    d.rect(x + 1, y + h + 3, w - 2, hh - 2, PAL.night);
    lines.forEach((ln, i) => d.text(ln, x + 6, y + h + 5 + i * 10, PAL.fog, 8, "left", false));
    return h + hh + 2;
  }
  return h;
}

export function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}
