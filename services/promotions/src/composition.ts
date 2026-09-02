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
import { GetPromotion } from "./application/get-promotion.use-case";
import { ListPromotions } from "./application/list-promotions.use-case";
import {
  AdvancePromotion,
  CreatePromotion,
  EvaluatePromotions,
  RecordPromotionUsage,
} from "./application/promotion.use-cases";
import type { PromotionRepository } from "./domain/promotion-repository";
import { InMemoryPromotionRepository } from "./infrastructure/in-memory-promotion-repository";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaPromotionRepository } from "./infrastructure/prisma-promotion-repository";
import {
  PROMOTIONS_PUBLISHED_EVENTS,
  PromotionsEventTranslator,
} from "./infrastructure/promotions-event-translator";
import { PromotionsController } from "./interfaces/promotions.controller";

export interface PromotionsWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaPromotionRepository` +
   * `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/
   * `wireAutomation`); absent ⇒ in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Promotions table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredPromotions {
  readonly promotions: PromotionsController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `PromotionsController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  promotions: PromotionRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: PromotionsWiringDeps,
): PromotionsController {
  const promotionDeps = {
    promotions,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };

  return new PromotionsController({
    createPromotion: new CreatePromotion(promotionDeps),
    advancePromotion: new AdvancePromotion(promotionDeps),
    evaluatePromotions: new EvaluatePromotions(promotionDeps),
    recordPromotionUsage: new RecordPromotionUsage(promotionDeps),
    listPromotions: new ListPromotions({ promotions }),
    getPromotion: new GetPromotion({ promotions }),
  });
}

/**
 * Composition root for the Promotions context. Prisma slice (`PrismaPromotionRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wirePromotions(deps: PromotionsWiringDeps): WiredPromotions {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wirePromotions: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new PromotionsEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "promotions",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const promotions = new PrismaPromotionRepository({
      prisma: deps.prisma,
      tenantId,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      promotions: buildController(promotions, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new PromotionsEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "promotions",
  });
  const context = rootEventContext(deps.idGenerator);

  const promotions = new InMemoryPromotionRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(promotions, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of PROMOTIONS_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    promotions: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
