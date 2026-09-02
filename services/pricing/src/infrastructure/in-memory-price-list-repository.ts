import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { PriceList } from "../domain/price-list";
import type { PriceListRepository } from "../domain/price-list-repository";

export interface InMemoryPriceListRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `PriceListRepository`. Uses the same outbox-on-save pattern for uniformity; price lists
 * currently raise no events, so the outbox write is a no-op until they do.
 */
export class InMemoryPriceListRepository implements PriceListRepository {
  private readonly store = new Map<string, PriceList>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryPriceListRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(priceList: PriceList, tx?: unknown): Promise<void> {
    this.store.set(priceList.id.toString(), priceList);
    await this.outbox.write(priceList.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<PriceList | null> {
    return this.store.get(id) ?? null;
  }
}
