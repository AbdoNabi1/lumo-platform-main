import { describe, expect, it } from "vitest";
import { DEFAULT_HOMEPAGE_SECTIONS, newSection } from "./sections";
import {
  canonicalDocumentJson,
  DEFAULT_THEME_DOCUMENT,
  documentRefsOf,
  imageRefsOf,
  menuHandlesOf,
  MAX_DOCUMENT_BYTES,
  readBrandStyle,
  readThemeDocument,
  validateThemeDocument,
  type ThemeDocument,
} from "./theme-document";

type Doc = ReturnType<typeof JSON.parse>;
const clone = () => JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
const issuesOf = (raw: unknown) => {
  const outcome = validateThemeDocument(raw);
  return outcome.ok ? [] : outcome.issues;
};

describe("DEFAULT_THEME_DOCUMENT", () => {
  it("is the design system's light palette, Plex for both fonts, medium, rounded, no logo", () => {
    expect(DEFAULT_THEME_DOCUMENT.brand.colors).toEqual({
      background: "#f8fafc",
      foreground: "#0f172a",
      primary: "#635bff",
      primaryForeground: "#ffffff",
      accent: "#f1f5f9",
      accentForeground: "#0f172a",
    });
    expect(DEFAULT_THEME_DOCUMENT.brand.typography).toEqual({
      headingFont: "ibm-plex-sans-arabic",
      bodyFont: "ibm-plex-sans-arabic",
      baseSize: "medium",
    });
    expect(DEFAULT_THEME_DOCUMENT.brand.corners).toBe("rounded");
    expect(DEFAULT_THEME_DOCUMENT.brand.logo).toEqual({ imageRef: null, widthPx: 140 });
    expect(DEFAULT_THEME_DOCUMENT.brand.social).toEqual({});
    expect(DEFAULT_THEME_DOCUMENT.schemaVersion).toBe(2);
    expect(DEFAULT_THEME_DOCUMENT.header.announcement).toBeNull();
    expect(DEFAULT_THEME_DOCUMENT.homepage.sections).toBe(DEFAULT_HOMEPAGE_SECTIONS);
  });

  it("passes its own validator", () => {
    expect(validateThemeDocument(DEFAULT_THEME_DOCUMENT)).toEqual({
      ok: true,
      value: DEFAULT_THEME_DOCUMENT,
    });
  });
});

