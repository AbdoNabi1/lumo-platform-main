import { beforeEach, describe, expect, it } from "vitest";
import {
  COMMERCE_SECTION_TYPES,
  SECTION_TYPES,
  type SectionType,
} from "@platform/storefront-content";
import { sectionTypeAllowed } from "./section-availability";

beforeEach(() => {
  expect.hasAssertions();
});

describe("sectionTypeAllowed", () => {
  it.each([
    ["lead_form", "lead_site", true],
    ["lead_form", "store", false],
    ["lead_form", null, false],
    ["featured_products", "lead_site", false],
    ["featured_products", "store", true],
    ["featured_products", null, true],
    ["hero", "lead_site", true],
    ["hero", "store", true],
    ["hero", null, true],
  ] as const)("%s on %s is %s", (type, siteType, allowed) => {
    expect(sectionTypeAllowed(type, siteType)).toBe(allowed);
  });

  it("a lead site is offered every type except the commerce ones", () => {
    const offered: SectionType[] = SECTION_TYPES.filter((type) =>
      sectionTypeAllowed(type, "lead_site"),
    );
    expect(offered).toEqual(
      SECTION_TYPES.filter((type) => !(COMMERCE_SECTION_TYPES as readonly string[]).includes(type)),
    );
    expect(offered).toContain("lead_form");
    expect(offered).toContain("whatsapp_cta");
    expect(offered).toContain("announcement_bar");
  });

  it("a store or an unknown site type is offered every type except the lead form", () => {
    for (const siteType of ["store", null] as const) {
      const offered = SECTION_TYPES.filter((type) => sectionTypeAllowed(type, siteType));
      expect(offered).toEqual(SECTION_TYPES.filter((type) => type !== "lead_form"));
    }
  });
});
