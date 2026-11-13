import { describe, expect, it } from "vitest";
import { type TreeRow, placeAt, planMove, subtreeHeight, subtreeIds } from "./tree.js";

// a (1) ─ b (2) ─ c (3) ─ d (4)
// e (1)
const rows: TreeRow[] = [
  { id: "a", parentId: null, depth: 1 },
  { id: "b", parentId: "a", depth: 2 },
  { id: "c", parentId: "b", depth: 3 },
  { id: "d", parentId: "c", depth: 4 },
  { id: "e", parentId: null, depth: 1 },
];

describe("subtree", () => {
  it("lists the item and everything under it", () => {
    expect(subtreeIds(rows, "b")).toEqual(["b", "c", "d"]);
    expect(subtreeIds(rows, "e")).toEqual(["e"]);
  });

  it("measures how many levels a branch spans", () => {
    expect(subtreeHeight(rows, "a")).toBe(4);
    expect(subtreeHeight(rows, "d")).toBe(1);
  });
});

describe("planMove", () => {
  it("refuses moving an item under itself or its own descendant", () => {
    expect(planMove(rows, "b", "b")).toEqual({ reason: "TREE_CYCLE" });
    expect(planMove(rows, "a", "d")).toEqual({ reason: "TREE_CYCLE" });
  });

  it("refuses a move that would push the branch below level 5", () => {
    // a's branch spans 4 levels; under e it would reach level 5: allowed.
    expect(planMove(rows, "a", "e")).toEqual({ depth: 2 });
    // b's branch spans 3 levels; under g (level 3) it would reach level 6.
    const r = [...rows, { id: "f", parentId: "e", depth: 2 }, { id: "g", parentId: "f", depth: 3 }];
    expect(planMove(r, "b", "g")).toEqual({ reason: "TREE_TOO_DEEP" });
  });

  it("moving to the top makes the item level 1", () => {
    expect(planMove(rows, "c", null)).toEqual({ depth: 1 });
  });
});

describe("placeAt", () => {
  it("puts the item at the position, or last when the position is missing or too large", () => {
    expect(placeAt(["x", "y", "z"], "n", 1)).toEqual(["x", "n", "y", "z"]);
    expect(placeAt(["x", "y"], "n")).toEqual(["x", "y", "n"]);
    expect(placeAt(["x", "y"], "n", 99)).toEqual(["x", "y", "n"]);
  });

  it("moves an existing sibling without duplicating it", () => {
    expect(placeAt(["x", "y", "z"], "z", 0)).toEqual(["z", "x", "y"]);
  });
});
