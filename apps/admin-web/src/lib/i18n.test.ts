import { describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { DEFAULT_LOCALE, dictionaryFor, directionFor, isLocale, LOCALES } from "./i18n";

/**
 * Localisation guarantees. The dictionaries are structurally typed against each other, so
 * a *missing* key is already a compile error — what a test can still catch is a key that
 * was copied across without being translated, and a direction that stops following the
 * locale.
 */

type Leaf = readonly [path: string, value: string];

function leaves(value: unknown, path: string[] = []): Leaf[] {
  if (typeof value === "string") return [[path.join("."), value]];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => leaves(child, [...path, key]));
}

/** Keys whose Arabic value is legitimately identical to English (keyboard glyphs, symbols). */
const SHARED_VERBATIM = new Set([
  "topbar.searchHint",
  "securityAuditPage.timelineColumns.sequence",
  // The ISO-8601 format token an operator must type literally into the `effectiveFrom`/
  // `effectiveTo` text inputs (`app/pricing/page.tsx`) — a machine format string, not natural
  // language, so it stays identical in both locales, same rationale as `topbar.searchHint`'s
  // "Ctrl K" above.
  "pricingPage.datetimePlaceholder",
  // T5.9a — the three `ContentBlock` body format names (`ContentCreateForm`'s format `<select>`).
  // "HTML"/"Markdown"/"JSON" are technical format identifiers, not natural-language words, and are
  // conventionally left untransliterated in Arabic UI copy — same rationale as the entries above.
  "contentCreateForm.formatHtml",
  "contentCreateForm.formatMarkdown",
  "contentCreateForm.formatJson",
  // T5.12d — the 5 `ComplianceFramework` enum labels (`securityOperationsRoutes`'s
  // `complianceFrameworkEnum`, rendered by `EvaluateCompliancePanel`/`RegisterComplianceRuleForm`'s
  // framework `<select>`s). GDPR/SOC 2/ISO 27001/HIPAA/PCI DSS are internationally recognized
  // regulatory/standard names, conventionally left untransliterated in Arabic UI copy — same
  // rationale as the format-name entries above.
  "securityAuditPage.frameworks.gdpr",
  "securityAuditPage.frameworks.soc2",
  "securityAuditPage.frameworks.iso27001",
  "securityAuditPage.frameworks.hipaa",
  "securityAuditPage.frameworks.pci_dss",
  // T5.12e — 4 of the 11 `AuthMethodKind` enum labels and 2 of the 5 `MfaMethodKind` enum labels
  // (`security-sessions-routes.ts`'s `authMethodKindEnum`/`mfaMethodKindEnum`, rendered by
  // `RegisterAuthMethodForm`/`AuthenticatePanel`/`EnrollMfaForm`/`RegisterMfaMethodForm`'s `<select>`s).
  // OAuth/OIDC/SAML/LDAP/TOTP/WebAuthn are internationally recognized protocol/standard names,
  // conventionally left untransliterated in Arabic UI copy — same rationale as the framework-name
  // entries above.
  "securitySessionsPage.authMethodKinds.oauth",
  "securitySessionsPage.authMethodKinds.oidc",
  "securitySessionsPage.authMethodKinds.saml",
  "securitySessionsPage.authMethodKinds.ldap",
  "securitySessionsPage.mfaMethodKinds.totp",
  "securitySessionsPage.mfaMethodKinds.webauthn",
  // T5.12f — 3 raw-JSON example placeholders (`PublishPolicyVersionRowForm`'s `rules`,
  // `CheckAccessPanel`'s `abac`, `RegisterPolicyFragmentForm`'s `expression` textareas). These are
  // machine-syntax JSON snippets typed verbatim into the field, not natural language, so they stay
  // identical in both locales — same rationale as `pricingPage.datetimePlaceholder` above.
  "securityAccessPage.publishPolicyVersion.rulesPlaceholder",
  "securityAccessPage.checkAccess.abacPlaceholder",
  "securityAccessPage.registerPolicyFragment.expressionPlaceholder",
]);

describe("locales", () => {
  it("offers exactly the two validated locales, defaulting to English", () => {
    expect([...LOCALES]).toEqual(["en", "ar"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("recognises supported locales and rejects anything else", () => {
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("derives writing direction from the locale", () => {
    expect(directionFor("en")).toBe("ltr");
    expect(directionFor("ar")).toBe("rtl");
  });

  it("resolves each locale to its own dictionary", () => {
    expect(dictionaryFor("en")).toBe(en);
    expect(dictionaryFor("ar")).toBe(ar);
  });
});

describe("Arabic dictionary", () => {
  const englishLeaves = leaves(en);
  const arabicByPath = new Map(leaves(ar));

  it("covers every English key", () => {
    const missing = englishLeaves.filter(([path]) => !arabicByPath.has(path)).map(([p]) => p);
    expect(missing).toEqual([]);
  });

  it("is actually translated, not copied", () => {
    const untranslated = englishLeaves
      .filter(([path, value]) => !SHARED_VERBATIM.has(path) && arabicByPath.get(path) === value)
      .map(([path]) => path);
    expect(untranslated).toEqual([]);
  });

  it("preserves every interpolation placeholder", () => {
    const placeholders = (value: string) => (value.match(/\{[a-zA-Z]+\}/g) ?? []).sort();

    for (const [path, english] of englishLeaves) {
      const arabic = arabicByPath.get(path);
      expect(arabic, `missing Arabic for ${path}`).toBeDefined();
      expect(placeholders(arabic ?? ""), `placeholder mismatch at ${path}`).toEqual(
        placeholders(english),
      );
    }
  });
});
