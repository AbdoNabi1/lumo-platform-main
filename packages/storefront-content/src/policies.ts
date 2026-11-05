/**
 * The five store policies (spec 2.3): fixed types at Shopify's URLs. The slug lookup scans the
 * list and compares exactly, so an untrusted string (`constructor`, `__proto__`) never indexes an
 * object (Ruling 7).
 */

export const POLICY_TYPES = ["refund", "shipping", "privacy", "terms", "contact"] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

export function isPolicyType(value: unknown): value is PolicyType {
  return typeof value === "string" && (POLICY_TYPES as readonly string[]).includes(value);
}

export const POLICY_SLUGS: Readonly<Record<PolicyType, string>> = {
  refund: "refund-policy",
  shipping: "shipping-policy",
  privacy: "privacy-policy",
  terms: "terms-of-service",
  contact: "contact-information",
};

/** Modern Standard Arabic and English titles (Ruling 28). */
export const POLICY_TITLES: Readonly<
  Record<PolicyType, { readonly ar: string; readonly en: string }>
> = {
  refund: { ar: "سياسة الاسترجاع", en: "Refund policy" },
  shipping: { ar: "سياسة الشحن", en: "Shipping policy" },
  privacy: { ar: "سياسة الخصوصية", en: "Privacy policy" },
  terms: { ar: "شروط الخدمة", en: "Terms of service" },
  contact: { ar: "معلومات التواصل", en: "Contact information" },
};

export function policyTypeOfSlug(slug: string): PolicyType | null {
  for (const type of POLICY_TYPES) {
    if (POLICY_SLUGS[type] === slug) return type;
  }
  return null;
}

export function policyPath(type: PolicyType): string {
  return `/policies/${POLICY_SLUGS[type]}`;
}
