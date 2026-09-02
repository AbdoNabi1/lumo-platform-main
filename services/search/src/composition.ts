import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork, type Database } from "@platform/db";
import type { EventSerializer } from "@platform/domain-events";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
  type Subscriber,
} from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { GetIndex } from "./application/get-index.use-case";
import { ListIndexes } from "./application/list-indexes.use-case";
import type { IndexProviderPort } from "./application/ports";
import {
  AddSuggestion,
  AddSynonym,
  AdvanceIndex,
  CreateIndex,
  DeleteDocument,
  LogQuery,
  RemoveSynonym,
  UpsertDocument,
} from "./application/search.use-cases";
import type { SearchIndexRepository } from "./domain/search-index-repository";
import { InMemoryIndexProvider } from "./infrastructure/in-memory-index-provider";
import { InMemorySearchIndexRepository } from "./infrastructure/in-memory-search-index-repository";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaSearchIndexRepository } from "./infrastructure/prisma-search-index-repository";
import {
  SEARCH_PUBLISHED_EVENTS,
  SearchEventTranslator,
} from "./infrastructure/search-event-translator";
import { SearchController } from "./interfaces/search.controller";

export interface SearchWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Defaults to the in-memory stub until the real OpenSearch/pgvector adapter is wired (ADR-0020). */
  readonly provider?: IndexProviderPort;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaSearchIndexRepository` +
   * `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/
   * `wireReviews`); absent ⇒ in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Search table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredSearch {
  readonly search: SearchController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `SearchController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  indexes: SearchIndexRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: SearchWiringDeps,
): SearchController {
  const provider = deps.provider ?? new InMemoryIndexProvider();

  const searchDeps = { indexes, unitOfWork, idGenerator: deps.idGenerator, clock: deps.clock };

  return new SearchController({
    createIndex: new CreateIndex(searchDeps),
    advanceIndex: new AdvanceIndex(searchDeps),
    upsertDocument: new UpsertDocument({ ...searchDeps, provider }),
    deleteDocument: new DeleteDocument({ ...searchDeps, provider }),
    addSynonym: new AddSynonym(searchDeps),
    removeSynonym: new RemoveSynonym(searchDeps),
    addSuggestion: new AddSuggestion(searchDeps),
    logQuery: new LogQuery(searchDeps),
    listIndexes: new ListIndexes({ indexes }),
    getIndex: new GetIndex({ indexes }),
  });
}

/**
 * Composition root for the Search context. Prisma slice (`PrismaSearchIndexRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireSearch(deps: SearchWiringDeps): WiredSearch {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireSearch: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new SearchEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "search",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const indexes = new PrismaSearchIndexRepository({
      prisma: deps.prisma,
      tenantId,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      search: buildController(indexes, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new SearchEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "search",
  });
  const context = rootEventContext(deps.idGenerator);

  const indexes = new InMemorySearchIndexRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(indexes, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of SEARCH_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    search: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