describe("validateThemeDocument", () => {
  it("normalises upper-case hex to lower case", () => {
    const raw = clone();
    raw.brand.colors.primary = "#AA00FF";
    const outcome = validateThemeDocument(raw);
    expect(outcome.ok && outcome.value.brand.colors.primary).toBe("#aa00ff");
  });

  it.each(["red", "#fff", "#ffffff80", "rgb(1,2,3)", "#000000;}</style><script>", "＃ffffff", ""])(
    "rejects the colour %j with INVALID_COLOR on that field",
    (value) => {
      const raw = clone();
      raw.brand.colors.accent = value;
      expect(issuesOf(raw)).toEqual([{ path: "brand.colors.accent", code: "INVALID_COLOR" }]);
    },
  );

  it("rejects unknown keys at every level", () => {
    const raw = clone();
    raw.extra = 1;
    raw.brand.logo.alt = "x";
    raw.brand.social.myspace = "https://myspace.com/x";
    expect(issuesOf(raw)).toEqual([
      { path: "extra", code: "UNKNOWN_KEY" },
      { path: "brand.logo.alt", code: "UNKNOWN_KEY" },
      { path: "brand.social.myspace", code: "UNKNOWN_KEY" },
    ]);
  });

  it("rejects missing keys and wrong types", () => {
    const raw = clone();
    delete raw.brand.colors.primary;
    raw.header.sticky = "yes";
    expect(issuesOf(raw)).toEqual([
      { path: "brand.colors.primary", code: "MISSING" },
      { path: "header.sticky", code: "INVALID_VALUE" },
    ]);
  });

  it("bounds the logo width, the fonts, the size and the corners to their enums", () => {
    const raw = clone();
    raw.brand.logo.widthPx = 59;
    raw.brand.typography.headingFont = "Comic Sans";
    raw.brand.typography.baseSize = "huge";
    raw.brand.corners = "round";
    expect(issuesOf(raw)).toEqual([
      { path: "brand.logo.widthPx", code: "OUT_OF_RANGE" },
      { path: "brand.typography.headingFont", code: "INVALID_VALUE" },
      { path: "brand.typography.baseSize", code: "INVALID_VALUE" },
      { path: "brand.corners", code: "INVALID_VALUE" },
    ]);
    raw.brand.logo.widthPx = 320.5;
    expect(issuesOf(raw)[0]).toEqual({ path: "brand.logo.widthPx", code: "OUT_OF_RANGE" });
  });

  it.each([
    ["http://facebook.com/shop", "INVALID_URL"],
    ["https://user:pass@evil.example/x", "INVALID_URL"],
    ["javascript:alert(1)", "INVALID_URL"],
    ["not a url", "INVALID_URL"],
    [`https://x.example/${"a".repeat(500)}`, "TOO_LONG"],
  ])("refuses the social link %s (%s)", (url, code) => {
    const raw = clone();
    raw.brand.social.instagram = url;
    expect(issuesOf(raw)).toEqual([{ path: "brand.social.instagram", code }]);
  });

  it("accepts any https host for social links (shorteners included)", () => {
    const raw = clone();
    raw.brand.social.tiktok = "https://vm.tiktok.com/ZM123/";
    expect(validateThemeDocument(raw).ok).toBe(true);
  });

  it("checks image refs are id-shaped, never paths or urls", () => {
    const raw = clone();
    raw.brand.logo.imageRef = "../tenants/x/brand-assets/a.png";
    raw.brand.favicon.imageRef = "0192f0aa-0000-7000-8000-000000000001";
    expect(issuesOf(raw)).toEqual([{ path: "brand.logo.imageRef", code: "INVALID_VALUE" }]);
  });

  it("caps the footer note at 200 per locale and keeps line breaks", () => {
    const raw = clone();
    raw.footer.note = { ar: "سطر\nسطر", en: "x".repeat(201) };
    expect(issuesOf(raw)).toEqual([{ path: "footer.note.en", code: "TOO_LONG" }]);
  });

  it("refuses an unknown schema version", () => {
    const raw = clone();
    raw.schemaVersion = 3;
    expect(issuesOf(raw)).toEqual([{ path: "schemaVersion", code: "UNSUPPORTED_SCHEMA_VERSION" }]);
  });

  it("refuses a document over 256 KB before reading it", () => {
    const raw = clone();
    raw.padding = "x".repeat(MAX_DOCUMENT_BYTES);
    expect(issuesOf(raw)).toEqual([{ path: "", code: "DOCUMENT_TOO_LARGE" }]);
  });

  it("refuses a non-object", () => {
    expect(issuesOf(null)).toEqual([{ path: "", code: "INVALID_VALUE" }]);
    expect(issuesOf([])).toEqual([{ path: "", code: "INVALID_VALUE" }]);
  });
});

describe("readThemeDocument (tolerant reader)", () => {
  it("falls back per section: a corrupt brand becomes the default brand, the rest survives", () => {
    const raw = clone();
    raw.brand.colors.primary = "#000000;}</style><script>";
    raw.header.sticky = true;
    const doc: ThemeDocument = readThemeDocument(raw);
    expect(doc.brand).toEqual(DEFAULT_THEME_DOCUMENT.brand);
    expect(doc.header.sticky).toBe(true);
  });

  it("never throws on garbage and keeps an unknown homepage array as it is", () => {
    expect(readThemeDocument("garbage")).toEqual(DEFAULT_THEME_DOCUMENT);
    const raw = clone();
    const future = {
      id: "6f1b2c3d-4e5f-4a6b-8c7d-000000000009",
      type: "from_a_newer_build",
      hidden: false,
      settings: {},
    };
    raw.homepage.sections = [future];
    raw.schemaVersion = 2;
    expect(readThemeDocument(raw).homepage.sections).toEqual([future]);
  });

  it("readBrandStyle falls back field group by field group", () => {
    const style = readBrandStyle({
      colors: { ...DEFAULT_THEME_DOCUMENT.brand.colors, primary: "red" },
      typography: { headingFont: "cairo", bodyFont: "tajawal", baseSize: "large" },
      corners: "pill",
    });
    expect(style.colors).toEqual(DEFAULT_THEME_DOCUMENT.brand.colors);
    expect(style.typography).toEqual({
      headingFont: "cairo",
      bodyFont: "tajawal",
      baseSize: "large",
    });
    expect(style.corners).toBe("pill");
  });
});

