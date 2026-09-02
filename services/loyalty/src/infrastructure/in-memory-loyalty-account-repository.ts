import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { LoyaltyAccount } from "../domain/loyalty-account";
import type { LoyaltyAccountRepository } from "../domain/loyalty-account-repository";

export interface InMemoryLoyaltyAccountRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `LoyaltyAccountRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryLoyaltyAccountRepository implements LoyaltyAccountRepository {
  private readonly store = new Map<string, LoyaltyAccount>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLoyaltyAccountRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(account: LoyaltyAccount, tx?: unknown): Promise<void> {
    this.store.set(account.id.toString(), account);
    await this.outbox.write(account.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<LoyaltyAccount | null> {
    return this.store.get(id) ?? null;
  }

  async findByCustomerRef(customerRef: string): Promise<LoyaltyAccount | null> {
    for (const account of this.store.values()) {
      if (account.customerRef === customerRef) return account;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage): Promise<Paginated<LoyaltyAccount>> {
    const all = [...this.store.values()].sort((a, b) =>
      a.id.toString().localeCompare(b.id.toString()),
    );
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
