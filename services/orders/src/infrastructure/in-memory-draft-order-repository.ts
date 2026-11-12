import { ConcurrencyError, ConflictError } from "@platform/utils";
import {
  clampDraftPageSize,
  DraftOrder,
  isLiveDraftStatus,
  type DraftOrderSnapshot,
} from "../domain/draft-order";
import type {
  DraftOrderPage,
  DraftOrderQuery,
  DraftOrderRepository,
} from "../domain/draft-order-repository";
import { matchesDraftSearch } from "./draft-order-rows";

/** In-memory {@link DraftOrderRepository} keyed by `(tenantId, id)`; the same guards as Prisma's. */
export class InMemoryDraftOrderRepository implements DraftOrderRepository {
  private readonly store = new Map<string, Map<string, DraftOrderSnapshot>>();

  save(draft: DraftOrder, tenantId: string): Promise<void> {
    try {
      let bucket = this.store.get(tenantId);
      if (bucket === undefined) {
        bucket = new Map();
        this.store.set(tenantId, bucket);
      }
      const s = draft.snapshot();
      if (draft.isNew) {
        // The primary key is global; the draft number is unique per shop — like the table's indexes.
        const idTaken = [...this.store.values()].some((rows) => rows.has(s.id));
        const numberTaken = [...bucket.values()].some((row) => row.draftNumber === s.draftNumber);
        if (idTaken || numberTaken) {
          throw new ConflictError("DRAFT_DUPLICATE: a draft with this id or number already exists");
        }
        bucket.set(s.id, s);
        draft.markPersisted();
        return Promise.resolve();
      }
      const stored = bucket.get(s.id);
      if (
        stored === undefined ||
        stored.version !== s.version ||
        stored.deletedAt !== null ||
        !isLiveDraftStatus(stored.status)
      ) {
        throw new ConcurrencyError(
          "VERSION_CONFLICT: this draft order was changed or closed meanwhile",
        );
      }
      bucket.set(s.id, {
        ...stored,
        customerRef: s.customerRef,
        contactEmail: s.contactEmail,
        contactPhone: s.contactPhone,
        shippingAddress: s.shippingAddress,
        billingAddress: s.billingAddress,
        lines: s.lines,
        discount: s.discount,
        shipping: s.shipping,
        note: s.note,
        tags: s.tags,
        updatedAt: s.updatedAt,
        version: stored.version + 1,
      });
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  findById(id: string, tenantId: string): Promise<DraftOrder | null> {
    try {
      const stored = this.store.get(tenantId)?.get(id);
      return Promise.resolve(stored === undefined ? null : DraftOrder.reconstitute(stored));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  list(query: DraftOrderQuery, tenantId: string): Promise<DraftOrderPage> {
    try {
      const first = clampDraftPageSize(query.first);
      const search = query.search;
      const matching = [...(this.store.get(tenantId)?.values() ?? [])]
        .filter((s) => s.deletedAt === null)
        .filter((s) => query.status === undefined || s.status === query.status)
        .filter((s) => search === undefined || matchesDraftSearch(s, search))
        .filter((s) => query.after === undefined || s.id < query.after)
        .sort((a, b) => (a.id < b.id ? 1 : -1));
      const items = matching.slice(0, first).map((s) => DraftOrder.reconstitute(s));
      return Promise.resolve({
        items,
        pageInfo: { hasNextPage: matching.length > first, endCursor: items.at(-1)?.id ?? null },
      });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  markInvoiceSent(id: string, at: Date, tenantId: string): Promise<boolean> {
    return this.guarded(
      id,
      tenantId,
      (s) => isLiveDraftStatus(s.status) && s.deletedAt === null,
      (s) => ({ ...s, status: "invoice_sent", invoiceSentAt: at }),
    );
  }

  markCompleted(
    id: string,
    completion: { readonly orderRef: string; readonly at: Date },
    tenantId: string,
  ): Promise<boolean> {
    return this.guarded(
      id,
      tenantId,
      (s) => isLiveDraftStatus(s.status),
      (s) => ({
        ...s,
        status: "completed",
        orderRef: completion.orderRef,
        completedAt: completion.at,
        deletedAt: null,
      }),
    );
  }

  softDelete(id: string, at: Date, tenantId: string): Promise<boolean> {
    return this.guarded(
      id,
      tenantId,
      (s) => isLiveDraftStatus(s.status) && s.deletedAt === null,
      (s) => ({ ...s, deletedAt: at }),
    );
  }

  setCheckout(
    id: string,
    next: { readonly checkoutRef: string; readonly checkoutVersion: number },
    expectedCheckoutRef: string | null,
    tenantId: string,
  ): Promise<boolean> {
    return this.guarded(
      id,
      tenantId,
      (s) =>
        isLiveDraftStatus(s.status) &&
        s.deletedAt === null &&
        s.checkoutRef === expectedCheckoutRef &&
        s.version === next.checkoutVersion,
      (s) => ({ ...s, checkoutRef: next.checkoutRef, checkoutVersion: next.checkoutVersion }),
    );
  }

  /** Check and write in one synchronous step — no await between them, like one guarded UPDATE. */
  private guarded(
    id: string,
    tenantId: string,
    accept: (s: DraftOrderSnapshot) => boolean,
    change: (s: DraftOrderSnapshot) => DraftOrderSnapshot,
  ): Promise<boolean> {
    try {
      const bucket = this.store.get(tenantId);
      const stored = bucket?.get(id);
      if (bucket === undefined || stored === undefined || !accept(stored)) {
        return Promise.resolve(false);
      }
      bucket.set(id, change(stored));
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
