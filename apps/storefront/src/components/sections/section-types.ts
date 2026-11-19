import type { PublicSettingsByType, SectionType } from "@platform/storefront-content";

/** One section type's public settings. */
export type Settings<T extends SectionType> = PublicSettingsByType[T];
