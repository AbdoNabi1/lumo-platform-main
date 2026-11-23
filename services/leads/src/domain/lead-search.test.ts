import { beforeEach, describe, expect, it } from "vitest";
import { leadProps } from "../testing/fixtures";
import { leadMatchesSearch, toLatinDigits } from "./lead-search";

beforeEach(() => {
  expect.hasAssertions();
});

describe("toLatinDigits", () => {
  it("maps Arabic-Indic and Persian digits and leaves the rest", () => {
    expect(toLatinDigits("٠١٠١٢٣٤٥٦٧٨")).toBe("01012345678");
    expect(toLatinDigits("۰۱۲۳۴۵۶۷۸۹ ab")).toBe("0123456789 ab");
  });
});

describe("leadMatchesSearch", () => {
  const props = leadProps();

  it("matches name and email as a case-insensitive substring", () => {
    expect(leadMatchesSearch(props, "أحمد")).toBe(true);
    expect(leadMatchesSearch(props, "A@B")).toBe(true);
    expect(leadMatchesSearch(props, "zzz")).toBe(false);
  });

  it("matches digits of at least 3 against phoneE164, including Arabic digits", () => {
    expect(leadMatchesSearch(props, "1234")).toBe(true);
    expect(leadMatchesSearch(props, "١٢٣٤")).toBe(true);
    expect(leadMatchesSearch(props, "+20 101")).toBe(true);
    expect(leadMatchesSearch(props, "9999")).toBe(false);
  });

  it("does not match digits when fewer than 3 are given", () => {
    expect(leadMatchesSearch(props, "12")).toBe(false);
    expect(leadMatchesSearch(leadProps({ name: "Unit 12" }), "12")).toBe(true);
  });

  it("handles a lead without an email", () => {
    expect(leadMatchesSearch(leadProps({ email: null }), "a@b")).toBe(false);
  });
});
