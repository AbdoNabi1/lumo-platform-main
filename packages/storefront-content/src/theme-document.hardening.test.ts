import { describe, expect, it } from "vitest";
import {
  canonicalDocumentJson,
  DEFAULT_THEME_DOCUMENT,
  MAX_DOCUMENT_BYTES,
  readSocial,
  readThemeDocument,
  validateThemeDocument,
} from "./theme-document";

type Doc = ReturnType<typeof JSON.parse>;
const clone = (): Doc => JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
const issuesOf = (raw: unknown) => {
  const outcome = validateThemeDocument(raw);
  return outcome.ok ? [] : outcome.issues;
};

describe("social links are stored cleaned, never raw", () => {
  it.each([
    ["a NUL", "https://x.example/\u0000"],
    ["a leading space", " https://x.example"],
    ["a trailing space", "https://x.example/ "],
    ["an inner newline", "https://x.example/a\nb"],
    ["an inner tab", "https://x.example/a\tb"],
    ["a bidi override", "https://x.example/\u202E"],
    ["a bidi isolate", "https://x.example/\u2066"],
    ["a line separator", "https://x.example/\u2028"],
    ["a paragraph separator", "https://x.example/\u2029"],
    ["a no-break space", "https://x.example/\u00A0"],
    ["a C1 control", "https://x.example/\u0085"],
    ["a zero-width space", "https://x.example/\u200B"],
    ["no slashes after the scheme", "https:evil.example"],
    ["one slash after the scheme", "https:/evil.example"],
    ["backslashes after the scheme", "https:\\\\evil.example"],
  ])("refuses %s", (_label, url) => {
    const raw = clone();
    raw.brand.social.instagram = url;
    expect(issuesOf(raw)).toEqual([{ path: "brand.social.instagram", code: "INVALID_URL" }]);
  });

  it("stores the normalised href", () => {
    const raw = clone();
    raw.brand.social.instagram = "HTTPS://Instagram.COM/shop";
    const outcome = validateThemeDocument(raw);
    expect(outcome.ok && outcome.value.brand.social).toEqual({
      instagram: "https://instagram.com/shop",
    });
  });

  it("readSocial keeps clean links, in network order, and drops the rest", () => {
    expect(
      readSocial({
        youtube: "https://youtu.be/x",
        facebook: "https://facebook.com/shop",
        instagram: "https:evil.example",
        x: "http://x.com/a",
        myspace: "https://myspace.com/a",
      }),
    ).toEqual({ facebook: "https://facebook.com/shop", youtube: "https://youtu.be/x" });
    expect(
      Object.keys(readSocial({ youtube: "https://y.example/", facebook: "https://f.example/" })),
    ).toEqual(["facebook", "youtube"]);
    expect(readSocial(null)).toEqual({});
  });
});

describe("canonicalDocumentJson", () => {
  it("is the same for documents that differ only in nested key order", () => {
    const a = clone();
    a.brand.social = { facebook: "https://f.example/", instagram: "https://i.example/" };
    a.footer.note = { ar: "س", en: "e" };
    const b = clone();
    b.brand.social = { instagram: "https://i.example/", facebook: "https://f.example/" };
    b.footer.note = { en: "e", ar: "س" };
    b.brand.colors = Object.fromEntries(Object.entries(b.brand.colors).reverse());
    b.footer = { showSocial: b.footer.showSocial, note: b.footer.note };
    expect(canonicalDocumentJson(a)).toBe(canonicalDocumentJson(b));
    expect(Object.keys(readThemeDocument(b).brand.social)).toEqual(["facebook", "instagram"]);
    expect(Object.keys(readThemeDocument(b).footer.note)).toEqual(["ar", "en"]);
  });

  it("still tells real differences apart", () => {
    const a = clone();
    const b = clone();
    b.brand.social = { tiktok: "https://t.example/" };
    expect(canonicalDocumentJson(a)).not.toBe(canonicalDocumentJson(b));
  });
});

describe("the default document", () => {
  it("is frozen all the way down, and fallbacks cannot be used to change it", () => {
    const frozen = (value: unknown): boolean =>
      typeof value !== "object" ||
      value === null ||
      (Object.isFrozen(value) && Object.values(value).every(frozen));
    expect(frozen(DEFAULT_THEME_DOCUMENT)).toBe(true);
    const doc = readThemeDocument(null);
    expect(() => {
      (doc.brand.colors as { primary: string }).primary = "#000000";
    }).toThrow(TypeError);
    expect(DEFAULT_THEME_DOCUMENT.brand.colors.primary).toBe("#635bff");
  });
});

describe("a key present with the value undefined is a missing key", () => {
  it.each([
    ["header.sticky", (raw: Doc) => (raw.header.sticky = undefined)],
    ["brand.corners", (raw: Doc) => (raw.brand.corners = undefined)],
    ["brand.typography.baseSize", (raw: Doc) => (raw.brand.typography.baseSize = undefined)],
    ["brand.typography.headingFont", (raw: Doc) => (raw.brand.typography.headingFont = undefined)],
    ["brand.logo.imageRef", (raw: Doc) => (raw.brand.logo.imageRef = undefined)],
    ["brand.logo.widthPx", (raw: Doc) => (raw.brand.logo.widthPx = undefined)],
    ["brand.colors.primary", (raw: Doc) => (raw.brand.colors.primary = undefined)],
    ["footer.note", (raw: Doc) => (raw.footer.note = undefined)],
    ["footer.showSocial", (raw: Doc) => (raw.footer.showSocial = undefined)],
    ["schemaVersion", (raw: Doc) => (raw.schemaVersion = undefined)],
  ])("%s", (path, mutate) => {
    const raw = clone();
    mutate(raw);
    expect(issuesOf(raw)).toEqual([{ path, code: "MISSING" }]);
  });
});

