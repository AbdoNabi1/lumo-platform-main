import { describe, expect, it } from "vitest";
import { DEFAULT_ITEM_IDS, virtualDefaultMenu } from "./default-menus";
import { Menu } from "./menu";

const now = new Date("2026-11-04T10:00:00.000Z");

describe("Menu", () => {
  it("is created unpersisted at version 0 and saves as version 1", () => {
    const menu = Menu.create({ id: "m-1", handle: "sale", title: "Sale", items: [], now });
    expect(menu.snapshot()).toMatchObject({
      id: "m-1",
      version: 0,
      persisted: false,
      updatedAt: now,
    });
    expect(menu.nextVersion).toBe(1);
    expect(menu.isDefault).toBe(false);
  });

  it("update replaces the title and the items and stamps the time", () => {
    const menu = Menu.reconstitute({
      id: "m-1",
      handle: "footer",
      title: "Footer menu",
      items: [],
      version: 3,
      updatedAt: null,
      persisted: true,
    });
    const later = new Date("2026-11-04T11:00:00.000Z");
    menu.update("Bottom", [], later);
    expect(menu.snapshot()).toMatchObject({ title: "Bottom", version: 3, updatedAt: later });
    expect(menu.nextVersion).toBe(4);
    expect(menu.isDefault).toBe(true);
  });
});

describe("virtualDefaultMenu (spec 2.2, Ruling 12)", () => {
  it("main-menu is Home then Search with fixed ids", () => {
    const s = virtualDefaultMenu("main-menu", ["refund"]).snapshot();
    expect(s).toMatchObject({
      id: null,
      handle: "main-menu",
      title: "Main menu",
      version: 0,
      persisted: false,
    });
    expect(s.items).toEqual([
      {
        id: DEFAULT_ITEM_IDS.home,
        label: { ar: "الرئيسية", en: "Home" },
        link: { type: "home" },
        children: [],
      },
      {
        id: DEFAULT_ITEM_IDS.search,
        label: { ar: "البحث", en: "Search" },
        link: { type: "search" },
        children: [],
      },
    ]);
  });

  it("footer is Search then one item per SET policy, in policy order", () => {
    const s = virtualDefaultMenu("footer", ["terms", "refund"]).snapshot();
    expect(s.items.map((i) => i.link)).toEqual([
      { type: "search" },
      { type: "policy", policy: "refund" },
      { type: "policy", policy: "terms" },
    ]);
    expect(s.items[1]).toMatchObject({
      id: DEFAULT_ITEM_IDS.refund,
      label: { ar: "سياسة الاسترجاع", en: "Refund policy" },
    });
  });

  it("the fixed item ids are distinct and valid menu item ids", () => {
    const ids = Object.values(DEFAULT_ITEM_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_ITEM_IDS.contact).toBe("00000000-0000-4000-8000-000000000105");
  });

  it("every default menu passes the write-path validator", async () => {
    const { validateMenuItems } = await import("@platform/storefront-content");
    for (const handle of ["main-menu", "footer"] as const) {
      const items = virtualDefaultMenu(handle, [
        "refund",
        "shipping",
        "privacy",
        "terms",
        "contact",
      ]).snapshot().items;
      expect(validateMenuItems(items).ok).toBe(true);
    }
  });
});
