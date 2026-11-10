import { describe, expect, it } from "vitest";
import { applyMarkup, richTextIssues, richTextLength } from "./markup";

describe("applyMarkup (spec 2.7 toolbar)", () => {
  it("bold and italic wrap the selection and keep it selected", () => {
    expect(applyMarkup("a big sale", { start: 2, end: 5 }, "bold")).toEqual({
      text: "a **big** sale",
      selection: { start: 4, end: 7 },
    });
    expect(applyMarkup("x", { start: 0, end: 1 }, "italic").text).toBe("*x*");
  });
  it("headings prefix the current line; lists prefix every selected line", () => {
    expect(applyMarkup("one\ntwo", { start: 5, end: 5 }, "h2").text).toBe("one\n## two");
    expect(applyMarkup("a\nb\nc", { start: 0, end: 3 }, "bullets").text).toBe("- a\n- b\nc");
    expect(applyMarkup("a\nb", { start: 0, end: 3 }, "numbers").text).toBe("1. a\n2. b");
  });
  it("link wraps the selection and selects the url placeholder", () => {
    const out = applyMarkup("call us", { start: 0, end: 7 }, "link");
    expect(out.text).toBe("[call us](https://)");
    expect(out.text.slice(out.selection.start, out.selection.end)).toBe("https://");
  });

  it("a selected address becomes the link, a path percent-encoded by the shared link rules", () => {
    const path = "/pages/من-نحن";
    const out = applyMarkup(path, { start: 0, end: path.length }, "link");
    expect(out.text).toBe(`[${path}](/pages/${encodeURIComponent("من-نحن")})`);
    expect(richTextIssues(out.text, 100)).toEqual([]);
    expect(out.text.slice(out.selection.start, out.selection.end)).toBe(path);
    // An address the rules refuse is just a label.
    expect(applyMarkup("javascript:x", { start: 0, end: 12 }, "link").text).toBe(
      "[javascript:x](https://)",
    );
  });
  it("an empty selection inserts the markers with the caret between them", () => {
    const out = applyMarkup("ab", { start: 1, end: 1 }, "bold");
    expect(out).toEqual({ text: "a****b", selection: { start: 3, end: 3 } });
  });
  it("markup never spans lines (Ruling 8): each selected line is wrapped on its own", () => {
    expect(applyMarkup("one\ntwo", { start: 0, end: 7 }, "bold").text).toBe("**one**\n**two**");
  });
  it("keeps spaces at the edges of a selection outside the markers", () => {
    expect(applyMarkup("a big sale", { start: 1, end: 6 }, "italic").text).toBe("a *big* sale");
  });
  it("a heading switches level, and the same heading again removes it", () => {
    expect(applyMarkup("### Returns", { start: 4, end: 4 }, "h2").text).toBe("## Returns");
    const off = applyMarkup("## Returns", { start: 4, end: 4 }, "h2");
    expect(off).toEqual({ text: "Returns", selection: { start: 1, end: 1 } });
  });
  it("a list over lines that are already that list removes the markers", () => {
    expect(applyMarkup("- a\n- b", { start: 0, end: 7 }, "bullets").text).toBe("a\nb");
    expect(applyMarkup("- a\n- b", { start: 0, end: 7 }, "numbers").text).toBe("1. a\n2. b");
  });
  it("a selection ending at the start of a line leaves that line alone", () => {
    expect(applyMarkup("a\nb", { start: 0, end: 2 }, "bullets").text).toBe("- a\nb");
  });
});

describe("richTextIssues (the shared validator, as the merchant sees the lines)", () => {
  it("reports each unsafe link once with its line", () => {
    expect(richTextIssues("ok\n[x](javascript:alert(1))\n[y](https://a.example)", 100)).toEqual([
      { code: "UNSAFE_LINK", line: 2 },
    ]);
  });
  it("counts the text as it will be stored (normalised), and flags TOO_LONG past the limit", () => {
    expect(richTextLength("  abc  \n")).toBe(3);
    expect(richTextIssues("a".repeat(11), 10)).toEqual([{ code: "TOO_LONG", line: 0 }]);
    // Spaces the API trims do not count against the limit.
    expect(richTextIssues(`  ${"a".repeat(10)}  `, 10)).toEqual([]);
  });
  it("keeps line numbers of the textarea even when leading blank lines are trimmed on save", () => {
    expect(richTextIssues("\n\n[x](javascript:1)", 100)).toEqual([
      { code: "UNSAFE_LINK", line: 3 },
    ]);
  });
});
