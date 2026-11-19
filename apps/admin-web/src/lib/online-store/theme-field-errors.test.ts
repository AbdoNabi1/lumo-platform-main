import { beforeEach, describe, expect, it } from "vitest";
import { en } from "@/messages/en";
import { themeFieldErrors } from "./theme-field-errors";

beforeEach(() => expect.hasAssertions());

const t = en as never as Parameters<typeof themeFieldErrors>[0];
const one = (field: string, message: string) => themeFieldErrors(t, [{ field, message }])[field];
const e = (en as unknown as { onlineStoreSections: { errors: Record<string, string> } })
  .onlineStoreSections.errors;

describe("themeFieldErrors", () => {
  it("maps each section save code to its copy, keyed by path", () => {
    const p = "homepage.sections.1.settings.collection";
    expect(one(p, "TARGET_NOT_FOUND")).toBe(e["targetNotFound"]);
    expect(one("homepage.sections.0.settings.image", "IMAGE_NOT_FOUND")).toBe(e["imageNotFound"]);
    expect(one("homepage.sections", "TOO_MANY_SECTIONS")).toBe(e["tooManySections"]);
    expect(one("homepage.sections.2", "TOO_MANY_OF_TYPE")).toBe(e["tooManyOfType"]);
    expect(one("homepage.sections.2", "SECTION_NOT_ALLOWED_HERE")).toBe(e["notAllowedHere"]);
    expect(one("homepage.sections.2.id", "DUPLICATE_SECTION_ID")).toBe(e["duplicateSection"]);
    expect(one("homepage.sections.2.settings.phone", "INVALID_PHONE")).toBe(e["invalidPhone"]);
    expect(one("homepage.sections.2.settings.body", "UNSAFE_LINK")).toBe(
      en.richText.unsafeLinkSaved,
    );
    expect(one("homepage.sections.2.settings.items", "TOO_FEW_ITEMS")).toBe(e["tooFewItems"]);
    expect(one("homepage.sections.2.settings.items", "TOO_MANY_ITEMS")).toBe(e["tooManyItems"]);
    expect(one("homepage.sections.2.settings.products.1", "DUPLICATE_VALUE")).toBe(
      e["duplicateValue"],
    );
    expect(one("homepage.sections.2.settings.buttonLink.type", "INVALID_LINK")).toBe(
      e["invalidLink"],
    );
  });

  it("uses the navigation url copy for a section link url, the generic one elsewhere", () => {
    expect(one("homepage.sections.2.settings.buttonLink.url", "INVALID_URL")).toBe(
      en.onlineStoreNavigation.urlError,
    );
    expect(one("homepage.sections.2.settings.items.0.link.url", "INVALID_URL")).toBe(
      en.onlineStoreNavigation.urlError,
    );
    expect(one("brand.logoUrl", "INVALID_URL")).toBe(en.onlineStoreErrors.invalidUrl);
  });

  it("keeps the Part 1 codes and falls back for an unknown one", () => {
    expect(one("brand.colors.primary", "INVALID_COLOR")).toBe(en.onlineStoreErrors.invalidColor);
    expect(one("brand.logo", "IMAGE_NOT_FOUND")).toBe(en.onlineStorePreferences.imageNotFound);
    expect(one("brand.social.facebook", "INVALID_URL")).toBe(en.onlineStoreCustomize.socialInvalid);
    expect(one("homepage.sections.1.settings.count", "OUT_OF_RANGE")).toBe(
      en.onlineStoreErrors.outOfRange,
    );
    expect(one("", "DOCUMENT_TOO_LARGE")).toBe(en.onlineStoreErrors.documentTooLarge);
    expect(one("x", "WHAT")).toBe(en.formErrors.invalid);
  });
});
