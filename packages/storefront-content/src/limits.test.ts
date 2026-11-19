import { describe, expect, it } from "vitest";
import {
  CATALOG_REF_TEXT_MAX,
  CATALOG_SLUG_PATTERN,
  IMAGE_ALT_MAX,
  LINK_TARGET_QUERY_MAX,
  PAGE_META_DESCRIPTION_MAX,
  PAGE_TITLE_MAX,
  POLICY_TEMPLATE_LIMITS,
  SECTION_FOCUS_MESSAGE,
  SECTION_PREVIEW_READY_MESSAGE,
} from "./index";

describe("shared limits", () => {
  it("keeps the spec numbers", () => {
    expect(PAGE_TITLE_MAX).toBe(255);
    expect(PAGE_META_DESCRIPTION_MAX).toBe(320);
    expect(LINK_TARGET_QUERY_MAX).toBe(100);
    expect(POLICY_TEMPLATE_LIMITS.text).toEqual({
      storeName: 120,
      contactEmail: 254,
      contactPhone: 30,
      businessAddress: 500,
    });
    expect(POLICY_TEMPLATE_LIMITS.returnWindowDays).toEqual([0, 365]);
    expect(POLICY_TEMPLATE_LIMITS.deliveryMin).toEqual([1, 60]);
    expect(POLICY_TEMPLATE_LIMITS.deliveryMaxCap).toBe(90);
  });
});

describe("shared storefront constants (F5, F12)", () => {
  it("keeps one copy of the alt cap, the focus message and the catalog ref cap", () => {
    expect(IMAGE_ALT_MAX).toBe(300);
    expect(SECTION_FOCUS_MESSAGE).toBe("morbeh:focus-section");
    expect(SECTION_PREVIEW_READY_MESSAGE).toBe("morbeh:preview-ready");
    expect(CATALOG_REF_TEXT_MAX).toBe(200);
  });

  it("the catalog slug rule: lower-case words joined by single hyphens, nothing else", () => {
    for (const slug of ["sale", "summer-sale-2026", "a1"]) {
      expect(CATALOG_SLUG_PATTERN.test(slug), slug).toBe(true);
    }
    const bad = ["", "Sale", "-sale", "sale-", "a--b", "../..//evil.example", "a/b", "a b"];
    for (const slug of bad) {
      expect(CATALOG_SLUG_PATTERN.test(slug), slug).toBe(false);
    }
  });
});
