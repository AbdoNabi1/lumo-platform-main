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
import {
  AdvanceContentBlock,
  CreateContentBlock,
  ListContentBlocks,
  UpdateContentBody,
} from "./application/content.use-cases";
import type { ContentBlockRepository } from "./domain/repositories";
import {
  CONTENT_PUBLISHED_EVENTS,
  ContentEventTranslator,
} from "./infrastructure/content-event-translator";
import { InMemoryContentBlockRepository } from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaContentBlockRepository } from "./infrastructure/prisma-repositories";
import { ContentController } from "./interfaces/content.controller";

export interface ContentWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaContentBlockRepository` +
   * `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/
   * `wireSearch`); absent ⇒ in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Content table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredContent {
  readonly content: ContentController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `ContentController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  blocks: ContentBlockRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: ContentWiringDeps,
): ContentController {
  const contentDeps = { blocks, unitOfWork, idGenerator: deps.idGenerator, clock: deps.clock };

  return new ContentController({
    createContentBlock: new CreateContentBlock(contentDeps),
    advanceContentBlock: new AdvanceContentBlock(contentDeps),
    updateContentBody: new UpdateContentBody(contentDeps),
    listContentBlocks: new ListContentBlocks({ blocks }),
  });
}

/**
 * Composition root for the Content context. Prisma slice (`PrismaContentBlockRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireContent(deps: ContentWiringDeps): WiredContent {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireContent: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new ContentEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "content",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const blocks = new PrismaContentBlockRepository({
      prisma: deps.prisma,
      tenantId,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      content: buildController(blocks, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new ContentEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "content",
  });
  const context = rootEventContext(deps.idGenerator);

  const blocks = new InMemoryContentBlockRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(blocks, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of CONTENT_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    content: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
