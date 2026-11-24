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

  it("does not re-export the test harness from the package root", async () => {
    expect.hasAssertions();
    const root = (await import("./index")) as Record<string, unknown>;
    expect(Object.keys(root)).not.toContain("createMetaFetchHarness");
  });

  it("exposes the composition entry points the runtime needs", async () => {
    expect.hasAssertions();
    const root = (await import("./index")) as Record<string, unknown>;
    expect(typeof root.wireOutreach).toBe("function");
    expect(typeof root.wireOutreachRecovery).toBe("function");
    expect(typeof root.OutreachController).toBe("function");
  });

  it("publishes the production adapters, the vault and the signature verifier (and not the test kits)", async () => {
    expect.hasAssertions();
    const root = (await import("./index")) as Record<string, unknown>;
    for (const name of [
      "MetaGraphClient",
      "MetaApiError",
      "ResendEmailClient",
      "EnvelopeOutreachCredentialVault",
      "InMemoryOutreachCredentialVault",
      "verifyMetaSignature",
    ]) {
      expect(typeof root[name], name).toBe("function");
    }
    expect(root.OUTREACH_CREDENTIALS_KEY_ALIAS).toBe("outreach-credentials");
    expect(root.DEFAULT_EMAIL_CAPS).toEqual({ perHour: 200, perDay: 2000 });
    expect(root.DEFAULT_UNRESOLVED_AFTER_MS).toBe(300_000);
    for (const name of [
      "FakeWhatsAppPort",
      "FakeClock",
      "createOutreachKit",
      "createMetaFetchHarness",
    ]) {
      expect(Object.keys(root), name).not.toContain(name);
    }
  });
});
