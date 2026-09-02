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
import { GetReview } from "./application/get-review.use-case";
import { ListReviewsByProduct } from "./application/list-reviews-by-product.use-case";
import { ListReviews } from "./application/list-reviews.use-case";
import type { OrdersPort } from "./application/ports";
import {
  AdvanceReview,
  CreateReview,
  ModerateReview,
  ReportReview,
  RespondToReview,
  VoteReview,
} from "./application/review.use-cases";
import type { ReviewRepository } from "./domain/review-repository";
import {
  InMemoryOrdersPort,
  InMemoryProcessedModerationStore,
} from "./infrastructure/in-memory-port-adapters";
import { InMemoryReviewRepository } from "./infrastructure/in-memory-review-repository";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaReviewRepository } from "./infrastructure/prisma-review-repository";
import {
  REVIEWS_PUBLISHED_EVENTS,
  ReviewsEventTranslator,
} from "./infrastructure/reviews-event-translator";
import { ReviewsController } from "./interfaces/reviews.controller";

export interface ReviewsWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Defaults to the in-memory stub (always "not purchased") until a real cross-context adapter is wired (deferred, G-39). */
  readonly orders?: OrdersPort;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaReviewRepository` + `PrismaUnitOfWork`
   * (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/`wireReporting`); absent ⇒
   * in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Reviews table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredReviews {
  readonly reviews: ReviewsController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `ReviewsController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  reviews: ReviewRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: ReviewsWiringDeps,
): ReviewsController {
  const orders = deps.orders ?? new InMemoryOrdersPort();
  const processedModerations = new InMemoryProcessedModerationStore();

  const reviewDeps = { reviews, unitOfWork, idGenerator: deps.idGenerator, clock: deps.clock };

  return new ReviewsController({
    createReview: new CreateReview({ ...reviewDeps, orders }),
    advanceReview: new AdvanceReview(reviewDeps),
    voteReview: new VoteReview(reviewDeps),
    reportReview: new ReportReview(reviewDeps),
    respondToReview: new RespondToReview(reviewDeps),
    moderateReview: new ModerateReview({ ...reviewDeps, processedModerations }),
    listReviews: new ListReviews({ reviews }),
    getReview: new GetReview({ reviews }),
    listReviewsByProduct: new ListReviewsByProduct({ reviews }),
  });
}

/**
 * Composition root for the Reviews context. Prisma slice (`PrismaReviewRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireReviews(deps: ReviewsWiringDeps): WiredReviews {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireReviews: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new ReviewsEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "reviews",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const reviews = new PrismaReviewRepository({ prisma: deps.prisma, tenantId, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      reviews: buildController(reviews, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new ReviewsEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "reviews",
  });
  const context = rootEventContext(deps.idGenerator);

  const reviews = new InMemoryReviewRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(reviews, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of REVIEWS_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    reviews: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