describe("helpers", () => {
  it("imageRefsOf lists the logo and favicon refs that are set", () => {
    const raw = clone();
    raw.brand.logo.imageRef = "img-1";
    expect(imageRefsOf(readThemeDocument(raw))).toEqual(["img-1"]);
  });

  it("canonicalDocumentJson ignores key order (JSONB reorders keys)", () => {
    const reordered = { homepage: { sections: [] }, ...clone() };
    expect(canonicalDocumentJson(reordered)).toBe(canonicalDocumentJson(DEFAULT_THEME_DOCUMENT));
  });
});

describe("Part 2 menu fields (Ruling 2, Review Focus 3)", () => {
  const partOne = () => {
    const doc = JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
    doc.header = { sticky: true };
    doc.footer = { note: { ar: "أهلاً" }, showSocial: false };
    return doc;
  };

  it("a Part 1 document reads, validates and canonicalises as before", () => {
    const read = readThemeDocument(partOne());
    expect(read.header).toEqual({ sticky: true, menuHandle: "main-menu", announcement: null });
    expect(read.footer).toEqual({
      note: { ar: "أهلاً" },
      showSocial: false,
      menuHandle: "footer",
      showPolicyLinks: true,
    });
    const valid = validateThemeDocument(partOne());
    expect(valid.ok && valid.value.header.menuHandle).toBe("main-menu");
    const explicit = { ...partOne(), header: read.header, footer: read.footer };
    expect(canonicalDocumentJson(partOne())).toBe(canonicalDocumentJson(explicit));
  });

  it("emits the new fields in one fixed order, whatever order the input had", () => {
    const a = partOne();
    a.header = { menuHandle: "x", sticky: false };
    a.footer = { showPolicyLinks: false, menuHandle: "y", showSocial: true, note: {} };
    const json = canonicalDocumentJson(a);
    expect(json).toContain('"header":{"sticky":false,"menuHandle":"x","announcement":null}');
    expect(json).toContain(
      '"footer":{"note":{},"showSocial":true,"menuHandle":"y","showPolicyLinks":false}',
    );
  });

  it("the defaults are main-menu, footer and policy links on", () => {
    expect(DEFAULT_THEME_DOCUMENT.header.menuHandle).toBe("main-menu");
    expect(DEFAULT_THEME_DOCUMENT.footer.menuHandle).toBe("footer");
    expect(DEFAULT_THEME_DOCUMENT.footer.showPolicyLinks).toBe(true);
  });

  it("a malformed handle or a non-boolean flag is refused on write and defaulted on read", () => {
    const doc = partOne();
    doc.header.menuHandle = "Main Menu";
    doc.footer.showPolicyLinks = "yes";
    const out = validateThemeDocument(doc);
    expect(out.ok ? [] : out.issues).toEqual(
      expect.arrayContaining([
        { path: "header.menuHandle", code: "INVALID_VALUE" },
        { path: "footer.showPolicyLinks", code: "INVALID_VALUE" },
      ]),
    );
    expect(readThemeDocument(doc).header.menuHandle).toBe("main-menu");
  });

  it("menuHandlesOf lists each handle once, header first", () => {
    expect(menuHandlesOf(DEFAULT_THEME_DOCUMENT)).toEqual(["main-menu", "footer"]);
    const same = readThemeDocument({
      ...partOne(),
      footer: { ...partOne().footer, menuHandle: "main-menu" },
    });
    expect(menuHandlesOf(same)).toEqual(["main-menu"]);
  });
});

describe("a bad menu reference on read resets only that field (fix round 1)", () => {
  it("keeps the rest of the footer and header", () => {
    const doc = readThemeDocument({
      ...JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT)),
      header: { sticky: true, menuHandle: "Bad Handle" },
      footer: {
        note: { en: "hi" },
        showSocial: false,
        menuHandle: "BAD",
        showPolicyLinks: "yes",
      },
    });
    expect(doc.header).toEqual({ sticky: true, menuHandle: "main-menu", announcement: null });
    expect(doc.footer).toEqual({
      note: { en: "hi" },
      showSocial: false,
      menuHandle: "footer",
      showPolicyLinks: true,
    });
  });
  it("still refuses them on write", () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
    raw.footer.menuHandle = "BAD";
    expect(validateThemeDocument(raw).ok).toBe(false);
  });
});

