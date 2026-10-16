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
import { CreateReturnRequest } from "./application/create-return-request.use-case";
import { GetReturnByOrder } from "./application/get-return-by-order.use-case";
import {
  AcceptItems,
  AdvanceReturn,
  DecideApproval,
  DecideResolution,
  GenerateRma,
  InspectItems,
  ReceivePackage,
} from "./application/return-lifecycle.use-cases";
import type { PaymentsPort, RefundVerificationPort } from "./application/ports";
import type { ReturnRequestRepository } from "./domain/return-request-repository";
import { InMemoryReturnRequestRepository } from "./infrastructure/in-memory-return-request-repository";
import {
  InMemoryInventoryAdapter,
  InMemoryNotificationAdapter,
  InMemoryOrdersAdapter,
  InMemoryPaymentsAdapter,
  InMemoryRefundVerificationAdapter,
  InMemoryShippingAdapter,
} from "./infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaReturnRequestRepository } from "./infrastructure/prisma-return-request-repository";
import {
  RETURNS_PUBLISHED_EVENTS,
  ReturnsEventTranslator,
} from "./infrastructure/returns-event-translator";
import { ReturnsController } from "./interfaces/returns.controller";

export interface ReturnsWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaReturnRequestRepository` +
   * `PrismaUnitOfWork`; absent ⇒ in-memory, unchanged. The 4 reference-only outbound ports stay
   * in-memory in both branches — out of scope for C-01. `ReceivePackage`'s warehouse-callback dedup
   * (Phase A.18) is no longer a separate port — it reads `ReturnRequest.attempts` directly, so it
   * is automatically Prisma-backed and tx-scoped whenever the aggregate itself is. ADR-0014 (WP-10,
   * T10.3): the repository built here is a tenant-agnostic singleton — no `tenantId` at
   * composition time any more.
   */
  readonly prisma?: Database;
  /**
   * Gates `DecideResolution`'s staff-decided refund amount against the order's refundable ceiling
   * (Phase A.1, F-04). Passed straight through to `DecideResolution` below; defaults to Returns'
   * own always-verify in-memory stub when absent — no behavior change for existing callers.
   */
  readonly refundVerification?: RefundVerificationPort;
  /**
   * Executes an approved refund against Payments (Phase A.3). Passed straight through to
   * `DecideResolution` below; defaults to Returns' own offline no-op stub when absent — no
   * behavior change for existing callers/tests. Unlike `refundVerification` (a read-only bound
   * check), this is the actual write side effect: production wires it to a real adapter that
   * reaches Payments' own `RefundPaymentLifecycle` (see `apps/runtime/src/composition.ts`,
   * `PrismaPaymentsPortAdapter`).
   */
  readonly paymentsPort?: PaymentsPort;
}

export interface WiredReturns {
  readonly returns: ReturnsController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `ReturnsController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  returns: ReturnRequestRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: ReturnsWiringDeps,
): ReturnsController {
  const ordersPort = new InMemoryOrdersAdapter();
  const notifications = new InMemoryNotificationAdapter();
  const paymentsPort = deps.paymentsPort ?? new InMemoryPaymentsAdapter();
  const inventoryPort = new InMemoryInventoryAdapter();
  const shippingPort = new InMemoryShippingAdapter();
  const refundVerification = deps.refundVerification ?? new InMemoryRefundVerificationAdapter();

  const lifecycleDeps = {
    returns,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
    ordersPort,
    notifications,
  };

  return new ReturnsController({
    createReturnRequest: new CreateReturnRequest({
      returns,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    decideApproval: new DecideApproval(lifecycleDeps),
    generateRma: new GenerateRma(lifecycleDeps),
    receivePackage: new ReceivePackage({
      ...lifecycleDeps,
      shippingPort,
    }),
    inspectItems: new InspectItems(lifecycleDeps),
    acceptItems: new AcceptItems({ ...lifecycleDeps, inventoryPort }),
    advanceReturn: new AdvanceReturn(lifecycleDeps),
    decideResolution: new DecideResolution({ ...lifecycleDeps, paymentsPort, refundVerification }),
    getReturnByOrder: new GetReturnByOrder({ returnRequests: returns }),
  });
}

/**
 * Composition root for the Returns context. Prisma slice (`PrismaReturnRequestRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory, including the 4 reference-only
 * outbound ports (production swaps these for the real Orders/Payments/Inventory/Shipping adapters
 * at the composition root — untouched by this change).
 */
export function wireReturns(deps: ReturnsWiringDeps): WiredReturns {
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new ReturnsEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "returns",
    });
    // ADR-0014, WP-10 T10.3: no tenantId at composition time — every repository takes it per
    // call and merges it into the event context at write time.
    const context = rootEventContext(deps.idGenerator);
    const returns = new PrismaReturnRequestRepository({ prisma: deps.prisma, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      returns: buildController(returns, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new ReturnsEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "returns",
  });
  const context = rootEventContext(deps.idGenerator);

  const returns = new InMemoryReturnRequestRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(returns, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of RETURNS_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    returns: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
