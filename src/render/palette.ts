/** The 16-colour "Candlelit Diorama" palette. Everything on screen is quantized to these. */
export const PALETTE_HEX = [
  "#14121c", "#2a2438", "#463c5e", "#6b6185", "#a49eb6", "#e9e4d6", "#3d5a45", "#5fc77a",
  "#2f4f7a", "#4f9be5", "#7a3b2e", "#c4673d", "#f2b45a", "#e8cf4a", "#8f2a35", "#e5584f",
] as const;

export const PAL = {
  ink: "#14121c", night: "#2a2438", dusk: "#463c5e", mist: "#6b6185", fog: "#a49eb6", bone: "#e9e4d6",
  moss: "#3d5a45", leaf: "#5fc77a", deep: "#2f4f7a", sky: "#4f9be5", rust: "#7a3b2e", ember: "#c4673d",
  amber: "#f2b45a", gold: "#e8cf4a", wine: "#8f2a35", blood: "#e5584f",
} as const;

export function hexToRgb01(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
}

/** Player identity: colour + shape, never colour alone. Alternative set for colour-blind players. */
export const PLAYER_IDENTITY = [
  { name: "P1", shape: "circle", color: PAL.blood, alt: PAL.amber },
  { name: "P2", shape: "square", color: PAL.sky, alt: PAL.sky },
  { name: "P3", shape: "triangle", color: PAL.leaf, alt: PAL.bone },
  { name: "P4", shape: "diamond", color: PAL.gold, alt: PAL.wine },
] as const;
export type PlayerShape = (typeof PLAYER_IDENTITY)[number]["shape"];