describe("a missing sub-object is reported once", () => {
  it.each(["brand", "header", "footer", "homepage"])("%s", (key) => {
    const raw = clone();
    delete raw[key];
    expect(issuesOf(raw)).toEqual([{ path: key, code: "MISSING" }]);
  });

  it.each(["logo", "favicon", "colors", "typography", "social"])("brand.%s", (key) => {
    const raw = clone();
    delete raw.brand[key];
    expect(issuesOf(raw)).toEqual([{ path: `brand.${key}`, code: "MISSING" }]);
  });

  it("homepage.sections", () => {
    const raw = clone();
    delete raw.homepage.sections;
    expect(issuesOf(raw)).toEqual([{ path: "homepage.sections", code: "MISSING" }]);
  });

  it("an undefined document is one INVALID_VALUE at the root", () => {
    expect(issuesOf(undefined)).toEqual([{ path: "", code: "INVALID_VALUE" }]);
  });
});

describe("prototype keys are unknown keys, never assigned", () => {
  // JSON.parse creates a real own "__proto__" property, as a request body would.
  const withProtoKeys = (obj: object): Doc => {
    const text = JSON.stringify(obj);
    const injected = '"__proto__":{"polluted":true},"constructor":1';
    return JSON.parse(text === "{}" ? `{${injected}}` : `{${injected},${text.slice(1)}`);
  };

  it("at every object level", () => {
    const doc = clone();
    doc.brand.colors = withProtoKeys(doc.brand.colors);
    doc.brand.social = withProtoKeys({});
    doc.footer.note = withProtoKeys({});
    expect(issuesOf(withProtoKeys(doc))).toEqual([
      { path: "__proto__", code: "UNKNOWN_KEY" },
      { path: "constructor", code: "UNKNOWN_KEY" },
      { path: "brand.colors.__proto__", code: "UNKNOWN_KEY" },
      { path: "brand.colors.constructor", code: "UNKNOWN_KEY" },
      { path: "brand.social.__proto__", code: "UNKNOWN_KEY" },
      { path: "brand.social.constructor", code: "UNKNOWN_KEY" },
      { path: "footer.note.__proto__", code: "UNKNOWN_KEY" },
      { path: "footer.note.constructor", code: "UNKNOWN_KEY" },
    ]);
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("limits", () => {
  it("accepts a document of exactly 256 KB by size and refuses one byte more", () => {
    const sized = (extra: number) => {
      const raw = clone();
      raw.padding = "";
      const base = new TextEncoder().encode(JSON.stringify(raw)).length;
      raw.padding = "x".repeat(MAX_DOCUMENT_BYTES - base + extra);
      return raw;
    };
    expect(new TextEncoder().encode(JSON.stringify(sized(0))).length).toBe(MAX_DOCUMENT_BYTES);
    expect(issuesOf(sized(0))).toEqual([{ path: "padding", code: "UNKNOWN_KEY" }]);
    expect(issuesOf(sized(1))).toEqual([{ path: "", code: "DOCUMENT_TOO_LARGE" }]);
  });

  it("bounds the number of issues and the length of echoed key names", () => {
    const raw = clone();
    for (let i = 0; i < 5000; i += 1) raw[`k${i}`] = 1;
    raw["y".repeat(10_000)] = 1;
    raw.brand.social = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`s${i}`, "x"]));
    const issues = issuesOf(raw);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.length).toBeLessThanOrEqual(50);
    for (const issue of issues) expect(issue.path.length).toBeLessThanOrEqual(80);
  });
});

describe("version 2 sections and the announcement slot", () => {
  const sectionOf = (extra: string) =>
    JSON.parse(
      `{${extra}"id":"6f1b2c3d-4e5f-4a6b-8c7d-000000000001","type":"rich_text","hidden":false,` +
        `"settings":${JSON.stringify(DEFAULT_THEME_DOCUMENT.homepage.sections[0]?.settings ?? {})}}`,
    );

  it("a __proto__ key on a section is an unknown key and pollutes nothing", () => {
    const raw = clone();
    raw.homepage.sections = [sectionOf('"__proto__":{"polluted":true},')];
    const issues = issuesOf(raw);
    expect(issues).toContainEqual({ path: "homepage.sections.0.__proto__", code: "UNKNOWN_KEY" });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("a non-object homepage is one INVALID_VALUE, and a non-array sections list too", () => {
    const raw = clone();
    raw.homepage = "x";
    expect(issuesOf(raw)).toEqual([{ path: "homepage", code: "INVALID_VALUE" }]);
    raw.homepage = { sections: {} };
    expect(issuesOf(raw)).toEqual([{ path: "homepage.sections", code: "INVALID_VALUE" }]);
  });

  it("a non-object announcement is INVALID_VALUE on write and null on read", () => {
    const raw = clone();
    raw.header.announcement = "x";
    expect(issuesOf(raw)).toEqual([{ path: "header.announcement", code: "INVALID_VALUE" }]);
    expect(readThemeDocument(raw).header.announcement).toBeNull();
  });

  it("the read path never throws on hostile sections", () => {
    const raw = clone();
    raw.homepage.sections = [null, 1, "x", [], { __proto__: 1 }, { id: {}, type: [] }];
    expect(readThemeDocument(raw).homepage.sections).toEqual([]);
  });
});
