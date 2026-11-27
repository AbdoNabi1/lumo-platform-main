import type { Dictionary } from "@/messages/en";

/**
 * The text for a console read the API refused. A 403 means "signed in, but the security console is
 * for the store owner only" (an invited admin gets it from every `security:*` route); anything else
 * keeps the screen's own sign-in message. `status` is only present on a 403, so a 401 (an expired
 * session) never reads as "owner only".
 */
export function ownerOnlyOr(
  result: { readonly status?: number },
  t: Dictionary,
  fallback: string,
): string {
  return result.status === 403 ? t.securityOwnerOnly.message : fallback;
}
