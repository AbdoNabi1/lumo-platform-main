/**
 * Cross-emitter deduplication (doc 16 §4, D-077).
 *
 * `eventId` is unique per occurrence and is the **ingest** idempotency key. `dedupId` is
 * deterministic and **shared** by the browser and server copies of the same logical occurrence; it
 * is what each destination supplies as that vendor's dedupe field (Meta `event_id`, TikTok
 * `event_id`, GA4 dedupe). Keeping them separate is what lets ingest reject a replayed browser
 * event while still letting Meta collapse the pixel/CAPI pair.
 *
 * Key material derivation is **pure and synchronous** so it is testable without crypto and safe in
 * a browser bundle; hashing is an injected port because Node and the browser expose different
 * SHA-256 APIs.
 */

/** Computes a lowercase hex SHA-256 digest. Implemented per runtime at the composition root. */
export interface HashPort {
  sha256Hex(input: string): Promise<string>;
}

/**
 * Which natural key identifies "the same occurrence" for an event. Chosen per event because the
 * right key differs: an order id is stable and authoritative, whereas a page view has no natural
 * key and must fall back to a time bucket.
 */
export type NaturalKeyStrategy =
  | { readonly kind: "order"; readonly orderId: string }
  | { readonly kind: "cart_line"; readonly cartLineId: string }
  | { readonly kind: "checkout"; readonly checkoutId: string }
  | { readonly kind: "refund"; readonly refundId: string }
  | { readonly kind: "explicit"; readonly key: string }
  | { readonly kind: "session_minute"; readonly sessionId: string };

/** Dedup window in days — matches the platform conversions-API windows (doc 16 §4). */
export const DEDUP_WINDOW_DAYS = 7;

/**
 * Truncates an instant to a one-minute bucket. Only used by the `session_minute` strategy, where
 * two emitters of the same view will agree to the minute but not to the millisecond.
 */
export function minuteBucket(occurredAt: Date): string {
  return occurredAt.toISOString().slice(0, 16);
}

function naturalKeyOf(strategy: NaturalKeyStrategy, occurredAt: Date): string {
  switch (strategy.kind) {
    case "order":
      return `order:${strategy.orderId}`;
    case "cart_line":
      return `cart_line:${strategy.cartLineId}`;
    case "checkout":
      return `checkout:${strategy.checkoutId}`;
    case "refund":
      return `refund:${strategy.refundId}`;
    case "explicit":
      return `explicit:${strategy.key}`;
    case "session_minute":
      return `session:${strategy.sessionId}:${minuteBucket(occurredAt)}`;
  }
}

/**
 * The exact string both emitters hash. Tenant-scoped so two tenants can never collide on a shared
 * natural key, and version-scoped so a schema change starts a fresh dedup namespace rather than
 * silently merging incompatible payloads.
 */
export function dedupKeyMaterial(input: {
  readonly tenantId: string;
  readonly eventName: string;
  readonly eventVersion: number;
  readonly strategy: NaturalKeyStrategy;
  readonly occurredAt: Date;
}): string {
  return [
    input.tenantId,
    input.eventName,
    `v${String(input.eventVersion)}`,
    naturalKeyOf(input.strategy, input.occurredAt),
  ].join("|");
}

/** Derives the shared `dedupId`. Both emitters must pass identical inputs to agree. */
export async function deriveDedupId(
  input: Parameters<typeof dedupKeyMaterial>[0],
  hasher: HashPort,
): Promise<string> {
  return hasher.sha256Hex(dedupKeyMaterial(input));
}

/**
 * Whether an event is still inside the dedup window. Outside it, a repeat is a genuine new
 * occurrence rather than a duplicate — collapsing them would silently drop real conversions.
 */
export function isWithinDedupWindow(occurredAt: Date, now: Date): boolean {
  const age = now.getTime() - occurredAt.getTime();
  return age >= 0 && age <= DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}
