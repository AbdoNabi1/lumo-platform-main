import type { FieldIssue } from "@/lib/api/client";
import type { Dictionary } from "@/messages/en";

/** A link field's url inside a section: `.buttonLink.url`, `.link.url` (items too). */
const LINK_URL_PATH = /\.(?:buttonLink|link)\.url$/;

/**
 * The API's 422 codes as copy, keyed by document path; the path `""` is the whole document
 * (`DOCUMENT_TOO_LARGE`). Server text never reaches the page. Social links have their own wording
 * for the two codes that differ there (the encoded 500-character limit, Ruling 5), and the codes a
 * section save adds (Part 3) read as the section copy. Pure; types only from `lib/api`.
 */
export function themeFieldErrors(
  t: Dictionary,
  fields: readonly FieldIssue[],
): Record<string, string> {
  const c = t.onlineStoreCustomize;
  const s = t.onlineStoreSections.errors;
  const copyByCode: Readonly<Record<string, string>> = {
    IMAGE_NOT_FOUND: t.onlineStorePreferences.imageNotFound,
    INVALID_URL: t.onlineStoreErrors.invalidUrl,
    TOO_LONG: t.onlineStorePreferences.tooLong,
    INVALID_COLOR: t.onlineStoreErrors.invalidColor,
    OUT_OF_RANGE: t.onlineStoreErrors.outOfRange,
    CONTRAST_TOO_LOW: c.contrastBlocked,
    DOCUMENT_TOO_LARGE: t.onlineStoreErrors.documentTooLarge,
    TARGET_NOT_FOUND: s.targetNotFound,
    TOO_MANY_SECTIONS: s.tooManySections,
    TOO_MANY_OF_TYPE: s.tooManyOfType,
    SECTION_NOT_ALLOWED_HERE: s.notAllowedHere,
    DUPLICATE_SECTION_ID: s.duplicateSection,
    INVALID_PHONE: s.invalidPhone,
    UNSAFE_LINK: t.richText.unsafeLinkSaved,
    TOO_FEW_ITEMS: s.tooFewItems,
    TOO_MANY_ITEMS: s.tooManyItems,
    DUPLICATE_VALUE: s.duplicateValue,
    INVALID_LINK: s.invalidLink,
  };
  const socialCopy: Readonly<Record<string, string>> = {
    INVALID_URL: c.socialInvalid,
    TOO_LONG: c.socialTooLong,
  };
  const errors: Record<string, string> = {};
  for (const { field, message: code } of fields) {
    const social = field.startsWith("brand.social.") ? socialCopy[code] : undefined;
    const inSection =
      field.startsWith("homepage.sections.") || field.startsWith("header.announcement");
    const sectionSpecific =
      inSection && code === "IMAGE_NOT_FOUND"
        ? s.imageNotFound
        : inSection && code === "INVALID_URL" && LINK_URL_PATH.test(field)
          ? t.onlineStoreNavigation.urlError
          : undefined;
    errors[field] = social ?? sectionSpecific ?? copyByCode[code] ?? t.formErrors.invalid;
  }
  return errors;
}