// ---- schema version 2 (Part 3, Ruling 2) ----

const PART1_FIXTURE = {
  schemaVersion: 1,
  brand: structuredClone(DEFAULT_THEME_DOCUMENT.brand),
  header: { sticky: false },
  footer: { note: {}, showSocial: true },
  homepage: { sections: [] },
};
const v1Doc = () => structuredClone(PART1_FIXTURE) as Doc;
const id = (n: number) => `6f1b2c3d-4e5f-4a6b-8c7d-${String(n).padStart(12, "0")}`;
const v2 = (sections: unknown[], announcement: unknown = null) => ({
  ...structuredClone(DEFAULT_THEME_DOCUMENT),
  header: { ...DEFAULT_THEME_DOCUMENT.header, announcement },
  homepage: { sections },
});

describe("schema version 2 (Ruling 2)", () => {
  it("a version-1 document reads as the default homepage and canonicalises like it (Review Focus 1)", () => {
    const read = readThemeDocument(v1Doc());
    expect(read.schemaVersion).toBe(2);
    expect(read.homepage.sections).toEqual(DEFAULT_HOMEPAGE_SECTIONS);
    expect(read.header.announcement).toBeNull();
    expect(canonicalDocumentJson(v1Doc())).toBe(canonicalDocumentJson(DEFAULT_THEME_DOCUMENT));
  });

  it("canonical JSON of a v1 document equals that of the same document upcast and re-read, key order included", () => {
    const upcast = readThemeDocument(v1Doc());
    // an upcast document is stored as JSON, then read again
    const stored = JSON.parse(JSON.stringify(upcast));
    expect(canonicalDocumentJson(stored)).toBe(canonicalDocumentJson(v1Doc()));
    // v1 goes through readSection, so the key order is the descriptor order, not defaults()
    const v1Json = JSON.stringify(readThemeDocument(v1Doc()).homepage.sections);
    const v2Json = JSON.stringify(
      readThemeDocument(v2([...DEFAULT_HOMEPAGE_SECTIONS])).homepage.sections,
    );
    expect(v1Json).toBe(v2Json);
    const reversed = JSON.parse(JSON.stringify(DEFAULT_HOMEPAGE_SECTIONS)).map(
      (s: { settings: object }) => ({
        ...s,
        settings: Object.fromEntries(Object.entries(s.settings).reverse()),
      }),
    );
    expect(JSON.stringify(readThemeDocument(v2(reversed)).homepage.sections)).toBe(v1Json);
    expect(readThemeDocument(v1Doc()).homepage.sections.map((s) => s.type)).toEqual([
      "featured_products",
      "collection_list",
    ]);
  });

  it("a version-1 write with [] is upcast; with sections it is still SECTIONS_NOT_SUPPORTED", () => {
    const ok = validateThemeDocument(v1Doc());
    expect(ok.ok && ok.value.homepage.sections).toEqual(DEFAULT_HOMEPAGE_SECTIONS);
    expect(ok.ok && ok.value.schemaVersion).toBe(2);
    const bad = validateThemeDocument({
      ...v1Doc(),
      homepage: { sections: [newSection("hero", id(1))] },
    });
    expect(bad).toEqual({
      ok: false,
      issues: [{ path: "homepage.sections", code: "SECTIONS_NOT_SUPPORTED" }],
    });
  });

  it("a version-1 write with an announcement is an unknown key", () => {
    const doc = v1Doc();
    doc.header = { sticky: false, announcement: null };
    expect(issuesOf(doc)).toEqual([{ path: "header.announcement", code: "UNKNOWN_KEY" }]);
  });

  it("version 2 stores sections literally: an empty homepage stays empty", () => {
    const out = validateThemeDocument(v2([]));
    expect(out.ok && out.value.homepage.sections).toEqual([]);
    expect(readThemeDocument(v2([])).homepage.sections).toEqual([]);
  });

  it("a newer version reads as 2 with unknown sections kept; the write path refuses it", () => {
    const future = { id: id(9), type: "countdown_timer", hidden: false, settings: { endsAt: "x" } };
    expect(readThemeDocument({ ...v2([future]), schemaVersion: 3 }).homepage.sections).toEqual([
      future,
    ]);
    expect(validateThemeDocument({ ...v2([]), schemaVersion: 3 })).toMatchObject({
      ok: false,
      issues: [{ path: "schemaVersion", code: "UNSUPPORTED_SCHEMA_VERSION" }],
    });
  });

  it("issue paths are dotted, down to the locale (Ruling 4)", () => {
    const hero = newSection("hero", id(1));
    const doc = v2([
      newSection("rich_text", id(2)),
      { ...hero, settings: { ...hero.settings, heading: { ar: "x".repeat(81) } } },
    ]);
    expect(validateThemeDocument(doc)).toEqual({
      ok: false,
      issues: [{ path: "homepage.sections.1.settings.heading.ar", code: "TOO_LONG" }],
    });
  });

  it("an unknown type is kept unchanged on write (Ruling 7)", () => {
    const future = { id: id(9), type: "countdown_timer", hidden: true, settings: { a: [1] } };
    const out = validateThemeDocument(v2([future]));
    expect(out.ok && out.value.homepage.sections).toEqual([future]);
  });

  it("a bad source reads as newest; a strict save refuses it (Ruling 7)", () => {
    const fp = newSection("featured_products", id(1));
    const bad = v2([{ ...fp, settings: { ...fp.settings, source: "bogus" } }]);
    expect(issuesOf(bad)).toEqual([
      { path: "homepage.sections.0.settings.source", code: "INVALID_VALUE" },
    ]);
    const read = readThemeDocument(bad).homepage.sections[0] as { settings: { source: string } };
    expect(read.settings.source).toBe("newest");
  });

  describe("limits, each at N and N+1", () => {
    const rich = (n: number) =>
      Array.from({ length: n }, (_, i) => newSection("rich_text", id(i + 1)));
    const ofType = (type: "hero" | "whatsapp_cta" | "lead_form", n: number) =>
      Array.from({ length: n }, (_, i) => newSection(type, id(i + 1)));

    it("25 sections pass, 26 are TOO_MANY_SECTIONS at homepage.sections only", () => {
      expect(validateThemeDocument(v2(rich(25))).ok).toBe(true);
      expect(validateThemeDocument(v2(rich(26)))).toEqual({
        ok: false,
        issues: [{ path: "homepage.sections", code: "TOO_MANY_SECTIONS" }],
      });
    });

    it("3 heroes pass, the 4th is TOO_MANY_OF_TYPE at its type", () => {
      expect(validateThemeDocument(v2(ofType("hero", 3))).ok).toBe(true);
      expect(validateThemeDocument(v2(ofType("hero", 4)))).toEqual({
        ok: false,
        issues: [{ path: "homepage.sections.3.type", code: "TOO_MANY_OF_TYPE" }],
      });
    });

    it("2 WhatsApp buttons pass, the 3rd is TOO_MANY_OF_TYPE", () => {
      expect(validateThemeDocument(v2(ofType("whatsapp_cta", 2))).ok).toBe(true);
      expect(validateThemeDocument(v2(ofType("whatsapp_cta", 3)))).toEqual({
        ok: false,
        issues: [{ path: "homepage.sections.2.type", code: "TOO_MANY_OF_TYPE" }],
      });
    });

    it("1 lead form passes, the 2nd is TOO_MANY_OF_TYPE", () => {
      expect(validateThemeDocument(v2(ofType("lead_form", 1))).ok).toBe(true);
      expect(validateThemeDocument(v2(ofType("lead_form", 2)))).toEqual({
        ok: false,
        issues: [{ path: "homepage.sections.1.type", code: "TOO_MANY_OF_TYPE" }],
      });
    });

    it("every section past the limit is flagged, in index order", () => {
      expect(validateThemeDocument(v2(ofType("hero", 5)))).toEqual({
        ok: false,
        issues: [
          { path: "homepage.sections.3.type", code: "TOO_MANY_OF_TYPE" },
          { path: "homepage.sections.4.type", code: "TOO_MANY_OF_TYPE" },
        ],
      });
    });

    it("one announcement bar in the header passes; a bar in the page is not allowed there", () => {
      expect(validateThemeDocument(v2([], newSection("announcement_bar", id(1)))).ok).toBe(true);
      expect(validateThemeDocument(v2([newSection("announcement_bar", id(1))]))).toEqual({
        ok: false,
        issues: [{ path: "homepage.sections.0.type", code: "SECTION_NOT_ALLOWED_HERE" }],
      });
    });
  });

  it("ids are unique across the header and the page, case-insensitively", () => {
    const bar = newSection("announcement_bar", id(1));
    expect(validateThemeDocument(v2([newSection("rich_text", id(1))], bar))).toEqual({
      ok: false,
      issues: [{ path: "homepage.sections.0.id", code: "DUPLICATE_SECTION_ID" }],
    });
    const upper = { ...newSection("rich_text", id(2)), id: id(2).toUpperCase() };
    expect(validateThemeDocument(v2([newSection("hero", id(2)), upper]))).toEqual({
      ok: false,
      issues: [{ path: "homepage.sections.1.id", code: "DUPLICATE_SECTION_ID" }],
    });
  });

  it("issues keep the header before the homepage", () => {
    const hero = newSection("hero", id(1));
    const out = validateThemeDocument(v2([{ ...hero, hidden: "x" }], newSection("hero", id(2))));
    expect(!out.ok && out.issues.map((i) => i.path)).toEqual([
      "header.announcement.type",
      "homepage.sections.0.hidden",
    ]);
  });

  it("the announcement slot takes an announcement bar or null; absent is null", () => {
    const bar = newSection("announcement_bar", id(1));
    const ok = validateThemeDocument(v2([], bar));
    expect(ok.ok && ok.value.header.announcement).toEqual(bar);
    const { announcement: _a, ...headerWithout } = v2([]).header;
    const absent = validateThemeDocument({ ...v2([]), header: headerWithout });
    expect(absent.ok && absent.value.header.announcement).toBeNull();
    expect(validateThemeDocument(v2([], newSection("hero", id(2))))).toMatchObject({
      ok: false,
      issues: [{ path: "header.announcement.type", code: "SECTION_NOT_ALLOWED_HERE" }],
    });
  });

  it("a corrupt stored announcement reads as null and keeps sticky and menuHandle (F10)", () => {
    const doc = v2([]);
    doc.header = { sticky: true, menuHandle: "sale", announcement: { id: "bad" } } as never;
    expect(readThemeDocument(doc).header).toEqual({
      sticky: true,
      menuHandle: "sale",
      announcement: null,
    });
    const hero = { ...doc, header: { ...doc.header, announcement: newSection("hero", id(1)) } };
    expect(readThemeDocument(hero).header).toEqual({
      sticky: true,
      menuHandle: "sale",
      announcement: null,
    });
  });

  it("a corrupt stored section is skipped on read; a duplicate id keeps the first", () => {
    const good = newSection("rich_text", id(1));
    const read = readThemeDocument(v2([good, { id: "bad" }, { ...newSection("features", id(1)) }]));
    expect(read.homepage.sections).toEqual([good]);
  });

  it("a read keeps the first 25 sections", () => {
    const many = Array.from({ length: 30 }, (_, i) => newSection("rich_text", id(i + 1)));
    expect(readThemeDocument(v2(many)).homepage.sections).toHaveLength(25);
  });

  it("the 256 KB cap still holds with sections", () => {
    const big = newSection("rich_text", id(1));
    const doc = v2(
      Array.from({ length: 25 }, (_, i) => ({
        ...big,
        id: id(i + 1),
        settings: { ...big.settings, body: { ar: "س".repeat(5000), en: "x".repeat(5000) } },
      })),
    );
    expect(validateThemeDocument(doc)).toEqual({
      ok: false,
      issues: [{ path: "", code: "DOCUMENT_TOO_LARGE" }],
    });
  });

  it("documentRefsOf names brand images, the bar link target and every section ref, with paths", () => {
    const barBase = newSection("announcement_bar", id(1));
    const bar = {
      ...barBase,
      settings: { ...barBase.settings, link: { type: "page", id: "pg1" } },
    };
    const refs = documentRefsOf(
      readThemeDocument({
        ...v2([], bar),
        brand: {
          ...DEFAULT_THEME_DOCUMENT.brand,
          logo: { imageRef: "logo1", widthPx: 140 },
          favicon: { imageRef: "fav1" },
        },
      }),
    );
    expect(refs.image).toEqual([
      { path: "brand.logo.imageRef", id: "logo1" },
      { path: "brand.favicon.imageRef", id: "fav1" },
    ]);
    expect(refs.page).toEqual([{ path: "header.announcement.settings.link.id", id: "pg1" }]);
    expect(refs.collection).toEqual([]);
  });

  it("imageRefsOf lists the distinct ids, section images included", () => {
    const hero = newSection("hero", id(1));
    const doc = readThemeDocument({
      ...v2([{ ...hero, settings: { ...hero.settings, image: "same" } }]),
      brand: { ...DEFAULT_THEME_DOCUMENT.brand, logo: { imageRef: "same", widthPx: 140 } },
    });
    expect(documentRefsOf(doc).image).toEqual([
      { path: "brand.logo.imageRef", id: "same" },
      { path: "homepage.sections.0.settings.image", id: "same" },
    ]);
    expect(imageRefsOf(doc)).toEqual(["same"]);
  });
});

