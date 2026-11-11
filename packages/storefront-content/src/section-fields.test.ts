import { describe, expect, it } from "vitest";
import type { ContentIssue } from "./locale";
import {
  collectFieldRefs,
  emptyFieldValue,
  emptySectionRefs,
  readFields,
  validateFields,
  type FieldDescriptor,
} from "./section-fields";

function check(field: FieldDescriptor, raw: unknown) {
  const issues: ContentIssue[] = [];
  const values = validateFields([field], { [field.key]: raw }, "s", issues);
  return { value: values?.[field.key], issues };
}
const codes = (issues: readonly ContentIssue[]) => issues.map((i) => `${i.path}:${i.code}`);

describe("validateFields — one test per descriptor kind (spec 3.2)", () => {
  it("localizedText: trimmed, ≤ max per locale, ar/en only", () => {
    const f = { kind: "localizedText", key: "heading", max: 80 } as const;
    expect(check(f, { ar: "  عرض  ", en: "Sale" }).value).toEqual({ ar: "عرض", en: "Sale" });
    expect(check(f, {}).value).toEqual({});
    expect(check(f, { ar: "x".repeat(80) }).issues).toEqual([]);
    expect(codes(check(f, { en: "x".repeat(81) }).issues)).toEqual(["s.heading.en:TOO_LONG"]);
    expect(codes(check(f, { fr: "x" }).issues)).toEqual(["s.heading.fr:UNKNOWN_KEY"]);
  });

  it("richText: Morbeh text per locale; an unsafe link is UNSAFE_LINK on that locale", () => {
    const f = { kind: "richText", key: "body", max: 2000 } as const;
    expect(check(f, { ar: "سطر\n**عريض**" }).value).toEqual({ ar: "سطر\n**عريض**" });
    expect(codes(check(f, { en: "[x](javascript:alert(1))" }).issues)).toEqual([
      "s.body.en:UNSAFE_LINK",
    ]);
    expect(codes(check(f, { ar: "x".repeat(2001) }).issues)).toEqual(["s.body.ar:TOO_LONG"]);
  });

  it("image: null or a media id; never a path or a URL", () => {
    const f = { kind: "image", key: "image", purpose: "section_image" } as const;
    expect(check(f, null).value).toBeNull();
    expect(check(f, "asset-1").value).toBe("asset-1");
    for (const bad of ["../x", "https://x.example/a.png", "a".repeat(65), 7]) {
      expect(codes(check(f, bad).issues)).toEqual(["s.image:INVALID_VALUE"]);
    }
  });

  it("link: null or a menu LinkRef under the same rules", () => {
    const f = { kind: "link", key: "buttonLink" } as const;
    expect(check(f, null).value).toBeNull();
    expect(check(f, { type: "collection", id: "c-1" }).value).toEqual({
      type: "collection",
      id: "c-1",
    });
    expect(codes(check(f, { type: "url", url: "http://x.example" }).issues)).toEqual([
      "s.buttonLink.url:INVALID_URL",
    ]);
    expect(codes(check(f, { type: "constructor" }).issues)).toEqual([
      "s.buttonLink.type:INVALID_LINK",
    ]);
  });

  it("collection: null or a target id", () => {
    const f = { kind: "collection", key: "collection" } as const;
    expect(check(f, null).value).toBeNull();
    expect(codes(check(f, "c 1").issues)).toEqual(["s.collection:INVALID_VALUE"]);
  });

  it("products: distinct target ids, at most max; empty is allowed (Ruling 5)", () => {
    const f = { kind: "products", key: "products", max: 12 } as const;
    expect(check(f, []).value).toEqual([]);
    expect(
      codes(
        check(
          f,
          Array.from({ length: 13 }, (_, i) => `p${i}`),
        ).issues,
      ),
    ).toEqual(["s.products:TOO_MANY_ITEMS"]);
    expect(codes(check(f, ["p1", "p1"]).issues)).toEqual(["s.products.1:DUPLICATE_VALUE"]);
  });

  it("number: an integer inside [min, max] on the step", () => {
    const f = { kind: "number", key: "overlay", min: 0, max: 80, step: 10 } as const;
    expect(check(f, 0).value).toBe(0);
    expect(check(f, 80).value).toBe(80);
    for (const bad of [15, 85, 90, -10, 10.5]) {
      expect(codes(check(f, bad).issues)).toEqual(["s.overlay:OUT_OF_RANGE"]);
    }
    expect(codes(check(f, "10").issues)).toEqual(["s.overlay:INVALID_VALUE"]);
  });

  it("select and boolean: exact values only", () => {
    const s = { kind: "select", key: "contentAlign", options: ["start", "center"] } as const;
    expect(check(s, "center").value).toBe("center");
    expect(codes(check(s, "middle").issues)).toEqual(["s.contentAlign:INVALID_VALUE"]);
    expect(codes(check(s, "constructor").issues)).toEqual(["s.contentAlign:INVALID_VALUE"]);
    const b = { kind: "boolean", key: "showViewAll" } as const;
    expect(check(b, true).value).toBe(true);
    expect(codes(check(b, "true").issues)).toEqual(["s.showViewAll:INVALID_VALUE"]);
  });

  it("phone: empty means not set; anything else is normalised or INVALID_PHONE", () => {
    const f = { kind: "phone", key: "phone" } as const;
    expect(check(f, "").value).toBe("");
    expect(check(f, "010 0123 4567").value).toBe("201001234567");
    expect(codes(check(f, "12").issues)).toEqual(["s.phone:INVALID_PHONE"]);
  });

  it("text: one line, plain, at most max", () => {
    const f = { kind: "text", key: "author", max: 60 } as const;
    expect(check(f, " Nour\nA. ").value).toBe("Nour A.");
    expect(codes(check(f, "x".repeat(61)).issues)).toEqual(["s.author:TOO_LONG"]);
  });

  it("items: count bounds, strict item keys, nested paths", () => {
    const f = {
      kind: "items",
      key: "items",
      min: 1,
      max: 8,
      fields: [{ kind: "localizedText", key: "quote", max: 400 }],
    } as const;
    expect(codes(check(f, []).issues)).toEqual(["s.items:TOO_FEW_ITEMS"]);
    expect(
      codes(
        check(
          f,
          Array.from({ length: 9 }, () => ({ quote: {} })),
        ).issues,
      ),
    ).toEqual(["s.items:TOO_MANY_ITEMS"]);
    expect(codes(check(f, [{ quote: {}, extra: 1 }]).issues)).toEqual([
      "s.items.0.extra:UNKNOWN_KEY",
    ]);
    expect(codes(check(f, [{ quote: {} }, { quote: { ar: "x".repeat(401) } }]).issues)).toEqual([
      "s.items.1.quote.ar:TOO_LONG",
    ]);
  });

  it("the settings object itself: missing and unknown keys; never more than MAX_ISSUES", () => {
    const fields = [{ kind: "boolean", key: "a" }] as const;
    const issues: ContentIssue[] = [];
    expect(validateFields(fields, { b: 1 }, "s", issues)).toBeNull();
    expect(codes(issues)).toEqual(["s.b:UNKNOWN_KEY", "s.a:MISSING"]);
    const flood: ContentIssue[] = [];
    validateFields(
      fields,
      Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, 1])),
      "s",
      flood,
    );
    expect(flood.length).toBeLessThanOrEqual(50);
  });

  it("one issue budget for the whole call, nested items included (F14)", () => {
    const fields = [
      {
        kind: "items",
        key: "items",
        min: 0,
        max: 8,
        fields: [{ kind: "boolean", key: "a" }],
      },
    ] as const;
    const flood: ContentIssue[] = [];
    const items = Array.from({ length: 8 }, () =>
      Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, 1])),
    );
    expect(validateFields(fields, { items }, "s", flood)).toBeNull();
    expect(flood.length).toBe(50);
  });

  it("fails closed: a spent issue budget never turns a bad value into a valid one", () => {
    const fields = [{ kind: "boolean", key: "a" }] as const;
    for (const prior of [50, 60]) {
      const issues: ContentIssue[] = Array.from({ length: prior }, (_, i) => ({
        path: `p${i}`,
        code: "X",
      }));
      expect(validateFields(fields, { a: "notbool" }, "s", issues)).toBeNull();
      expect(issues.length).toBe(prior); // never shortened, never grown past the budget
      expect(validateFields(fields, { a: true }, "s", issues)).toEqual({ a: true });
    }
    const items = [
      { kind: "items", key: "items", min: 0, max: 2, fields: [{ kind: "boolean", key: "a" }] },
    ] as const;
    const full: ContentIssue[] = Array.from({ length: 50 }, () => ({ path: "p", code: "X" }));
    expect(validateFields(items, { items: [{ a: "no" }] }, "s", full)).toBeNull();
  });

  it("the budget caps what is reported when several fields each push many issues", () => {
    const fields = ["x", "y", "z"].map((key) => ({ kind: "localizedText", key, max: 5 }) as const);
    const unknown = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, "v"]));
    const flood: ContentIssue[] = [];
    expect(validateFields(fields, { x: unknown, y: unknown, z: unknown }, "s", flood)).toBeNull();
    expect(flood.length).toBe(50);
  });

  it("a descriptor keyed like an Object.prototype member is MISSING, not inherited", () => {
    const fields = [{ kind: "boolean", key: "constructor" }] as const;
    const issues: ContentIssue[] = [];
    expect(validateFields(fields, {}, "s", issues)).toBeNull();
    expect(codes(issues)).toEqual(["s.constructor:MISSING"]);
    expect(readFields(fields, {}, {})).toEqual({ constructor: false });
  });

  it("a non-object is refused, and an own __proto__ key is an unknown key", () => {
    const fields = [{ kind: "boolean", key: "a" }] as const;
    for (const bad of [null, "x", [], 3]) {
      const issues: ContentIssue[] = [];
      expect(validateFields(fields, bad, "s", issues)).toBeNull();
      expect(codes(issues)).toEqual(["s:INVALID_VALUE"]);
    }
    const issues: ContentIssue[] = [];
    const hostile = JSON.parse('{"a":true,"__proto__":1}') as unknown;
    expect(validateFields(fields, hostile, "s", issues)).toBeNull();
    expect(codes(issues)).toEqual(["s.__proto__:UNKNOWN_KEY"]);
  });
});

