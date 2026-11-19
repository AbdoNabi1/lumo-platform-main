import type { LocalizedText } from "@platform/storefront-content";

/**
 * Argument checks shared by the Online Store server actions. A server action is a public
 * endpoint, so every argument is checked as untrusted. Server-safe: no `lib/api` import.
 */

/** A version the API could have issued: a whole number, zero or more. */
export const isVersion = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** `{ ar?, en? }` with string values only, or null for anything else (an untrusted caller). */
export function localizedOf(raw: unknown): LocalizedText | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { ar, en, ...rest } = raw as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (ar !== undefined && typeof ar !== "string") return null;
  if (en !== undefined && typeof en !== "string") return null;
  return { ...(ar === undefined ? {} : { ar }), ...(en === undefined ? {} : { en }) };
}
