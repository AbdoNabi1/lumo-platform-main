import { describe, expect, it } from "vitest";
import {
  canonicalDocumentJson,
  DEFAULT_THEME_DOCUMENT,
  imageRefsOf,
  menuHandlesOf,
  MAX_DOCUMENT_BYTES,
  readBrandStyle,
  readThemeDocument,
  validateThemeDocument,
  type ThemeDocument,
} from "./theme-document";

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
    expect(DEFAULT_THEME_DOCUMENT.homepage.sections).toEqual([]);
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

  it("refuses homepage sections until Part 3, and an unknown schema version", () => {
    const raw = clone();
    raw.homepage.sections = [{ type: "hero" }];
    raw.schemaVersion = 2;
    expect(issuesOf(raw)).toEqual([
      { path: "schemaVersion", code: "UNSUPPORTED_SCHEMA_VERSION" },
      { path: "homepage.sections", code: "SECTIONS_NOT_SUPPORTED" },
    ]);
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
    raw.homepage.sections = [{ type: "from-a-newer-build" }];
    raw.schemaVersion = 2;
    expect(readThemeDocument(raw).homepage.sections).toEqual([{ type: "from-a-newer-build" }]);
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
    expect(read.header).toEqual({ sticky: true, menuHandle: "main-menu" });
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
    expect(json).toContain('"header":{"sticky":false,"menuHandle":"x"}');
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
    expect(doc.header).toEqual({ sticky: true, menuHandle: "main-menu" });
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
