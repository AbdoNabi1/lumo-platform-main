import { COMMERCE_SECTION_TYPES, type SectionType } from "@platform/storefront-content";
import type { SiteType } from "@/lib/api/store-settings";

/**
 * Which section types the editor's "Add" list offers (Lead Site D3). A lead site gets the lead
 * form and no commerce section; a store, or a shop whose site type could not be read (`null`),
 * gets every type except the lead form. Only the Add list is filtered: a section already on a page
 * stays, and the shared content package stays site-type-agnostic.
 */
export function sectionTypeAllowed(type: SectionType, siteType: SiteType | null): boolean {
  if (siteType === "lead_site")
    return !(COMMERCE_SECTION_TYPES as readonly string[]).includes(type);
  return type !== "lead_form";
}
