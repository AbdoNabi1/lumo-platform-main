import type { CheckoutSession } from "./checkout-session";

/** Spec §3.1 decision: an open checkout counts as abandoned once idle this long. */
export const ABANDONED_AFTER_MINUTES = 60;
/** Shopify's page size — and the most order numbers one `listOrders({ ids })` read resolves. */
export const ABANDONED_PAGE_SIZE_MAX = 50;
export const ABANDONED_SEARCH_MAX_LENGTH = 100;
export const RECOVERY_FILTERS = ["recovered", "not_recovered"] as const;
export type RecoveryFilter = (typeof RECOVERY_FILTERS)[number];

/** A session with the two timestamps the aggregate does not carry (its row's columns). */
export interface CheckoutSessionRecord {
  readonly session: CheckoutSession;
  readonly createdAt: Date;
  /** The last change to the session — the list's "last activity". */
  readonly updatedAt: Date;
}

export interface AbandonedCheckoutQuery {
  /** Open sessions count only when last changed before this instant ({@link abandonedBefore}). */
  readonly olderThan: Date;
  readonly first?: number;
  /** Cursor: the id of the last row of the previous page (ids are UUIDv7, time-ordered). */
  readonly after?: string;
  readonly search?: string;
  readonly recovery?: RecoveryFilter;
}

export interface AbandonedCheckoutPage {
  readonly items: readonly CheckoutSessionRecord[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

/**
 * Order operations Part 3: the read side of abandoned checkouts. Its own port (not
 * `CheckoutSessionRepository`) so the many narrow fakes of that port stay valid; both session
 * repositories implement it. ADR-0014: `tenantId` per call.
 */
export interface AbandonedCheckoutQueries {
  /** Abandoned checkouts of one shop ({@link isAbandonedCheckout}), newest first by id. */
  listAbandoned(query: AbandonedCheckoutQuery, tenantId: string): Promise<AbandonedCheckoutPage>;
  /** One session with its timestamps, or null — also for an id that is not a UUID. */
  findRecord(id: string, tenantId: string, tx?: unknown): Promise<CheckoutSessionRecord | null>;
}

export function abandonedBefore(now: Date): Date {
  return new Date(now.getTime() - ABANDONED_AFTER_MINUTES * 60_000);
}

export function isRecovered(session: CheckoutSession): boolean {
  return session.recoveredOrderRef !== undefined;
}

/**
 * Spec §3.1, derived at read time (no job): open (`started`/`locked`), last changed before
 * `olderThan`, at least one item, and an email or a shipping phone to reach the shopper, and not a draft
 * order's checkout (the draft list owns it) — plus every recovered checkout, so it stays listed as "Recovered". `PrismaCheckoutSessionRepository.listAbandoned`
 * is the same rule in SQL; the shared fixture keeps them equal.
 */
export function isAbandonedCheckout(record: CheckoutSessionRecord, olderThan: Date): boolean {
  const { session } = record;
  if (isRecovered(session)) return true;
  return (
    session.draftTerms === undefined &&
    session.state.isOpen &&
    record.updatedAt.getTime() < olderThan.getTime() &&
    session.items.length > 0 &&
    (session.contactEmail !== undefined || session.shippingAddress?.phone !== undefined)
  );
}

export function normalizeAbandonedSearch(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  return trimmed.slice(0, ABANDONED_SEARCH_MAX_LENGTH);
}

export function clampAbandonedPageSize(first: number | undefined): number {
  if (first === undefined || !Number.isFinite(first)) return ABANDONED_PAGE_SIZE_MAX;
  return Math.max(1, Math.min(Math.trunc(first), ABANDONED_PAGE_SIZE_MAX));
}

/** Contact email, recipient name or phone contains `search` — case-insensitive, taken literally. */
export function matchesAbandonedSearch(session: CheckoutSession, search: string): boolean {
  const needle = search.toLowerCase();
  return [
    session.contactEmail?.value,
    session.shippingAddress?.name,
    session.shippingAddress?.phone,
  ].some((value) => value !== undefined && value.toLowerCase().includes(needle));
}
