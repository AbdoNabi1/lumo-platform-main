import { describe, expect, it } from "vitest";
import { validateTemplateDraft, type TemplateDraft, type TemplateIssue } from "./index";

describe("@platform/outreach package entry", () => {
  it("exposes validateTemplateDraft for a passing draft", () => {
    expect.hasAssertions();
    const draft: TemplateDraft = {
      name: "order_shipped",
      language: "en",
      category: "UTILITY",
      body: { text: "Hi {{1}}, your order has shipped.", examples: ["Sara"] },
    };
    expect(validateTemplateDraft(draft)).toEqual([]);
  });

  it("exposes validateTemplateDraft for a failing draft", () => {
    expect.hasAssertions();
    const draft: TemplateDraft = {
      name: "Bad Name",
      language: "en",
      category: "UTILITY",
      body: { text: "Hello there.", examples: [] },
    };
    const issues: TemplateIssue[] = validateTemplateDraft(draft);
    expect(issues).toEqual([{ field: "name", code: "name_format" }]);
  });
});
