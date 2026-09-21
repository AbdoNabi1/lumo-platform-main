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
  LoadItems,
  SelectPayment,
  SelectShipping,
  SetBillingAddress,
  SetContactEmail,
  SetShippingAddress,
} from "./application/checkout-details.use-cases";
import {
  GenerateOrderDraft,
  GeneratePaymentIntentRequest,
} from "./application/checkout-handoff.use-cases";
import {
  ExpireCheckout,
  Lock,
  RecalculateTotals,
  RequestShippingQuote,
  RequestTaxCalculation,
  ValidateCheckout,
  ValidatePromotion,
} from "./application/checkout-orchestration.use-cases";
import { CompleteCheckout } from "./application/complete-checkout.use-case";
import { FailCheckout } from "./application/fail-checkout.use-case";
import { GetCheckoutSession } from "./application/get-checkout-session.use-case";
import { StartCheckout } from "./application/start-checkout.use-case";
import type { CheckoutSessionRepository } from "./domain/checkout-session-repository";
import type {
  InventoryValidationPort,
  OrderCreationPort,
  PricingValidationPort,
  PromotionValidationPort,
  ShippingCalculationPort,
  TaxCalculationPort,
} from "./application/ports";
import { CheckoutEventTranslator } from "./infrastructure/checkout-event-translator";
import { InMemoryCheckoutSessionRepository } from "./infrastructure/in-memory-checkout-session-repository";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  InMemoryInventoryValidationAdapter,
  InMemoryPricingValidationAdapter,
  InMemoryPromotionValidationAdapter,
  InMemoryShippingCalculationAdapter,
  InMemoryTaxCalculationAdapter,
} from "./infrastructure/in-memory-orchestration-adapters";
import { InMemoryOrderCreationAdapter } from "./infrastructure/in-memory-order-creation-adapter";
import { PrismaCheckoutSessionRepository } from "./infrastructure/prisma-checkout-session-repository";
import { CheckoutController } from "./interfaces/checkout.controller";

export interface CheckoutWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Stage 5 (audit remediation, C-03 partial): the 5 orchestration ports `ValidateCheckout`/
   * `RequestTaxCalculation`/`RequestShippingQuote`/`ValidatePromotion`/`SelectShipping` call. Same
   * `deps.X ?? new InMemoryXAdapter()` convention as `wireOrders`'s equivalent fields; absent ⇒ the
   * offline in-memory stubs, unchanged from before these fields existed. `apps/runtime/src/api.ts`
   * refuses to boot outside `local` while any of the 5 are still unresolved
   * (`assertProductionIntegrationPortsConfigured`) — until Stage 6 wires real adapters, every
   * non-local boot is expected to fail closed here, on purpose.
   */
  readonly pricingValidation?: PricingValidationPort;
  readonly inventoryValidation?: InventoryValidationPort;
  readonly taxCalculation?: TaxCalculationPort;
  readonly shippingCalculation?: ShippingCalculationPort;
  readonly promotionValidation?: PromotionValidationPort;
  /**
   * C-2: the outbound seam `CompleteCheckout` uses to materialize an order from a completed
   * session. Same `deps.X ?? new InMemoryXAdapter()` convention as the 5 orchestration ports
   * above; absent ⇒ `InMemoryOrderCreationAdapter` (fabricates a deterministic `orderRef`, never
   * persists anything). The real adapter over Orders' `CreateOrderFromCheckout` is a separate task.
   */
  readonly orderCreation?: OrderCreationPort;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaCheckoutSessionRepository` +
   * `PrismaUnitOfWork`; absent ⇒ in-memory, unchanged. The 5 orchestration ports stay in-memory
   * in both branches — reference-only stubs, not persistence, out of scope for C-01. ADR-0014
   * (WP-10, T10.3): the repository built here is a tenant-agnostic singleton — no `tenantId` at
   * composition time any more.
   */
  readonly prisma?: Database;
}

export interface WiredCheckout {
  readonly checkout: CheckoutController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `CheckoutController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  sessions: CheckoutSessionRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: CheckoutWiringDeps,
): CheckoutController {
  const pricingValidation = deps.pricingValidation ?? new InMemoryPricingValidationAdapter();
  const inventoryValidation = deps.inventoryValidation ?? new InMemoryInventoryValidationAdapter();
  const taxCalculation = deps.taxCalculation ?? new InMemoryTaxCalculationAdapter();
  const shippingCalculation = deps.shippingCalculation ?? new InMemoryShippingCalculationAdapter();
  const promotionValidation = deps.promotionValidation ?? new InMemoryPromotionValidationAdapter();
  const orderCreation = deps.orderCreation ?? new InMemoryOrderCreationAdapter();

  return new CheckoutController({
    startCheckout: new StartCheckout({ sessions, unitOfWork, idGenerator: deps.idGenerator }),
    getCheckoutSession: new GetCheckoutSession({ sessions }),
    completeCheckout: new CompleteCheckout({
      sessions,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      orderCreation,
    }),
    failCheckout: new FailCheckout({
      sessions,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    loadItems: new LoadItems({ sessions, unitOfWork }),
    setBillingAddress: new SetBillingAddress({ sessions, unitOfWork }),
    setShippingAddress: new SetShippingAddress({ sessions, unitOfWork }),
    setContactEmail: new SetContactEmail({ sessions, unitOfWork }),
    selectShipping: new SelectShipping({ sessions, unitOfWork, shippingCalculation }),
    selectPayment: new SelectPayment({ sessions, unitOfWork }),
    validateCheckout: new ValidateCheckout({ sessions, pricingValidation, inventoryValidation }),
    requestTaxCalculation: new RequestTaxCalculation({
      sessions,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      taxCalculation,
    }),
    requestShippingQuote: new RequestShippingQuote({ sessions, shippingCalculation }),
    validatePromotion: new ValidatePromotion({
      sessions,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      promotionValidation,
    }),
    recalculateTotals: new RecalculateTotals({
      sessions,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    lock: new Lock({ sessions, unitOfWork, idGenerator: deps.idGenerator, clock: deps.clock }),
    expireCheckout: new ExpireCheckout({
      sessions,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    generateOrderDraft: new GenerateOrderDraft({ sessions }),
    generatePaymentIntentRequest: new GeneratePaymentIntentRequest({ sessions }),
  });
}

/**
 * Composition root for the Checkout context. Prisma slice (`PrismaCheckoutSessionRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory, including offline stubs for the 5
 * orchestration ports (production swaps these for the Pricing/Inventory/Finance/Shipping/
 * Promotions adapters, or the ADR-0012 saga's own activities — untouched by this change).
 */
export function wireCheckout(deps: CheckoutWiringDeps): WiredCheckout {
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new CheckoutEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "checkout",
    });
    // ADR-0014, WP-10 T10.3: no tenantId at composition time — every repository takes it per
    // call and merges it into the event context at write time.
    const context = rootEventContext(deps.idGenerator);
    const sessions = new PrismaCheckoutSessionRepository({ prisma: deps.prisma, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      checkout: buildController(sessions, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new CheckoutEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "checkout",
  });
  const context = rootEventContext(deps.idGenerator);

  const sessions = new InMemoryCheckoutSessionRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(sessions, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  bus.subscribe("checkout.checkout_session.completed.v1", sink);
  bus.subscribe("checkout.checkout_session.failed.v1", sink);
  bus.subscribe("checkout.checkout_session.recalculated.v1", sink);
  bus.subscribe("checkout.checkout_session.locked.v1", sink);
  bus.subscribe("checkout.checkout_session.expired.v1", sink);

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    checkout: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
