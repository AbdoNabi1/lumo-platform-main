import { describe, expect, it } from "vitest";
import { normalizeLocalizedText, normalizePlainText, type ContentIssue } from "./locale";

describe("normalizePlainText, multi-line", () => {
  it("folds every Unicode line terminator into a newline", () => {
    expect(normalizePlainText("a\u2028b\u2029c\u0085d\re", { multiline: true })).toBe(
      "a\nb\nc\nd\ne",
    );
  });

  it("removes controls other than the newline", () => {
    expect(normalizePlainText("a\u0000b\u000Bc\u007Fd\te\nf", { multiline: true })).toBe(
      "abcde\nf",
    );
  });
});

describe("normalizePlainText, lone surrogates", () => {
  it.each([false, true])("replaces them with U+FFFD (multiline %s)", (multiline) => {
    expect(normalizePlainText("a\ud800b\udc00c", { multiline })).toBe("a\uFFFDb\uFFFDc");
  });

  it("keeps a valid pair (an emoji)", () => {
    expect(normalizePlainText("ok \u{1F600}")).toBe("ok \u{1F600}");
  });
});

describe("normalizeLocalizedText key handling", () => {
  it("always returns ar before en whatever the input order", () => {
    const issues: ContentIssue[] = [];
    const value = normalizeLocalizedText({ en: "e", ar: "س" }, { path: "p", max: 5 }, issues);
    expect(Object.keys(value)).toEqual(["ar", "en"]);
  });

  it("truncates echoed key names and bounds the issue count", () => {
    const issues: ContentIssue[] = [];
    const raw: Record<string, string> = { ["k".repeat(10_000)]: "x" };
    for (let i = 0; i < 5000; i += 1) raw[`k${i}`] = "x";
    normalizeLocalizedText(raw, { path: "note", max: 5 }, issues);
    expect(issues.length).toBeLessThanOrEqual(50);
    for (const issue of issues) expect(issue.path.length).toBeLessThanOrEqual(80);
  });
});