describe("a lenient read always passes the strict write (fix round 1)", () => {
  const roundTrips = (raw: unknown) => {
    const read = readThemeDocument(raw);
    expect(validateThemeDocument(read)).toEqual({ ok: true, value: read });
    return read;
  };

  it("4 heroes keep the first 3, in document order", () => {
    const heroes = Array.from({ length: 4 }, (_, i) => newSection("hero", id(i + 1)));
    const read = roundTrips(v2(heroes));
    expect(read.homepage.sections.map((s) => s.id)).toEqual([id(1), id(2), id(3)]);
  });

  it("a testimonials or features section below its items minimum is dropped", () => {
    for (const type of ["testimonials", "features"] as const) {
      const base = newSection(type, id(1));
      const empty = { ...base, settings: { ...base.settings, items: [] } };
      const read = roundTrips(v2([empty, newSection("rich_text", id(2))]));
      expect(read.homepage.sections.map((s) => s.id)).toEqual([id(2)]);
    }
  });

  it("3 WhatsApp sections keep the first 2", () => {
    const wa = Array.from({ length: 3 }, (_, i) => newSection("whatsapp_cta", id(i + 1)));
    const read = roundTrips(v2(wa));
    expect(read.homepage.sections.map((s) => s.id)).toEqual([id(1), id(2)]);
  });

  it("a section that shares the announcement id is dropped", () => {
    const bar = newSection("announcement_bar", id(1));
    const read = roundTrips(
      v2([newSection("rich_text", id(1).toUpperCase()), newSection("rich_text", id(2))], bar),
    );
    expect(read.homepage.sections.map((s) => s.id)).toEqual([id(2)]);
  });

  it("an unknown type with an extra envelope key round-trips", () => {
    const future = { id: id(9), type: "countdown_timer", hidden: false, settings: { a: 1 } };
    const read = roundTrips(v2([{ ...future, locked: true }]));
    expect(JSON.stringify(read.homepage.sections)).toBe(JSON.stringify([future]));
  });

  it("TOO_MANY_OF_TYPE is reported in the same round as other issues", () => {
    const heroes = Array.from({ length: 4 }, (_, i) => newSection("hero", id(i + 1)));
    const broken = [{ ...heroes[0], hidden: "x" }, heroes[1], heroes[2], heroes[3]];
    const out = validateThemeDocument(v2(broken));
    expect(!out.ok && out.issues).toEqual([
      { path: "homepage.sections.0.hidden", code: "INVALID_VALUE" },
      { path: "homepage.sections.3.type", code: "TOO_MANY_OF_TYPE" },
    ]);
  });

  it("a bar link to a collection is a ref, through the same descriptors", () => {
    const base = newSection("announcement_bar", id(1));
    const bar = { ...base, settings: { ...base.settings, link: { type: "collection", id: "c1" } } };
    expect(documentRefsOf(readThemeDocument(v2([], bar))).collection).toEqual([
      { path: "header.announcement.settings.link.id", id: "c1" },
    ]);
  });
});
