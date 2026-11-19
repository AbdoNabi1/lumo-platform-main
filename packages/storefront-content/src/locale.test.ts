import { describe, expect, it } from "vitest";
import { normalizeLocalizedText, normalizePlainText, pickText, type ContentIssue } from "./locale";

describe("pickText", () => {
  it("prefers the request locale, then the other one, then nothing", () => {
    expect(pickText({ ar: "مرحبا", en: "Hello" }, "en")).toBe("Hello");
    expect(pickText({ ar: "مرحبا" }, "en")).toBe("مرحبا");
    expect(pickText({ en: "Hello" }, "ar")).toBe("Hello");
    expect(pickText({}, "ar")).toBeNull();
    expect(pickText({ ar: "", en: "" }, "ar")).toBeNull();
  });
});

describe("normalizePlainText", () => {
  it("trims, removes control and bidi override characters, and flattens newlines on one line", () => {
    expect(normalizePlainText("  a\u0000b\u202Ec\u2066d\ne  ")).toBe("abcd e");
  });

  it("keeps single newlines in multi-line text and normalises CRLF", () => {
    expect(normalizePlainText("line 1\r\nline 2\u0007", { multiline: true })).toBe(
      "line 1\nline 2",
    );
  });
});

describe("normalizeLocalizedText", () => {
  it("drops empty locales and reports over-long ones by path", () => {
    const issues: ContentIssue[] = [];
    const value = normalizeLocalizedText(
      { ar: "   ", en: "x".repeat(71) },
      { path: "homeTitle", max: 70 },
      issues,
    );
    expect(value).toEqual({ en: "x".repeat(71) });
    expect(issues).toEqual([{ path: "homeTitle.en", code: "TOO_LONG" }]);
  });

  it("rejects unknown keys, non-strings and non-objects", () => {
    const issues: ContentIssue[] = [];
    normalizeLocalizedText({ fr: "x", ar: 3 }, { path: "note", max: 10 }, issues);
    normalizeLocalizedText("text", { path: "other", max: 10 }, issues);
    expect(issues).toEqual([
      { path: "note.fr", code: "UNKNOWN_KEY" },
      { path: "note.ar", code: "INVALID_VALUE" },
      { path: "other", code: "INVALID_VALUE" },
    ]);
  });

  it("a label made only of bidi controls or whitespace is empty", () => {
    const issues: ContentIssue[] = [];
    expect(normalizeLocalizedText({ ar: "\u202B \u202C" }, { path: "p", max: 5 }, issues)).toEqual(
      {},
    );
    expect(issues).toEqual([]);
  });
});
