import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { LoyaltyAccount } from "../domain/loyalty-account";
import type { LoyaltyAccountRepository } from "../domain/loyalty-account-repository";

export interface InMemoryLoyaltyAccountRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `LoyaltyAccountRepository`. Persists the aggregate and writes events to the outbox on
 * save. ADR-0014 (WP-10, T10.3): keyed by `(tenantId, accountId)` — `LoyaltyAccount` carries no
 * `tenantId` of its own, so the store must key on it explicitly or a cross-tenant leak here would
 * be invisible to every isolation test.
 */
export class InMemoryLoyaltyAccountRepository implements LoyaltyAccountRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly account: LoyaltyAccount }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLoyaltyAccountRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(account: LoyaltyAccount, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(account.id.toString(), { tenantId, account });
    await this.outbox.write(account.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<LoyaltyAccount | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.account : null;
  }

  async findByCustomerRef(customerRef: string, tenantId: string): Promise<LoyaltyAccount | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.account.customerRef === customerRef) {
        return entry.account;
      }
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage, tenantId: string): Promise<Paginated<LoyaltyAccount>> {
    const all = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.account)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
