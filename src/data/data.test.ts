import { describe, expect, it } from "vitest";
import { CLASSES, ENEMIES, ITEMS, validateCrossRefs, ACTS } from "./index";

describe("data", () => {
  it("parses every file and cross-references resolve", () => {
    expect(validateCrossRefs()).toEqual([]);
  });
  it("has the content the brief asks for", () => {
    expect(Object.keys(CLASSES).length).toBe(10);
    expect(Object.keys(ENEMIES).length).toBeGreaterThanOrEqual(25);
    expect(Object.keys(ITEMS.items).length).toBeGreaterThanOrEqual(60);
    expect(ACTS.acts.map((a) => a.boss)).toEqual(["wight", "owlbear", "young_black_dragon", "lich"]);
  });
});
