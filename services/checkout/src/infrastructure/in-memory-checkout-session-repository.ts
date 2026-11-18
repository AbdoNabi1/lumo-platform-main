import type { Clock } from "@platform/contracts";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import {
  clampAbandonedPageSize,
  isAbandonedCheckout,
  isRecovered,
  matchesAbandonedSearch,
  normalizeAbandonedSearch,
  type AbandonedCheckoutPage,
  type AbandonedCheckoutQueries,
  type AbandonedCheckoutQuery,
  type CheckoutSessionRecord,
} from "../domain/abandoned-checkouts";
import type { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";

export interface InMemoryCheckoutSessionRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
  /** Order operations Part 3: stamps created/updated times like Prisma's columns; wall clock by default. */
  readonly clock?: Clock;
}

interface Times {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** In-memory `CheckoutSessionRepository`. Persists the aggregate and writes events to the outbox on save. ADR-0014 (WP-10, T10.3): keyed by `(tenantId, id)`. */
export class InMemoryCheckoutSessionRepository
  implements CheckoutSessionRepository, AbandonedCheckoutQueries
{
  private readonly store = new Map<string, Map<string, CheckoutSession>>();
  private readonly times = new Map<string, Map<string, Times>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;
  private readonly clock: Clock;

  constructor(deps: InMemoryCheckoutSessionRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
    this.clock = deps.clock ?? { now: () => new Date() };
  }

  async save(session: CheckoutSession, tenantId: string, tx?: unknown): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    const id = session.id.toString();
    bucket.set(id, session);

    let times = this.times.get(tenantId);
    if (times === undefined) {
      times = new Map();
      this.times.set(tenantId, times);
    }
    const now = this.clock.now();
    times.set(id, { createdAt: times.get(id)?.createdAt ?? now, updatedAt: now });

    await this.outbox.write(session.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<CheckoutSession | null> {
    return this.store.get(tenantId)?.get(id) ?? null;
  }

  findRecord(id: string, tenantId: string): Promise<CheckoutSessionRecord | null> {
    try {
      return Promise.resolve(this.recordOf(id, tenantId));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  listAbandoned(query: AbandonedCheckoutQuery, tenantId: string): Promise<AbandonedCheckoutPage> {
    try {
      const search = normalizeAbandonedSearch(query.search);
      const first = clampAbandonedPageSize(query.first);
      const matching = [...(this.store.get(tenantId)?.keys() ?? [])]
        .map((id) => this.recordOf(id, tenantId))
        .filter((record): record is CheckoutSessionRecord => record !== null)
        .filter((record) => isAbandonedCheckout(record, query.olderThan))
        .filter(
          (record) =>
            query.recovery === undefined ||
            (query.recovery === "recovered") === isRecovered(record.session),
        )
        .filter((record) => search === undefined || matchesAbandonedSearch(record.session, search))
        .filter((record) => query.after === undefined || record.session.id.toString() < query.after)
        .sort((a, b) => (a.session.id.toString() < b.session.id.toString() ? 1 : -1));
      const items = matching.slice(0, first);
      return Promise.resolve({
        items,
        pageInfo: {
          hasNextPage: matching.length > first,
          endCursor: items.at(-1)?.session.id.toString() ?? null,
        },
      });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private recordOf(id: string, tenantId: string): CheckoutSessionRecord | null {
    const session = this.store.get(tenantId)?.get(id);
    const times = this.times.get(tenantId)?.get(id);
    return session === undefined || times === undefined ? null : { session, ...times };
  }
}
