import { describe, expect, it } from "vitest";
import { pageHandleOf, validatePageContent } from "./page-content";

describe("validatePageContent (spec 2.4)", () => {
  it("normalises; absent fields are empty", () => {
    expect(validatePageContent({ title: { en: "  About  " } })).toEqual({
      ok: true,
      value: { title: { en: "About" }, body: {}, metaDescription: {} },
    });
  });
  it("keeps body newlines and enforces every limit per locale", () => {
    const ok = validatePageContent({ body: { ar: "سطر\nسطر" } });
    expect(ok.ok && ok.value.body.ar).toBe("سطر\nسطر");
    const out = validatePageContent({
      title: { en: "t".repeat(256) },
      metaDescription: { ar: "m".repeat(321) },
      body: { en: "b".repeat(100_001) },
    });
    expect(out.ok ? [] : out.issues).toEqual(
      expect.arrayContaining([
        { path: "title.en", code: "TOO_LONG" },
        { path: "metaDescription.ar", code: "TOO_LONG" },
        { path: "body.en", code: "TOO_LONG" },
      ]),
    );
  });
  it("an unsafe link in a body is UNSAFE_LINK on that locale", () => {
    const out = validatePageContent({ body: { en: "[x](javascript:alert(1))" } });
    expect(out.ok ? [] : out.issues).toEqual([{ path: "body.en", code: "UNSAFE_LINK" }]);
  });
  it("strips bidi overrides from titles", () => {
    const out = validatePageContent({ title: { en: `a${String.fromCharCode(0x202e)}b` } });
    expect(out.ok && out.value.title.en).toBe("ab");
  });
});

describe("pageHandleOf (spec 2.4)", () => {
  it("only /pages/<handle> is served", () => {
    expect(pageHandleOf("/pages/about-us")).toBe("about-us");
    for (const path of ["/about", "/pages", "/pages/a/b", "/pages/:slug", "/products/x"]) {
      expect(pageHandleOf(path), path).toBeNull();
    }
  });
});
