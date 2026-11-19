import type { LocalizedText } from "@platform/storefront-content";

/**
 * A copy of merchant text that lists its locales, so nothing else on a stored value can ride along
 * into a response. Shared by the admin and the public page DTOs so both keep the same locales.
 */
export function localizedCopy(text: LocalizedText): LocalizedText {
  return {
    ...(text.ar === undefined ? {} : { ar: text.ar }),
    ...(text.en === undefined ? {} : { en: text.en }),
  };
}
