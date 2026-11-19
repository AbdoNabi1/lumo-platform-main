import { describe, expect, it } from "vitest";
import {
  isSafeRelativePath,
  LINK_URL_MAX,
  normalizeExternalUrl,
  PAGE_HANDLE_PATTERN,
  pageHandleOfPath,
  safeHref,
} from "./links";

const ch = (code: number) => String.fromCharCode(code);

describe("normalizeExternalUrl (spec 2.2, Ruling 25)", () => {
  it.each([
    ["https://example.com/a?b=1#c", "https://example.com/a?b=1#c"],
    ["HTTPS://Example.COM", "https://example.com/"],
    ["https://wa.me/201001234567", "https://wa.me/201001234567"],
    ["mailto:hello@Shop.Example", "mailto:hello@shop.example"],
    ["tel:+20 100 123 4567", "tel:+201001234567"],
    ["tel:(02) 2345-6789", "tel:0223456789"],
    ["TEL:19999", "tel:19999"],
  ])("accepts %s as %s", (input, expected) => {
    expect(normalizeExternalUrl(input)).toBe(expected);
  });

  it.each([
    "http://example.com",
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<b>x</b>",
    "vbscript:msgbox(1)",
    "ftp://example.com",
    "//evil.example",
    "/relative",
    "https:evil.example",
    "https://user:pass@evil.example",
    "https://user@evil.example",
    "https://exa mple.com",
    "https://example.com/\n",
    "tel:+20abc",
    "tel:12",
    "tel:" + "1".repeat(21),
    "mailto:",
    "mailto:a@b.example?subject=x",
    "mailto:a@b.example,c@d.example",
    "",
    `https://example.com/${"a".repeat(LINK_URL_MAX)}`,
  ])("refuses %j", (input) => {
    expect(normalizeExternalUrl(input)).toBeNull();
  });

  it("refuses zero-width, bidi, no-break and control characters anywhere", () => {
    for (const code of [0x00, 0x1f, 0x7f, 0xa0, 0x200b, 0x200e, 0x202e, 0x2066, 0x2069, 0xfeff]) {
      expect(normalizeExternalUrl(`https://exa${ch(code)}mple.com`), code.toString(16)).toBeNull();
      expect(normalizeExternalUrl(`tel:+20${ch(code)}1001234567`), code.toString(16)).toBeNull();
    }
  });

  it("refuses anything that is not a string", () => {
    for (const value of [null, undefined, 1, {}, ["https://a.example"]]) {
      expect(normalizeExternalUrl(value)).toBeNull();
    }
  });

  // Preflight 5: only the ASCII space is allowed inside a tel: number; every other whitespace is not.
  it("a tel: number refuses tab, newline and no-break space between its digits", () => {
    for (const code of [0x09, 0x0a, 0x0d, 0xa0, 0x2028]) {
      expect(normalizeExternalUrl(`tel:+20${ch(code)}100`), code.toString(16)).toBeNull();
    }
    expect(normalizeExternalUrl(" tel:19999")).toBeNull();
  });

  // Preflight 19: a URL the parser cannot read is refused, never thrown.
  it.each(["https://[", "https://a.example:99999", "https://", "https://%zz"])(
    "never throws on %j",
    (input) => {
      expect(() => normalizeExternalUrl(input)).not.toThrow();
      expect(normalizeExternalUrl(input)).toBeNull();
    },
  );
});

/**
 * Part 1's open-redirect attempts (apps/storefront/src/lib/return-to.test.ts, review C-1): the
 * parse resolves dot segments and drops tab and newline, so each of these could come out as
 * `//evil.example` (preflight 3).
 */
const REDIRECT_ATTACKS = [
  "/\t/evil.example",
  "/\n/evil.example",
  "/\r\n/evil.example",
  "/\t\\evil.example",
  "\t//evil.example",
  "/.//evil.example",
  "/..//evil.example",
  "/%2e//evil.example",
  "/%2e//evil.example/x",
  "/%2E%2E//evil.example/x?y#z",
  "/.\t//evil.example",
  "/a/..//evil.example",
  "/./\\evil.example",
  "/.%2e//evil.example",
  "//evil",
  "/\t/evil",
  "https://evil",
  "javascript:",
  `/${ch(0)}/evil.example`,
];

