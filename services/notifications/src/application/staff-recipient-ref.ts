import { createHash } from "node:crypto";

/**
 * A staff recipient on a notification row is a hash of their address, never the address itself
 * (ADR-0006). The provider finds the address again by hashing the store's CURRENT staff list, so a
 * recipient removed between "created" and "sent" simply fails with `RECIPIENT_NOT_FOUND`.
 */
export const STAFF_REF_PREFIX = "staff:";

export function staffRecipientRef(email: string): string {
  const digest = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  return `${STAFF_REF_PREFIX}${digest.slice(0, 16)}`;
}

export function findStaffRecipient(ref: string, emails: readonly string[]): string | null {
  if (!ref.startsWith(STAFF_REF_PREFIX)) return null;
  return emails.find((email) => staffRecipientRef(email) === ref) ?? null;
}
