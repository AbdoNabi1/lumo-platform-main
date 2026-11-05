import { describe, expect, it } from "vitest";
import {
  isMenuHandle,
  linkRefTargetsOf,
  MENU_LIMITS,
  readResolvedMenu,
  validateMenuItems,
} from "./menus";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number, link: unknown = { type: "home" }, children: unknown[] = []) => ({
  id: ID(n),
  label: { en: `Item ${n}` },
  link,
  children,
});
const issuesOf = (raw: unknown) => {
  const out = validateMenuItems(raw);
  return out.ok ? [] : out.issues;
};
const ch = (code: number) => String.fromCharCode(code);

describe("isMenuHandle", () => {
  it("lower-case words joined by single hyphens, at most 60", () => {
    for (const ok of ["main-menu", "footer", "a", "sale-2026"]) expect(isMenuHandle(ok)).toBe(true);
    for (const bad of ["Main", "-a", "a-", "a--b", "a_b", "", "a".repeat(61), 1]) {
      expect(isMenuHandle(bad), String(bad)).toBe(false);
    }
  });
});

describe("validateMenuItems (spec 2.2)", () => {
  it("accepts every link type and normalises labels and urls", () => {
    const out = validateMenuItems([
      item(1, { type: "home" }),
      item(2, { type: "search" }),
      item(3, { type: "collection", id: "col-1" }, [
        item(4, { type: "product", id: "p-1" }),
        item(5, { type: "page", id: "pg-1" }),
      ]),
      item(6, { type: "policy", policy: "refund" }),
      {
        id: ID(7),
        label: { ar: "  واتساب  " },
        link: { type: "url", url: "HTTPS://WA.ME/201001234567" },
      },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value).toHaveLength(5);
    expect(out.value[4]).toEqual({
      id: ID(7),
      label: { ar: "واتساب" },
      link: { type: "url", url: "https://wa.me/201001234567" },
      children: [],
    });
    expect(linkRefTargetsOf(out.value)).toEqual({
      collection: ["col-1"],
      product: ["p-1"],
      page: ["pg-1"],
    });
  });

  it("a child with children is MENU_TOO_DEEP", () => {
    expect(
      issuesOf([item(1, { type: "home" }, [item(2, { type: "home" }, [item(3)])])]),
    ).toContainEqual({
      path: "items.0.children.0.children",
      code: "MENU_TOO_DEEP",
    });
  });

  it("over 30 top-level, 30 children or 150 in all is TOO_MANY_ITEMS; a huge array is MENU_TOO_LARGE", () => {
    expect(issuesOf(Array.from({ length: 31 }, (_, i) => item(i + 1)))).toEqual([
      { path: "items", code: "TOO_MANY_ITEMS" },
    ]);
    expect(issuesOf(Array.from({ length: 1_000 }, (_, i) => item(i + 1)))).toEqual([
      { path: "items", code: "TOO_MANY_ITEMS" },
    ]);
    const wide = item(
      1,
      { type: "home" },
      Array.from({ length: 31 }, (_, i) => item(i + 2)),
    );
    expect(issuesOf([wide])).toContainEqual({ path: "items.0.children", code: "TOO_MANY_ITEMS" });
    const total = Array.from({ length: 6 }, (_, top) =>
      item(
        1000 + top,
        { type: "home" },
        Array.from({ length: 25 }, (_, c) => item(top * 100 + c + 1)),
      ),
    );
    expect(issuesOf(total)).toContainEqual({ path: "items", code: "TOO_MANY_ITEMS" });
    expect(MENU_LIMITS).toEqual({ topLevel: 30, children: 30, total: 150 });
    expect(issuesOf(Array.from({ length: 200_000 }, () => ({})))).toEqual([
      { path: "items", code: "MENU_TOO_LARGE" },
    ]);
  });

  it("ids are uuids, unique across the whole tree", () => {
    expect(issuesOf([{ ...item(1), id: "1" }])).toContainEqual({
      path: "items.0.id",
      code: "INVALID_VALUE",
    });
    expect(issuesOf([item(1, { type: "home" }, [item(1)])])).toContainEqual({
      path: "items.0.children.0.id",
      code: "DUPLICATE_ITEM_ID",
    });
  });

  it("a label needs one locale; whitespace or bidi controls alone are LABEL_REQUIRED; > 60 is TOO_LONG", () => {
    expect(
      issuesOf([{ ...item(1), label: { ar: " ", en: `${ch(0x202e)}${ch(0x2066)}` } }]),
    ).toContainEqual({
      path: "items.0.label",
      code: "LABEL_REQUIRED",
    });
    expect(issuesOf([{ ...item(1), label: { en: "a".repeat(61) } }])).toContainEqual({
      path: "items.0.label.en",
      code: "TOO_LONG",
    });
  });

  it.each([
    "JAVASCRIPT:alert(1)",
    "javascript:alert(1)",
    "https://user:pass@evil.example",
    "http://plain.example",
    "tel:call-me",
    "data:text/html,x",
    "//evil.example",
    "/pages/about",
    `https://shop.example/${ch(0)}`,
    ` https://shop.example`,
  ])("a url link %j is INVALID_URL", (url) => {
    expect(issuesOf([item(1, { type: "url", url })])).toContainEqual({
      path: "items.0.link.url",
      code: "INVALID_URL",
    });
  });

  it("a menu can only link to resources: menu and item links do not exist (no loops)", () => {
    expect(issuesOf([item(1, { type: "menu", handle: "main-menu" })])).toContainEqual({
      path: "items.0.link.type",
      code: "INVALID_LINK",
    });
    expect(issuesOf([item(1, { type: "policy", policy: "cookies" })])).toContainEqual({
      path: "items.0.link.policy",
      code: "INVALID_VALUE",
    });
    expect(issuesOf([item(1, { type: "collection", id: "x".repeat(65) })])).toContainEqual({
      path: "items.0.link.id",
      code: "INVALID_VALUE",
    });
  });

  it("unknown keys and a non-array are refused", () => {
    expect(issuesOf([{ ...item(1), extra: 1 }])).toContainEqual({
      path: "items.0.extra",
      code: "UNKNOWN_KEY",
    });
    expect(issuesOf({})).toEqual([{ path: "items", code: "INVALID_VALUE" }]);
  });

  it("link ids named like prototype members are plain data, never a prototype lookup", () => {
    const out = validateMenuItems([
      item(1, { type: "collection", id: "__proto__" }),
      item(2, { type: "product", id: "constructor" }),
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const targets = linkRefTargetsOf(out.value);
    expect(targets.collection).toEqual(["__proto__"]);
    expect(targets.product).toEqual(["constructor"]);
  });

  it("an own __proto__ key on an item is an unknown key, not a prototype write", () => {
    const hostile = JSON.parse(
      `{"id":"${ID(1)}","label":{"en":"a"},"link":{"type":"home"},"__proto__":{"x":1}}`,
    );
    expect(issuesOf([hostile])).toContainEqual({ path: "items.0.__proto__", code: "UNKNOWN_KEY" });
  });
});

describe("readResolvedMenu (storefront re-validation)", () => {
  it("keeps safe items, drops unsafe hrefs and empty labels, recomputes external, ignores grandchildren", () => {
    const menu = readResolvedMenu([
      { label: { en: "Home" }, href: "/", external: true, children: [] },
      { label: { en: "X" }, href: "javascript:alert(1)", external: false, children: [] },
      { label: { en: " " }, href: "/search", external: false, children: [] },
      {
        label: { ar: "تسوق" },
        href: "https://shop.example",
        external: false,
        children: [
          {
            label: { en: "Sale" },
            href: "/collections/sale",
            children: [{ label: { en: "deep" }, href: "/" }],
          },
          { label: { en: "Evil" }, href: "//evil.example" },
        ],
      },
    ]);
    expect(menu).toEqual([
      { label: { en: "Home" }, href: "/", external: false, children: [] },
      {
        label: { ar: "تسوق" },
        href: "https://shop.example/",
        external: true,
        children: [
          { label: { en: "Sale" }, href: "/collections/sale", external: false, children: [] },
        ],
      },
    ]);
  });
  it("anything that is not an array is an empty menu; the caps hold", () => {
    expect(readResolvedMenu(null)).toEqual([]);
    const many = Array.from({ length: 40 }, () => ({ label: { en: "a" }, href: "/" }));
    expect(readResolvedMenu(many)).toHaveLength(30);
  });
  it("holds 150 items in all across both levels", () => {
    const top = Array.from({ length: 30 }, () => ({
      label: { en: "a" },
      href: "/",
      children: Array.from({ length: 30 }, () => ({ label: { en: "b" }, href: "/" })),
    }));
    const menu = readResolvedMenu(top);
    expect(menu.reduce((n, m) => n + 1 + m.children.length, 0)).toBeLessThanOrEqual(150);
  });
});

describe("fix round 1 (review minors)", () => {
  const strip = [0x00ad, 0x061c, 0x200b, 0x200e, 0x200f, 0x2060, 0x2062, 0x2064, 0xfeff];

  it.each(strip)("a label of only U+%s is LABEL_REQUIRED", (code) => {
    const label = { en: ch(code).repeat(3), ar: ` ${ch(code)} ` };
    expect(issuesOf([{ ...item(1), label }])).toContainEqual({
      path: "items.0.label",
      code: "LABEL_REQUIRED",
    });
  });

  it("a label of only joiners is empty too", () => {
    const label = { en: `${ch(0x200c)}${ch(0x200d)}` };
    expect(issuesOf([{ ...item(1), label }])).toContainEqual({
      path: "items.0.label",
      code: "LABEL_REQUIRED",
    });
  });

  it("strips invisible marks from a label but keeps ZWNJ and ZWJ between letters", () => {
    const noisy = `a${strip.map(ch).join("")}b${ch(0x200c)}c${ch(0x200d)}d`;
    const out = validateMenuItems([{ ...item(1), label: { en: noisy } }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value[0]?.label).toEqual({ en: `ab${ch(0x200c)}c${ch(0x200d)}d` });
  });

  it("the storefront reader strips and drops them the same way", () => {
    const menu = readResolvedMenu([
      { label: { en: `x${ch(0x200b)}y` }, href: "/" },
      { label: { en: ch(0x200e) }, href: "/search" },
    ]);
    expect(menu).toEqual([{ label: { en: "xy" }, href: "/", external: false, children: [] }]);
  });

  it("accepts exactly 30 top-level, 30 children and 150 in all", () => {
    expect(issuesOf(Array.from({ length: 30 }, (_, i) => item(i + 1)))).toEqual([]);
    const thirtyChildren = item(
      1,
      { type: "home" },
      Array.from({ length: 30 }, (_, i) => item(i + 2)),
    );
    expect(issuesOf([thirtyChildren])).toEqual([]);
    const total150 = Array.from({ length: 5 }, (_, top) =>
      item(
        1000 + top,
        { type: "home" },
        Array.from({ length: 29 }, (_, c) => item(top * 100 + c + 1)),
      ),
    );
    expect(issuesOf(total150)).toEqual([]);
    const total151 = [...total150.slice(0, 4), { ...total150[4], children: total150[4]!.children }];
    total151.push(item(2000));
    expect(issuesOf(total151)).toContainEqual({ path: "items", code: "TOO_MANY_ITEMS" });
  });

  it("ids differing only in case are duplicates", () => {
    const upper = { ...item(2), id: ID(1).replace("0000", "000A").toUpperCase() };
    const lower = { ...item(1), id: ID(1).replace("0000", "000a") };
    expect(issuesOf([lower, upper])).toContainEqual({
      path: "items.1.id",
      code: "DUPLICATE_ITEM_ID",
    });
  });

  it("the exported limits are frozen", () => {
    expect(Object.isFrozen(MENU_LIMITS)).toBe(true);
  });
});
