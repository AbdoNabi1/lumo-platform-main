import type { Dictionary } from "@/messages/en";

/**
 * Pure helpers for Settings → Email, shared by the server action and the client components (no server-only imports).
 */

/** A deliberately loose address check for instant feedback; the API (zod `email()`) is authoritative. */
export const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const EMAIL_MAX_LENGTH = 254;

export function isPlausibleEmail(value: string): boolean {
  return value.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(value);
}

/** The same address in one canonical form, to compare "the same recipient". */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** True when the copy has a dedicated sentence for this feature rejection code (provider codes fall to generic). */
export function isKnownEmailCode(code: unknown, t: Dictionary): code is string {
  return (
    typeof code === "string" && code !== "generic" && Object.hasOwn(t.emailSettings.errors, code)
  );
}

/** The localised sentence for an allowlisted code; generic copy for everything else. Never provider text. */
export function emailErrorMessage(code: unknown, t: Dictionary): string {
  const errors: Readonly<Record<string, string>> = t.emailSettings.errors;
  return isKnownEmailCode(code, t)
    ? (errors[code] ?? t.emailSettings.errors.generic)
    : t.emailSettings.errors.generic;
}

/** Splits the API's `"<display name> <address>"`; a value that doesn't fit the shape is the name alone. */
export function parseSender(from: string | null): {
  readonly name: string | null;
  readonly address: string | null;
} {
  if (from === null) return { name: null, address: null };
  const match = /^(.*?)\s*<([^<>\s]+)>\s*$/.exec(from);
  if (match === null) return { name: from.length > 0 ? from : null, address: null };
  const name = (match[1] ?? "").trim();
  return { name: name.length > 0 ? name : null, address: match[2] ?? null };
}
