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
  AdvanceCoupon,
  CreateCoupon,
  ListCoupons,
  RedeemCoupon,
} from "./application/coupon.use-cases";
import type { PromotionsPort } from "./application/ports";
import type { CouponRepository } from "./domain/coupon-repository";
import {
  CouponsEventTranslator,
  COUPONS_PUBLISHED_EVENTS,
} from "./infrastructure/coupons-event-translator";
import { InMemoryCouponRepository } from "./infrastructure/in-memory-coupon-repository";
import { InMemoryPromotionsPort } from "./infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaCouponRepository } from "./infrastructure/prisma-coupon-repository";
import { CouponsController } from "./interfaces/coupons.controller";

export interface CouponsWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Defaults to the in-memory stub (always-active) until a real cross-context adapter is wired (deferred, G-39). */
  readonly promotions?: PromotionsPort;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaCouponRepository` + `PrismaUnitOfWork`;
   * absent ⇒ in-memory, unchanged. ADR-0014 (WP-10, T10.3): the repository built here is a
   * tenant-agnostic singleton — no `tenantId` at composition time any more.
   */
  readonly prisma?: Database;
}

export interface WiredCoupons {
  readonly coupons: CouponsController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `CouponsController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  coupons: CouponRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: CouponsWiringDeps,
): CouponsController {
  const promotions = deps.promotions ?? new InMemoryPromotionsPort();

  const couponDeps = { coupons, unitOfWork, idGenerator: deps.idGenerator, clock: deps.clock };

  return new CouponsController({
    createCoupon: new CreateCoupon(couponDeps),
    advanceCoupon: new AdvanceCoupon(couponDeps),
    redeemCoupon: new RedeemCoupon({ ...couponDeps, promotions }),
    listCoupons: new ListCoupons({ coupons }),
  });
}

/**
 * Composition root for the Coupons context. Prisma slice (`PrismaCouponRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireCoupons(deps: CouponsWiringDeps): WiredCoupons {
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new CouponsEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "coupons",
    });
    // ADR-0014, WP-10 T10.3: no tenantId at composition time any more (see CouponsWiringDeps' doc
    // comment) — the repository built below takes tenantId per call instead.
    const context = rootEventContext(deps.idGenerator);
    const coupons = new PrismaCouponRepository({ prisma: deps.prisma, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      coupons: buildController(coupons, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new CouponsEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "coupons",
  });
  const context = rootEventContext(deps.idGenerator);

  const coupons = new InMemoryCouponRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(coupons, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of COUPONS_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    coupons: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
