import { describe, expect, expectTypeOf, it } from "vitest";
import type { ContentIssue } from "./locale";
import { ITEM_ID_PATTERN, SECTION_LIMITS } from "./limits";
import type { CompletePublicSection, PublicAnnouncement, PublicSection } from "./public-sections";
import {
  DEFAULT_HOMEPAGE_SECTIONS,
  HOMEPAGE_SECTIONS_MAX,
  newSection,
  readSection,
  SECTION_DEFINITIONS,
  SECTION_ID_PATTERN,
  SECTION_TYPES,
  sectionDefinition,
  sectionHeading,
  sectionRefsOf,
  validateSection,
} from "./sections";

const ID = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const placementOf = (type: string) => (type === "announcement_bar" ? "header" : "homepage");
const run = (raw: unknown, placement: "header" | "homepage" = "homepage") => {
  const issues: ContentIssue[] = [];
  return { section: validateSection(raw, "x", issues, placement), issues };
};

describe("section library v1 (spec 3.2)", () => {
  it("has the ten types, in library order, each defined once", () => {
    expect(SECTION_DEFINITIONS.map((d) => d.type)).toEqual([...SECTION_TYPES]);
    expect(HOMEPAGE_SECTIONS_MAX).toBe(25);
  });

  it.each(SECTION_TYPES)("%s: its defaults pass its own validator unchanged", (type) => {
    const section = newSection(type, ID);
    const { section: back, issues } = run(section, placementOf(type));
    expect(issues).toEqual([]);
    expect(back).toEqual(section);
  });

  it.each(SECTION_TYPES)(
    "%s: the descriptor keys are exactly the default settings' keys",
    (type) => {
      const def = sectionDefinition(type)!;
      expect(def.fields.map((f) => f.key).sort()).toEqual(Object.keys(def.defaults()).sort());
    },
  );

  it("placement and per-page limits (spec table)", () => {
    const limits = Object.fromEntries(
      SECTION_DEFINITIONS.map((d) => [d.type, [d.placement, d.maxPerPage]]),
    );
    expect(limits).toEqual({
      announcement_bar: ["header", 1],
      hero: ["homepage", 3],
      featured_collection: ["homepage", null],
      featured_products: ["homepage", null],
      collection_list: ["homepage", null],
      image_with_text: ["homepage", null],
      rich_text: ["homepage", null],
      testimonials: ["homepage", null],
      features: ["homepage", null],
      whatsapp_cta: ["homepage", 2],
    });
  });

  it("the labels are the spec's (admin ar is Egyptian)", () => {
    expect(sectionDefinition("hero")!.labels).toEqual({ en: "Image banner", ar: "بانر بصورة" });
    expect(sectionDefinition("whatsapp_cta")!.labels).toEqual({
      en: "WhatsApp button",
      ar: "زرار واتساب",
    });
  });

  it("a section in the wrong place is SECTION_NOT_ALLOWED_HERE", () => {
    expect(run(newSection("announcement_bar", ID)).issues).toEqual([
      { path: "x.type", code: "SECTION_NOT_ALLOWED_HERE" },
    ]);
    expect(run(newSection("hero", ID), "header").issues).toEqual([
      { path: "x.type", code: "SECTION_NOT_ALLOWED_HERE" },
    ]);
  });

  it("a known type is strict: an unknown setting is UNKNOWN_KEY at its path", () => {
    const hero = newSection("hero", ID);
    expect(run({ ...hero, settings: { ...hero.settings, video: "x" } }).issues).toEqual([
      { path: "x.settings.video", code: "UNKNOWN_KEY" },
    ]);
  });

  it("an unknown type is kept verbatim, but its envelope is still checked (Ruling 7)", () => {
    const future = {
      id: ID,
      type: "countdown_timer",
      hidden: false,
      settings: { endsAt: "2027-01-01", nested: { a: [1] } },
    };
    expect(run(future).section).toEqual(future);
    expect(readSection(future, "homepage")).toEqual(future);
    expect(run({ ...future, id: "nope" }).issues).toEqual([
      { path: "x.id", code: "INVALID_VALUE" },
    ]);
    expect(run({ ...future, type: "Bad Type" }).issues).toEqual([
      { path: "x.type", code: "INVALID_VALUE" },
    ]);
    expect(run({ ...future, settings: [] }).issues).toEqual([
      { path: "x.settings", code: "INVALID_VALUE" },
    ]);
    expect(run({ ...future, hidden: "no" }).issues).toEqual([
      { path: "x.hidden", code: "INVALID_VALUE" },
    ]);
    expect(readSection(future, "header")).toBeNull(); // the header slot takes the announcement bar only
  });

  it("readSection is lenient: a bad field becomes the default, an unknown setting is dropped", () => {
    const hero = newSection("hero", ID);
    const read = readSection(
      { ...hero, settings: { ...hero.settings, overlay: 85, video: "x" } },
      "homepage",
    );
    expect(read).toEqual(hero); // default overlay 30, no `video`
  });

  it("DEFAULT_HOMEPAGE_SECTIONS: newest 8 products, then every collection (spec 3.2, Ruling 3)", () => {
    expect(DEFAULT_HOMEPAGE_SECTIONS).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000101",
        type: "featured_products",
        hidden: false,
        settings: {
          source: "newest",
          products: [],
          count: 8,
          heading: { ar: "المنتجات", en: "Products" },
          columns: 2,
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        type: "collection_list",
        hidden: false,
        settings: {
          source: "all",
          items: [],
          heading: { ar: "المجموعات", en: "Collections" },
          columns: 2,
        },
      },
    ]);
    expect(Object.isFrozen(DEFAULT_HOMEPAGE_SECTIONS[0]!.settings)).toBe(true);
  });

  it("sectionRefsOf lists known sections' refs with paths, hidden ones too, unsupported never", () => {
    const hero = {
      ...newSection("hero", ID),
      hidden: true,
      settings: {
        ...newSection("hero", ID).settings,
        image: "m1",
        buttonLink: { type: "product", id: "p1" },
      },
    };
    const future = {
      id: ID.replace("6f", "7f"),
      type: "x_future",
      hidden: false,
      settings: { image: "m9" },
    };
    expect(sectionRefsOf([hero, future], "homepage.sections")).toEqual({
      image: [{ path: "homepage.sections.0.settings.image", id: "m1" }],
      collection: [],
      product: [{ path: "homepage.sections.0.settings.buttonLink.id", id: "p1" }],
      page: [],
    });
  });

  it("sectionHeading: the heading in the locale, else the other, else null; the bar uses its text", () => {
    const rich = newSection("rich_text", ID);
    expect(
      sectionHeading({ ...rich, settings: { ...rich.settings, heading: { en: "About" } } }, "ar"),
    ).toBe("About");
    expect(
      sectionHeading({ ...rich, settings: { ...rich.settings, heading: {} } }, "ar"),
    ).toBeNull();
    expect(sectionHeading(newSection("announcement_bar", ID), "en")).toBe(
      "Free shipping on orders over EGP 500",
    );
  });

  it.each(SECTION_TYPES)(
    "%s: descriptor keys are the default keys in the same order (F11)",
    (type) => {
      const def = sectionDefinition(type)!;
      expect(Object.keys(def.defaults())).toEqual(def.fields.map((f) => f.key));
    },
  );

  it("canonical form is stable: read, defaults and the literal serialise identically (F11)", () => {
    for (const type of SECTION_TYPES) {
      const section = newSection(type, ID);
      expect(JSON.stringify(readSection(section, placementOf(type)))).toBe(JSON.stringify(section));
      const scrambled = {
        settings: Object.fromEntries(Object.entries(section.settings).reverse()),
        hidden: false,
        type,
        id: ID,
      };
      expect(JSON.stringify(readSection(scrambled, placementOf(type)))).toBe(
        JSON.stringify(section),
      );
    }
    for (const section of DEFAULT_HOMEPAGE_SECTIONS) {
      expect(JSON.stringify(readSection(section, "homepage"))).toBe(JSON.stringify(section));
    }
  });

  it("item objects keep descriptor order through read (F11)", () => {
    const features = newSection("features", ID);
    const read = readSection(
      {
        ...features,
        settings: {
          ...features.settings,
          items: [{ text: { en: "t" }, title: { en: "a" }, icon: "gift" }],
        },
      },
      "homepage",
    ) as typeof features;
    expect(Object.keys(read.settings.items[0]!)).toEqual(["icon", "title", "text"]);
  });

  it("a stored phone is normalised to digits and a bad one is INVALID_PHONE", () => {
    const cta = newSection("whatsapp_cta", ID);
    const ok = run({ ...cta, settings: { ...cta.settings, phone: "010 1234 5678" } })
      .section as typeof cta;
    expect(ok.settings.phone).toBe("201012345678");
    expect(run({ ...cta, settings: { ...cta.settings, phone: "12" } }).issues).toEqual([
      { path: "x.settings.phone", code: "INVALID_PHONE" },
    ]);
  });

  it("an inherited key is never a type", () => {
    expect(sectionDefinition("constructor")).toBeNull();
    expect(sectionDefinition("__proto__")).toBeNull();
    const kept = run({ id: ID, type: "constructor", hidden: false, settings: {} });
    expect(kept.issues).toEqual([]);
    expect(kept.section).not.toBeNull();
  });

  it("the envelope is strict on write: unknown and missing keys", () => {
    expect(run({ id: ID, type: "x_future", hidden: false, settings: {}, extra: 1 }).issues).toEqual(
      [{ path: "x.extra", code: "UNKNOWN_KEY" }],
    );
    expect(run({ id: ID, type: "x_future", settings: {} }).issues).toEqual([
      { path: "x.hidden", code: "MISSING" },
    ]);
  });

  it("readSection returns null for what it cannot read", () => {
    expect(readSection(null, "homepage")).toBeNull();
    expect(
      readSection({ id: "nope", type: "hero", hidden: false, settings: {} }, "homepage"),
    ).toBeNull();
    expect(readSection({ ...newSection("hero", ID), hidden: 1 }, "homepage")).toBeNull();
    expect(readSection(newSection("hero", ID), "header")).toBeNull();
  });

  it("an over-long manual products list falls back as a whole on read", () => {
    const fp = newSection("featured_products", ID);
    const ids = Array.from({ length: 13 }, (_, i) => `p${i}`);
    const read = readSection(
      { ...fp, settings: { ...fp.settings, source: "manual", products: ids } },
      "homepage",
    ) as typeof fp;
    expect(read.settings.source).toBe("manual");
    expect(read.settings.products).toEqual([]);
  });

  it("PublicSection admits the preview-only incomplete variant (F2)", () => {
    const placeholder: PublicSection = { id: ID, type: "hero", hidden: true, incomplete: true };
    expect(placeholder.incomplete).toBe(true);
  });

  it("readSection of a known type with missing or non-object settings is null (I-1)", () => {
    for (const type of ["hero", "collection_list", "rich_text"] as const) {
      const base = { id: ID, type, hidden: false };
      expect(readSection({ ...base, settings: "junk" }, "homepage")).toBeNull();
      expect(readSection({ ...base, settings: null }, "homepage")).toBeNull();
      expect(readSection({ ...base, settings: [] }, "homepage")).toBeNull();
      expect(readSection(base, "homepage")).toBeNull();
    }
    expect(
      readSection({ id: ID, type: "announcement_bar", hidden: false, settings: "junk" }, "header"),
    ).toBeNull();
  });

  it("an unknown type is kept exactly on read, extra envelope keys and order included (M-4, M-5)", () => {
    const future = {
      id: ID,
      type: "countdown_timer",
      hidden: false,
      settings: { endsAt: "2027-01-01", nested: { a: [1] } },
      locked: true,
    };
    expect(JSON.stringify(readSection(future, "homepage"))).toBe(JSON.stringify(future));
    const plain = { id: ID, type: "countdown_timer", hidden: false, settings: { b: 1, a: 2 } };
    expect(JSON.stringify(run(plain).section)).toBe(JSON.stringify(plain));
    expect(JSON.stringify(readSection(plain, "homepage"))).toBe(JSON.stringify(plain));
  });

  it("every section limit is pinned (M-2)", () => {
    expect(SECTION_LIMITS).toEqual({
      heading: 80,
      announcementText: 120,
      heroSubheading: 200,
      buttonLabel: 30,
      imageWithTextBody: 2000,
      quote: 400,
      author: 60,
      featureTitle: 40,
      featureText: 140,
      ctaText: 300,
      ctaMessage: 300,
      products: 12,
      collectionItems: 8,
      testimonials: { min: 1, max: 8 },
      features: { min: 1, max: 6 },
      count: { min: 2, max: 12 },
      columns: { min: 2, max: 4 },
      overlay: { min: 0, max: 80, step: 10 },
      rating: { min: 0, max: 5 },
      heroPerPage: 3,
      whatsAppPerPage: 2,
    });
  });

  it("the limits bite at their boundaries through the validators (M-2)", () => {
    const hero = newSection("hero", ID);
    const withHero = (patch: Record<string, unknown>) =>
      run({ ...hero, settings: { ...hero.settings, ...patch } }).issues;
    expect(withHero({ heading: { en: "a".repeat(80) } })).toEqual([]);
    expect(withHero({ heading: { en: "a".repeat(81) } })).toEqual([
      { path: "x.settings.heading.en", code: "TOO_LONG" },
    ]);
    expect(withHero({ overlay: 80 })).toEqual([]);
    expect(withHero({ overlay: 90 })).toEqual([
      { path: "x.settings.overlay", code: "OUT_OF_RANGE" },
    ]);
    const t = newSection("testimonials", ID);
    const item = (quote: string) => ({ quote: { en: quote }, author: "", rating: 5 });
    const withT = (quote: string) =>
      run({ ...t, settings: { ...t.settings, items: [item(quote)] } }).issues;
    expect(withT("a".repeat(400))).toEqual([]);
    expect(withT("a".repeat(401))).toEqual([
      { path: "x.settings.items.0.quote.en", code: "TOO_LONG" },
    ]);
  });

  it("all ten admin labels are pinned (M-2)", () => {
    expect(Object.fromEntries(SECTION_DEFINITIONS.map((d) => [d.type, d.labels]))).toEqual({
      announcement_bar: { en: "Announcement bar", ar: "شريط إعلانات" },
      hero: { en: "Image banner", ar: "بانر بصورة" },
      featured_collection: { en: "Featured collection", ar: "مجموعة مميزة" },
      featured_products: { en: "Products", ar: "منتجات" },
      collection_list: { en: "Collection list", ar: "قائمة المجموعات" },
      image_with_text: { en: "Image with text", ar: "صورة مع نص" },
      rich_text: { en: "Rich text", ar: "نص" },
      testimonials: { en: "Testimonials", ar: "آراء العملاء" },
      features: { en: "Store highlights", ar: "مميزات المتجر" },
      whatsapp_cta: { en: "WhatsApp button", ar: "زرار واتساب" },
    });
  });

  it("the section id rule is the menu item id rule", () => {
    expect(SECTION_ID_PATTERN).toBe(ITEM_ID_PATTERN);
  });

  it("PublicSection narrows by type to settings on complete sections (I-2)", () => {
    const overlay = (s: PublicSection): number | null => {
      switch (s.type) {
        case "hero":
          if (s.incomplete) {
            expectTypeOf(s.settings).toEqualTypeOf<undefined>();
            return null;
          }
          return s.settings.overlay;
        default:
          return null;
      }
    };
    expect(overlay({ id: ID, type: "hero", incomplete: true })).toBeNull();
    expectTypeOf<PublicAnnouncement>().toEqualTypeOf<
      Extract<CompletePublicSection, { type: "announcement_bar" }>
    >();
    expectTypeOf<PublicAnnouncement["incomplete"]>().toEqualTypeOf<undefined>();
  });
});
