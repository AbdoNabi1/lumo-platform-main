import { describe, expect, it } from "vitest";
import {
  isPolicyType,
  POLICY_SLUGS,
  POLICY_TITLES,
  POLICY_TYPES,
  policyPath,
  policyTypeOfSlug,
} from "./policies";

describe("policies (spec 2.3)", () => {
  it("the five types sit at Shopify's URLs", () => {
    expect(POLICY_TYPES.map(policyPath)).toEqual([
      "/policies/refund-policy",
      "/policies/shipping-policy",
      "/policies/privacy-policy",
      "/policies/terms-of-service",
      "/policies/contact-information",
    ]);
  });
  it("the titles are the spec's table", () => {
    expect(POLICY_TITLES.refund).toEqual({ ar: "سياسة الاسترجاع", en: "Refund policy" });
    expect(POLICY_TITLES.contact).toEqual({ ar: "معلومات التواصل", en: "Contact information" });
  });
  it("maps a slug back to its type, and nothing else (Ruling 7)", () => {
    for (const type of POLICY_TYPES) expect(policyTypeOfSlug(POLICY_SLUGS[type])).toBe(type);
    for (const slug of [
      "refund",
      "Refund-Policy",
      "refund-policy/",
      "../refund-policy",
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
      "",
    ]) {
      expect(policyTypeOfSlug(slug), slug).toBeNull();
    }
  });
  it("isPolicyType accepts exactly the five types", () => {
    for (const type of POLICY_TYPES) expect(isPolicyType(type)).toBe(true);
    for (const bad of ["cookies", "constructor", "__proto__", "", null, 1]) {
      expect(isPolicyType(bad), String(bad)).toBe(false);
    }
  });
});

describe("policy constants are frozen", () => {
  it("cannot be mutated by an importer", () => {
    expect(Object.isFrozen(POLICY_TYPES)).toBe(true);
    expect(Object.isFrozen(POLICY_SLUGS)).toBe(true);
    expect(Object.isFrozen(POLICY_TITLES)).toBe(true);
    for (const type of POLICY_TYPES) expect(Object.isFrozen(POLICY_TITLES[type])).toBe(true);
  });
});
