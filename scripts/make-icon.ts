// Generates build/icon.png (512x512): a palette-colored d20 silhouette on the table.
import { PNG } from "pngjs";
import { writeFileSync } from "node:fs";

const S = 512;
const png = new PNG({ width: S, height: S });
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const ink = hex("#14121c"), wine = hex("#8f2a35"), blood = hex("#e5584f"), amber = hex("#f2b45a"), bone = hex("#e9e4d6"), night = hex("#2a2438");
function put(x: number, y: number, c: [number, number, number], a = 255): void {
  const i = (y * S + x) * 4;
  png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; png.data[i + 3] = a;
}
const cx = S / 2, cy = S / 2;
// Hexagon (d20 outline) with three facets, drawn at 16px "pixel" blocks for a chunky look.
const P = 16;
for (let by = 0; by < S; by += P) for (let bx = 0; bx < S; bx += P) {
  const x = bx + P / 2 - cx, y = by + P / 2 - cy;
  const r = 210;
  const inHex = Math.abs(y) <= r * 0.866 && Math.abs(x) * 0.866 + Math.abs(y) * 0.5 <= r * 0.866;
  let c = inHex ? wine : null;
  if (inHex) {
    if (y < -x * 0.577 + 10 && y < x * 0.577 + 10 && y > -120) c = blood; // top facet
    if (Math.abs(x) * 0.866 + Math.abs(y) * 0.5 > r * 0.866 - 18) c = ink; // rim
  }
  const plate = Math.hypot(x, y) < 250;
  for (let yy = 0; yy < P; yy++) for (let xx = 0; xx < P; xx++) {
    if (c) put(bx + xx, by + yy, c);
    else if (plate) put(bx + xx, by + yy, night);
    else put(bx + xx, by + yy, ink, 0);
  }
}
// "20" in blocky digits.
const digits: Record<string, string[]> = {
  "2": ["111", "001", "111", "100", "111"],
  "0": ["111", "101", "101", "101", "111"],
};
let ox = cx - 7 * P * 0.5 * 2 + P * 3;
for (const d of "20") {
  const g = digits[d]!;
  g.forEach((line, gy) => [...line].forEach((ch, gx) => {
    if (ch !== "1") return;
    for (let yy = 0; yy < P * 2; yy++) for (let xx = 0; xx < P * 2; xx++) put(ox + gx * P * 2 + xx, cy - P * 3 + gy * P * 2 + yy - 40, gy === 0 ? amber : bone);
  }));
  ox += P * 8;
}
writeFileSync("build/icon.png", PNG.sync.write(png));
console.log("wrote build/icon.png");
