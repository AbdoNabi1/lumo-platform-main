import { describe, expect, it } from "vitest";
import {
  LINK_TARGET_QUERY_MAX,
  PAGE_META_DESCRIPTION_MAX,
  PAGE_TITLE_MAX,
  POLICY_TEMPLATE_LIMITS,
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
