import type { DraftOrder, DraftOrderStatus } from "./draft-order";

export interface DraftOrderQuery {
  readonly status?: DraftOrderStatus;
  /** Draft number, contact email/phone, recipient name/phone (Ruling 16); already normalized. */
  readonly search?: string;
  readonly first?: number;
  /** Cursor: the id of the last row of the previous page (UUIDv7, time-ordered). */
  readonly after?: string;
}

export interface DraftOrderPage {
  readonly items: readonly DraftOrder[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

/**
 * Persistence port for {@link DraftOrder} (order operations Part 4). ADR-0014: `tenantId` per call;
 * writes need the unit of work's `tx`. Ruling 2: `save` writes CONTENT only (version-checked); every
 * status/checkout/deletion change is its own guarded update that never bumps `version`.
 */
export interface DraftOrderRepository {
  /**
   * Inserts a new draft (`draft.isNew`), or writes a loaded draft's CONTENT where `version` still
   * matches and the draft is neither completed nor deleted (bumping `version`); otherwise throws
   * `ConcurrencyError("VERSION_CONFLICT: …")`.
   */
  save(draft: DraftOrder, tenantId: string, tx?: unknown): Promise<void>;
  /** One draft of this shop, INCLUDING a deleted one (the caller decides); null for a non-UUID id. */
  findById(id: string, tenantId: string, tx?: unknown): Promise<DraftOrder | null>;
  /** This shop's drafts that are not deleted, newest first by id. */
  list(query: DraftOrderQuery, tenantId: string): Promise<DraftOrderPage>;
  /** open|invoice_sent and not deleted → invoice_sent at `at`; false otherwise. */
  markInvoiceSent(id: string, at: Date, tenantId: string, tx?: unknown): Promise<boolean>;
  /** open|invoice_sent → completed with the order, clearing `deletedAt` (Ruling 17); false otherwise. */
  markCompleted(
    id: string,
    completion: { readonly orderRef: string; readonly at: Date },
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean>;
  /** open|invoice_sent and not deleted → deleted at `at`; false otherwise. */
  softDelete(id: string, at: Date, tenantId: string, tx?: unknown): Promise<boolean>;
  /**
   * Compare-and-set (Ruling 3): records the materialised session only while `checkout_ref` is still
   * `expectedCheckoutRef`, the draft is still at `next.checkoutVersion` (the version the session was
   * built from; an edit since refuses it, Task 7 I-1) and it is open|invoice_sent and not deleted.
   */
  setCheckout(
    id: string,
    next: { readonly checkoutRef: string; readonly checkoutVersion: number },
    expectedCheckoutRef: string | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean>;
}

/** Spec §4.2 decision: `D1`, `D2`, … per shop, in the draft's own transaction. */
export interface DraftNumberAllocator {
  next(tenantId: string, tx?: unknown): Promise<string>;
}
