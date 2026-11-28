import type { LeadProps } from "./lead";

/** Fewer digits than this would match almost every phone number, so they never search phones. */
export const MIN_PHONE_SEARCH_DIGITS = 3;

/**
 * Maps Arabic-Indic (U+0660–U+0669) and Persian (U+06F0–U+06F9) digits to `0-9`. A local copy of
 * `toLatinDigits` from `@platform/tracking`: the domain layer may not import that package, and the
 * package does not export it from its public entry either.
 */
export function toLatinDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * Inbox search: a case-insensitive substring of `name` or `email`, or — when the search holds at
 * least three digits — those digits as a substring of the E.164 phone.
 */
export function leadMatchesSearch(
  props: Pick<LeadProps, "name" | "email" | "phoneE164">,
  search: string,
): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  if (props.name.toLowerCase().includes(needle)) return true;
  if (props.email !== null && props.email.toLowerCase().includes(needle)) return true;
  const digits = toLatinDigits(search).replace(/\D/g, "");
  return digits.length >= MIN_PHONE_SEARCH_DIGITS && props.phoneE164.includes(digits);
}
