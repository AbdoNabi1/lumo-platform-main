import { describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import type { Dictionary } from "@/messages/en";
import { ALL_FIXTURES, FAILING_FIXTURES, PASSING_FIXTURES } from "./template-rules.fixtures";
import {
  bodyVariableCount,
  nextVariableToken,
  slugifyLabel,
  substituteExamples,
  TEMPLATE_ISSUE_CODES,
  validateTemplateDraft,
} from "./template-rules";

describe("template rules (browser mirror) against the Task 2 fixtures", () => {
  it.each(PASSING_FIXTURES.map((f) => [f.name, f] as const))("accepts %s", (_name, fixture) => {
    expect.hasAssertions();
    expect(validateTemplateDraft(fixture.draft)).toEqual([]);
  });

  it.each(FAILING_FIXTURES.map((f) => [f.name, f] as const))(
    "rejects %s with the exact issues",
    (_name, fixture) => {
      expect.hasAssertions();
      expect(validateTemplateDraft(fixture.draft)).toEqual(fixture.issues);
    },
  );

  it("every failing fixture really fails and every passing one is clean", () => {
    expect.hasAssertions();
    expect(ALL_FIXTURES.length).toBeGreaterThan(80);
    expect(FAILING_FIXTURES.every((f) => f.issues.length > 0)).toBe(true);
    expect(PASSING_FIXTURES.every((f) => f.issues.length === 0)).toBe(true);
  });
});

describe("issue-code dictionary coverage", () => {
  it.each([
    ["en", en],
    ["ar", ar],
  ] as const)("has a message for every Task 2 issue code in %s", (_locale, t: Dictionary) => {
    expect.hasAssertions();
    const issues: Readonly<Record<string, string>> = t.whatsappTemplates.issues;
    for (const code of TEMPLATE_ISSUE_CODES) {
      expect(issues[code], code).toBeTypeOf("string");
      expect((issues[code] ?? "").length, code).toBeGreaterThan(5);
    }
    expect(issues["unknown"]).toBeTypeOf("string");
  });

  it("the code list covers every code the fixtures can produce, plus the ones the Task 2 amendment added", () => {
    expect.hasAssertions();
    const produced = new Set(ALL_FIXTURES.flatMap((f) => f.issues.map((i) => i.code)));
    for (const code of produced) expect(TEMPLATE_ISSUE_CODES, code).toContain(code);
    for (const code of [
      "variable_malformed",
      "variables_adjacent",
      "example_empty",
      "header_example_missing",
      "button_text_empty",
      "url_too_long",
    ]) {
      expect(TEMPLATE_ISSUE_CODES, code).toContain(code);
    }
  });

  it("the two dictionaries differ for every issue message (nothing was copied untranslated)", () => {
    expect.hasAssertions();
    const enIssues: Readonly<Record<string, string>> = en.whatsappTemplates.issues;
    const arIssues: Readonly<Record<string, string>> = ar.whatsappTemplates.issues;
    for (const code of [...TEMPLATE_ISSUE_CODES, "unknown"]) {
      expect(arIssues[code], code).not.toBe(enIssues[code]);
    }
  });
});

describe("template helpers", () => {
  it.each([
    ["Order Shipped", "order_shipped"],
    ["  Order   shipped!  ", "order_shipped"],
    ["Sale — 20% off", "sale_20_off"],
    ["طلبك اتشحن", ""],
    ["Mix عربي and English 2", "mix_and_english_2"],
  ])("slugifies %j to %j", (label, name) => {
    expect.hasAssertions();
    expect(slugifyLabel(label)).toBe(name);
  });

  it("proposes the next variable after the highest used index", () => {
    expect.hasAssertions();
    expect(nextVariableToken("")).toBe("{{1}}");
    expect(nextVariableToken("Hi {{1}} and {{2}}")).toBe("{{3}}");
    expect(nextVariableToken("Hi {{2}}")).toBe("{{3}}");
    expect(nextVariableToken("Hi {{1}} {{1}}")).toBe("{{2}}");
  });

  it("counts distinct variables", () => {
    expect.hasAssertions();
    expect(bodyVariableCount("Hi {{1}}, {{2}} and {{1}}")).toBe(2);
  });

  it("substitutes each example into its variable and leaves a missing one visible", () => {
    expect.hasAssertions();
    expect(substituteExamples("Hi {{1}}, order {{2}} for {{1}}", ["Sara", "1001"])).toBe(
      "Hi Sara, order 1001 for Sara",
    );
    expect(substituteExamples("Hi {{1}}, order {{2}}", ["Sara"])).toBe("Hi Sara, order {{2}}");
    expect(substituteExamples("Hi {{1}}", ["  "])).toBe("Hi {{1}}");
  });
});