describe("isSafeRelativePath", () => {
  it.each(["/", "/pages/about", "/collections/new?sort=price#top", "/search?q=%D8%A7"])(
    "accepts %s",
    (path) => expect(isSafeRelativePath(path)).toBe(true),
  );
  it.each([
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/a\nb",
    "/ a",
    "/a\\b",
    "pages/about",
    "",
    `/${"a".repeat(LINK_URL_MAX)}`,
  ])("refuses %j", (path) => expect(isSafeRelativePath(path)).toBe(false));
  it("refuses an invisible character", () => {
    expect(isSafeRelativePath(`/pa${ch(0x202e)}ges`)).toBe(false);
  });

  it.each(REDIRECT_ATTACKS)("refuses the open-redirect attempt %j", (path) => {
    expect(isSafeRelativePath(path)).toBe(false);
    // Never a same-site link (`https://evil` is a valid external link, never a relative one).
    expect(safeHref(path)?.href.startsWith("/") ?? false).toBe(false);
  });

  it("refuses a path the URL parser would rewrite (it must round-trip exactly)", () => {
    for (const path of ["/a/../b", "/a/./b", "/%2e%2e/b", "/a?b=<x>"]) {
      expect(isSafeRelativePath(path), path).toBe(false);
    }
    // Encoded slashes stay one segment on this shop.
    expect(isSafeRelativePath("/%2F%2Fevil")).toBe(true);
  });

  it("every accepted path resolves on the same origin to exactly itself", () => {
    const pieces = [
      "/",
      "//",
      "\\",
      ".",
      "..",
      "%2e",
      "%2E",
      "%2f",
      "%5c",
      "a",
      "?",
      "#",
      ":",
      "@",
    ];
    let seed = 0x9e3779b9;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 1_000; i += 1) {
      let raw = "/";
      const length = 1 + Math.floor(random() * 8);
      for (let j = 0; j < length; j += 1) raw += pieces[Math.floor(random() * pieces.length)];
      if (!isSafeRelativePath(raw)) continue;
      expect(raw, JSON.stringify(raw)).toMatch(/^\/(?:$|[^/\\])/);
      const resolved = new URL(raw, "https://shop.example/pages/x");
      expect(resolved.origin, JSON.stringify(raw)).toBe("https://shop.example");
      expect(`${resolved.pathname}${resolved.search}${resolved.hash}`).toBe(raw);
    }
  });
});

describe("safeHref", () => {
  it("a same-site path is internal; https is external; mailto and tel are neither", () => {
    expect(safeHref("/pages/about")).toEqual({ href: "/pages/about", external: false });
    expect(safeHref("https://shop.example")).toEqual({
      href: "https://shop.example/",
      external: true,
    });
    expect(safeHref("mailto:a@b.example")).toEqual({ href: "mailto:a@b.example", external: false });
    expect(safeHref("tel:19999")).toEqual({ href: "tel:19999", external: false });
  });
  it("everything else is null", () => {
    for (const value of ["javascript:x", "//evil.example", "http://x.example", 3, null]) {
      expect(safeHref(value)).toBeNull();
    }
  });
});

describe("PAGE_HANDLE_PATTERN and pageHandleOfPath (preflight 15)", () => {
  it("a handle is 1 to 100 of a-z, 0-9, _ and -", () => {
    expect(PAGE_HANDLE_PATTERN.test("about-us_2")).toBe(true);
    expect(PAGE_HANDLE_PATTERN.test("a".repeat(100))).toBe(true);
    for (const handle of ["", "a".repeat(101), "About", "a/b", "..", "%2e%2e", "a b"]) {
      expect(PAGE_HANDLE_PATTERN.test(handle), handle).toBe(false);
    }
  });
  it("reads the handle of /pages/<handle> only", () => {
    expect(pageHandleOfPath("/pages/about-us")).toBe("about-us");
    for (const path of [
      "/pages/",
      "/pages/About",
      "/pages/a/b",
      "/pages/a?x",
      "/landing",
      "pages/about",
      `/pages/${"a".repeat(101)}`,
    ]) {
      expect(pageHandleOfPath(path), path).toBeNull();
    }
  });
});

