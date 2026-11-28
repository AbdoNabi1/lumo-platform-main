/**
 * The id a business event travels under on the bus (P2-D5).
 *
 * `eventId` of a business envelope is NOT the business id (`ord_<id>`, `lead_<id>`); that is the `dedupId`. The
 * `eventId` is a UUID derived from the tenant and the business id, so the same occurrence always gets the same one:
 * a redelivered order event is the same outbox row (`skipDuplicates`), the same inbox key and the same event record.
 *
 * This is byte-for-byte the algorithm of `trackingMessageId` in `apps/admin/src/http/public-tracking-routes.ts`
 * (a test pins the equality), so a business event and a browser event with the same id share one namespace.
 */

import { sha256Bytes } from "./sha256";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function businessMessageId(tenantId: string, eventId: string): string {
  if (UUID.test(eventId)) return eventId.toLowerCase();
  const bytes = sha256Bytes(`${tenantId}\u0000${eventId}`).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5 layout
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
