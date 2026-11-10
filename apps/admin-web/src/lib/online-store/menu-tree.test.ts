import { describe, expect, it } from "vitest";
import {
  addItem,
  locateItem,
  moveItem,
  moveItemTo,
  removeItem,
  replaceItem,
  toMenuItems,
  type EditableItem,
} from "./menu-tree";

const item = (id: string, children: EditableItem[] = []): EditableItem => ({
  id,
  label: { en: id },
  link: { type: "home" },
  children,
});

describe("menu tree (spec 2.7)", () => {
  it("adds at the top level, or under a top-level parent only", () => {
    const one = addItem([], item("a"));
    const two = addItem(one, item("b"), "a");
    expect(two[0]?.children.map((c) => c.id)).toEqual(["b"]);
    expect(addItem(two, item("c"), "b")).toEqual(two);
  });
  it("moves within a level and clamps at the ends", () => {
    const list = [item("a"), item("b"), item("c", [item("x"), item("y")])];
    expect(moveItem(list, "c", -1).map((i) => i.id)).toEqual(["a", "c", "b"]);
    expect(moveItem(list, "a", -1).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(moveItem(list, "x", 1)[2]?.children.map((i) => i.id)).toEqual(["y", "x"]);
  });
  it("a drop moves an item onto a sibling's place, never across levels", () => {
    const list = [item("a"), item("b"), item("c", [item("x"), item("y")])];
    expect(moveItemTo(list, "a", "c").map((i) => i.id)).toEqual(["b", "c", "a"]);
    expect(moveItemTo(list, "c", "a").map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(moveItemTo(list, "y", "x")[2]?.children.map((i) => i.id)).toEqual(["y", "x"]);
    expect(moveItemTo(list, "x", "a")).toEqual(list);
  });
  it("removing a parent removes its children; replace swaps one item", () => {
    const list = [item("a", [item("b")]), item("c")];
    expect(removeItem(list, "a").map((i) => i.id)).toEqual(["c"]);
    expect(replaceItem(list, "b", item("z"))[0]?.children[0]?.id).toBe("z");
  });
  it("toMenuItems strips the view-only fields", () => {
    expect(toMenuItems([{ ...item("a"), broken: true, targetTitle: "Sale" }])).toEqual([
      { id: "a", label: { en: "a" }, link: { type: "home" }, children: [] },
    ]);
  });
});

describe("locateItem", () => {
  it("finds an item's level, index and parent; null when absent", () => {
    const list = [item("a", [item("x"), item("y")]), item("b")];
    expect(locateItem(list, "b")).toEqual({ level: list, index: 1, parent: null });
    expect(locateItem(list, "y")).toMatchObject({ index: 1, parent: { id: "a" } });
    expect(locateItem(list, "zz")).toBeNull();
  });
});
