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
import { GetModel } from "./application/get-model.use-case";
import { ListModels } from "./application/list-models.use-case";
import type { SearchQueryPort } from "./application/ports";
import {
  AdvanceModel,
  CreateModel,
  GenerateRecommendationSet,
  RegenerateRecommendationSet,
} from "./application/recommendation.use-cases";
import type { RecommendationModelRepository } from "./domain/recommendation-model-repository";
import {
  InMemoryProcessedInteractionStore,
  InMemorySearchQueryPort,
} from "./infrastructure/in-memory-port-adapters";
import { InMemoryRecommendationModelRepository } from "./infrastructure/in-memory-recommendation-model-repository";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaRecommendationModelRepository } from "./infrastructure/prisma-recommendation-model-repository";
import {
  RECOMMENDATIONS_PUBLISHED_EVENTS,
  RecommendationsEventTranslator,
} from "./infrastructure/recommendations-event-translator";
import { RecommendationsController } from "./interfaces/recommendations.controller";

export interface RecommendationsWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Defaults to the in-memory stub until a real cross-context adapter is wired (deferred, G-39). */
  readonly search?: SearchQueryPort;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaRecommendationModelRepository` +
   * `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/
   * `wirePromotions`); absent ⇒ in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Recommendations table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredRecommendations {
  readonly recommendations: RecommendationsController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `RecommendationsController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  models: RecommendationModelRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: RecommendationsWiringDeps,
): RecommendationsController {
  const search = deps.search ?? new InMemorySearchQueryPort();
  const processedInteractions = new InMemoryProcessedInteractionStore();

  const modelDeps = { models, unitOfWork, idGenerator: deps.idGenerator, clock: deps.clock };

  return new RecommendationsController({
    createModel: new CreateModel(modelDeps),
    advanceModel: new AdvanceModel(modelDeps),
    generateSet: new GenerateRecommendationSet({ ...modelDeps, search, processedInteractions }),
    regenerateSet: new RegenerateRecommendationSet({ ...modelDeps, search }),
    listModels: new ListModels({ models }),
    getModel: new GetModel({ models }),
  });
}

/**
 * Composition root for the Recommendations context. Prisma slice
 * (`PrismaRecommendationModelRepository` + `PrismaUnitOfWork`) when `prisma` is present; else
 * in-memory.
 */
export function wireRecommendations(deps: RecommendationsWiringDeps): WiredRecommendations {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error(
        "wireRecommendations: tenantId is required when prisma is provided (ADR-0008).",
      );
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new RecommendationsEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "recommendations",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const models = new PrismaRecommendationModelRepository({
      prisma: deps.prisma,
      tenantId,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      recommendations: buildController(models, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new RecommendationsEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "recommendations",
  });
  const context = rootEventContext(deps.idGenerator);

  const models = new InMemoryRecommendationModelRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(models, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of RECOMMENDATIONS_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    recommendations: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