describe("readFields — the lenient read path", () => {
  it("an invalid value falls back; an unknown key is dropped; items are cut to max", () => {
    const fields = [
      { kind: "number", key: "columns", min: 2, max: 4, step: 1 },
      {
        kind: "items",
        key: "items",
        min: 1,
        max: 2,
        fields: [{ kind: "text", key: "author", max: 60 }],
      },
    ] as const;
    const read = readFields(
      fields,
      { columns: 9, extra: "x", items: [{ author: 5 }, { author: "B" }, { author: "C" }] },
      { columns: 4, items: [] },
    );
    expect(read).toEqual({ columns: 4, items: [{ author: "" }, { author: "B" }] });
  });

  it("a non-object reads as the fallback; an over-long text falls back; lists are not padded", () => {
    const fields = [
      { kind: "text", key: "author", max: 3 },
      { kind: "items", key: "items", min: 2, max: 4, fields: [{ kind: "boolean", key: "on" }] },
    ] as const;
    expect(readFields(fields, "nope", { author: "z", items: [] })).toEqual({
      author: "z",
      items: [],
    });
    expect(
      readFields(fields, { author: "toolong", items: [{ on: true }] }, { author: "z", items: [] }),
    ).toEqual({ author: "z", items: [{ on: true }] });
  });

  it("emptyFieldValue is {} / null / [] / min / options[0] / false / ''", () => {
    expect(emptyFieldValue({ kind: "localizedText", key: "k", max: 5 })).toEqual({});
    expect(emptyFieldValue({ kind: "richText", key: "k", max: 5 })).toEqual({});
    expect(emptyFieldValue({ kind: "image", key: "k", purpose: "section_image" })).toBeNull();
    expect(emptyFieldValue({ kind: "link", key: "k" })).toBeNull();
    expect(emptyFieldValue({ kind: "collection", key: "k" })).toBeNull();
    expect(emptyFieldValue({ kind: "products", key: "k", max: 3 })).toEqual([]);
    expect(emptyFieldValue({ kind: "number", key: "k", min: 2, max: 4, step: 1 })).toBe(2);
    expect(emptyFieldValue({ kind: "select", key: "k", options: ["a", "b"] })).toBe("a");
    expect(emptyFieldValue({ kind: "boolean", key: "k" })).toBe(false);
    expect(emptyFieldValue({ kind: "phone", key: "k" })).toBe("");
    expect(emptyFieldValue({ kind: "text", key: "k", max: 3 })).toBe("");
    expect(emptyFieldValue({ kind: "items", key: "k", min: 1, max: 2, fields: [] })).toEqual([]);
  });

  it("a rich-text value with an unsafe link falls back", () => {
    const fields = [{ kind: "richText", key: "body", max: 100 }] as const;
    expect(readFields(fields, { body: { en: "[x](javascript:alert(1))" } }, { body: {} })).toEqual({
      body: {},
    });
  });
});