describe("review fix round 1", () => {
  // Review M1: normalising must give a value the same rules accept again (a fixed point).
  it("refuses an https host whose normalised form the URL parser refuses (IDN)", () => {
    expect(normalizeExternalUrl("https://\u00dfxn--.example")).toBeNull();
    expect(safeHref("https://\u00dfxn--.example")).toBeNull();
  });

  it("every normalised https URL and every safe href is a fixed point", () => {
    const pieces = ["\u00df", "xn--", "-", ".", "a", "\u0639", "%41", ":", "8", "/", "?", "#", "@"];
    const random = mulberry(0x5eed);
    for (let i = 0; i < 3_000; i += 1) {
      let raw = random() < 0.5 ? "https://" : "/";
      const length = 1 + Math.floor(random() * 10);
      for (let j = 0; j < length; j += 1) raw += pieces[Math.floor(random() * pieces.length)];
      const out = normalizeExternalUrl(raw);
      if (out !== null) expect(normalizeExternalUrl(out), JSON.stringify(raw)).toBe(out);
      const href = safeHref(raw);
      if (href !== null) expect(safeHref(href.href), JSON.stringify(raw)).toEqual(href);
    }
  });

  // Review M2: no `%` in the local part, so no encoded `?`, `,` or newline gets through.
  it.each([
    "mailto:a%3Fbcc%3Dc@d.example",
    "mailto:a%2Cevil%40x.example@b.example",
    "mailto:%0a@b.example",
  ])("refuses the percent-encoded mailto %s", (input) => {
    expect(normalizeExternalUrl(input)).toBeNull();
  });

  // Review M8: more invisible characters, and U+2029 inside a tel: number.
  it("refuses soft hyphen, Arabic letter mark, word joiners and paragraph separator", () => {
    for (const code of [0xad, 0x61c, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2029]) {
      expect(normalizeExternalUrl(`https://exa${ch(code)}mple.com`), code.toString(16)).toBeNull();
      expect(normalizeExternalUrl(`tel:+20${ch(code)}1001234567`), code.toString(16)).toBeNull();
      expect(normalizeExternalUrl(`mailto:a${ch(code)}@b.example`), code.toString(16)).toBeNull();
      expect(safeHref(`/pa${ch(code)}ges`), code.toString(16)).toBeNull();
    }
  });

  // Review M6: raw Unicode and a bare trailing `?` or `#` become the canonical encoded path.
  it("canonicalises a raw-Unicode path or query to its percent-encoded form", () => {
    const arabic = "\u0639\u0631\u0628\u064a";
    const policy = "\u0633\u064a\u0627\u0633\u0629";
    expect(safeHref(`/search?q=${arabic}`)).toEqual({
      href: `/search?q=${encodeURIComponent(arabic)}`,
      external: false,
    });
    expect(safeHref(`/pages/${policy}`)).toEqual({
      href: `/pages/${encodeURIComponent(policy)}`,
      external: false,
    });
    expect(safeHref("/search?q=it's")).toEqual({ href: "/search?q=it%27s", external: false });
    expect(safeHref("/a?")).toEqual({ href: "/a", external: false });
    expect(safeHref("/a#")).toEqual({ href: "/a", external: false });
    // The exported predicate itself stays strict: only canonical paths.
    expect(isSafeRelativePath(`/pages/${policy}`)).toBe(false);
  });

  it("canonicalising never yields an off-site path", () => {
    const pieces = ["/", "//", ".", "..", "%2e", "%2E", "%2f", "a", "?", "#", "\u0639", "'", "<"];
    const random = mulberry(0xc0ffee);
    for (let i = 0; i < 3_000; i += 1) {
      let raw = "/";
      const length = 1 + Math.floor(random() * 8);
      for (let j = 0; j < length; j += 1) raw += pieces[Math.floor(random() * pieces.length)];
      const href = safeHref(raw);
      if (href === null) continue;
      expect(href.external).toBe(false);
      expect(href.href, JSON.stringify(raw)).toMatch(/^\/(?:$|[^/\\])/);
      expect(isSafeRelativePath(href.href), JSON.stringify(raw)).toBe(true);
      const resolved = new URL(href.href, "https://shop.example/pages/x");
      expect(resolved.origin, JSON.stringify(raw)).toBe("https://shop.example");
    }
  });
});

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