describe("collectFieldRefs", () => {
  it("lists images, collections, products and page links with their paths", () => {
    const fields = [
      { kind: "image", key: "image", purpose: "section_image" },
      { kind: "collection", key: "collection" },
      { kind: "products", key: "products", max: 12 },
      { kind: "link", key: "buttonLink" },
      {
        kind: "items",
        key: "items",
        min: 0,
        max: 8,
        fields: [{ kind: "image", key: "image", purpose: "section_image" }],
      },
    ] as const;
    const out = emptySectionRefs();
    collectFieldRefs(
      fields,
      {
        image: "m1",
        collection: "c1",
        products: ["p1", "p2"],
        buttonLink: { type: "page", id: "pg1" },
        items: [{ image: null }, { image: "m2" }],
      },
      "s",
      out,
    );
    expect(out).toEqual({
      image: [
        { path: "s.image", id: "m1" },
        { path: "s.items.1.image", id: "m2" },
      ],
      collection: [{ path: "s.collection", id: "c1" }],
      product: [
        { path: "s.products.0", id: "p1" },
        { path: "s.products.1", id: "p2" },
      ],
      page: [{ path: "s.buttonLink.id", id: "pg1" }],
    });
  });

  it("collection and product links count as those kinds; home and url name nothing", () => {
    const fields = [{ kind: "link", key: "l" }] as const;
    const out = emptySectionRefs();
    collectFieldRefs(fields, { l: { type: "collection", id: "c9" } }, "s", out);
    collectFieldRefs(fields, { l: { type: "product", id: "p9" } }, "s", out);
    collectFieldRefs(fields, { l: { type: "url", url: "https://x.example" } }, "s", out);
    collectFieldRefs(fields, { l: { type: "home" } }, "s", out);
    expect(out.collection).toEqual([{ path: "s.l.id", id: "c9" }]);
    expect(out.product).toEqual([{ path: "s.l.id", id: "p9" }]);
    expect(out.image).toEqual([]);
    expect(out.page).toEqual([]);
  });
});
