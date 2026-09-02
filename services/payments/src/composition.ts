import type { Clock, IdGenerator, PaymentProvider } from "@platform/contracts";
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
import { CapturePayment } from "./application/capture-payment.use-case";
import { CreatePaymentIntent } from "./application/create-payment-intent.use-case";
import { FailPayment } from "./application/fail-payment.use-case";
import { GetPaymentIntent } from "./application/get-payment-intent.use-case";
import {
  AdvancePayment,
  AuthorizePayment,
  CapturePaymentLifecycle,
  CreatePaymentIntentLifecycle,
  RefundPaymentLifecycle,
} from "./application/payment-lifecycle.use-cases";
import { RecordWebhook } from "./application/record-webhook.use-case";
import { RefundPayment } from "./application/refund-payment.use-case";
import type {
  FinancePort,
  NotificationPort,
  OrdersPort,
  ProcessedWebhookStore,
} from "./application/ports";
import type { PaymentIntentRepository } from "./domain/payment-intent-repository";
import { InMemoryPaymentIntentRepository } from "./infrastructure/in-memory-payment-intent-repository";
import {
  InMemoryFinanceAdapter,
  InMemoryNotificationAdapter,
  InMemoryOrdersAdapter,
  InMemoryPaymentProvider,
  InMemoryProcessedWebhookStore,
} from "./infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  PAYMENTS_PUBLISHED_EVENTS,
  PaymentEventTranslator,
} from "./infrastructure/payment-event-translator";
import { PrismaPaymentIntentRepository } from "./infrastructure/prisma-payment-intent-repository";
import { PrismaProcessedWebhookStore } from "./infrastructure/prisma-processed-webhook-store";
import { PaymentController } from "./interfaces/payment.controller";

export interface PaymentsWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaPaymentIntentRepository` +
   * `PrismaUnitOfWork` + `PrismaProcessedWebhookStore` (same `prisma?`/`tenantId?`-presence
   * convention as `wireOrders`/`wireFinance`); absent ⇒ in-memory, unchanged. `ordersPort`/
   * `financePort`/`notifications` stay in-memory in both branches — reference-only outbound ports,
   * not persistence, out of scope for C-01.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Payments table is tenant-scoped. */
  readonly tenantId?: string;
  /**
   * Production PSP adapter (C2-2). Absent ⇒ `InMemoryPaymentProvider` — the offline stub whose
   * `verifyWebhook()` always returns `true` and whose money operations no-op. Same `deps.X ?? default`
   * convention as `payments`/`financeLedger` in Licensing's composition root; `apps/runtime` refuses
   * to boot outside `local` without a real one injected here.
   */
  readonly paymentProvider?: PaymentProvider;
  /**
   * Stage 5 (audit remediation, C-03 partial): the 3 outbound reference-only ports the payment
   * lifecycle use-cases call. Same `deps.X ?? new InMemoryXAdapter()` convention as
   * `paymentProvider` above; absent ⇒ the offline in-memory stubs, unchanged from before these
   * fields existed. Named distinctly from `OrdersWiringDeps.notifications` (a structurally
   * different `NotificationPort`) to avoid a field-type collision where `AdminWiringDeps` threads
   * one shared `deps` object into both `wireOrders(deps)` and `wirePayments(deps)` — same
   * disambiguation the codebase already applies to `paymentsPort` (Returns) vs. `payments`
   * (Licensing). `apps/runtime/src/api.ts` refuses to boot outside `local` while any of the 3 are
   * still unresolved (`assertProductionIntegrationPortsConfigured`) — until Stage 6 wires real
   * adapters, every non-local boot is expected to fail closed here, on purpose.
   */
  readonly ordersPort?: OrdersPort;
  readonly financePort?: FinancePort;
  readonly paymentsNotifications?: NotificationPort;
}

export interface WiredPayments {
  readonly payments: PaymentController;
  /**
   * The PSP port (C2-2/C2-6). Exposed so the webhook HTTP ingress (`payments-webhook-routes.ts`) can
   * call `verifyWebhook` itself — a webhook has no admin Bearer token to check via `AdminGuard`, its
   * verification IS the PSP signature check, so it cannot go through the guarded `PaymentController`
   * facade the same way `payments:capture` etc. do. `deps.paymentProvider` when injected (production:
   * `StripePaymentProvider`, `@platform/psp-stripe`), else the offline `InMemoryPaymentProvider` stub.
   */
  readonly paymentProvider: PaymentProvider;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `PaymentController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  intents: PaymentIntentRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  processedWebhooks: ProcessedWebhookStore,
  deps: PaymentsWiringDeps,
): { readonly controller: PaymentController; readonly paymentProvider: PaymentProvider } {
  const paymentProvider = deps.paymentProvider ?? new InMemoryPaymentProvider();
  const ordersPort = deps.ordersPort ?? new InMemoryOrdersAdapter();
  const financePort = deps.financePort ?? new InMemoryFinanceAdapter();
  const notifications = deps.paymentsNotifications ?? new InMemoryNotificationAdapter();

  const lifecycleDeps = {
    intents,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
    paymentProvider,
    ordersPort,
    financePort,
    notifications,
  };
  const capturePaymentLifecycle = new CapturePaymentLifecycle(lifecycleDeps);

  const controller = new PaymentController({
    createPaymentIntent: new CreatePaymentIntent({
      intents,
      unitOfWork,
      idGenerator: deps.idGenerator,
    }),
    capturePayment: new CapturePayment({
      intents,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    failPayment: new FailPayment({
      intents,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    refundPayment: new RefundPayment({
      intents,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    createPaymentIntentLifecycle: new CreatePaymentIntentLifecycle(lifecycleDeps),
    advancePayment: new AdvancePayment(lifecycleDeps),
    authorizePayment: new AuthorizePayment(lifecycleDeps),
    capturePaymentLifecycle,
    refundPaymentLifecycle: new RefundPaymentLifecycle(lifecycleDeps),
    recordWebhook: new RecordWebhook({
      intents,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      processedWebhooks,
      // Phase A.9: routes a `captured` PSP webhook through the SAME settlement code a normal
      // client retry uses (Charge/notify/Finance), closing the crash-recovery gap for both the
      // Prisma-backed and in-memory composition branches (this function is shared by both).
      captureSettlement: capturePaymentLifecycle,
    }),
    getPaymentIntent: new GetPaymentIntent({ intents }),
  });
  return { controller, paymentProvider };
}

/**
 * Composition root for the Payments context. Prisma slice (`PrismaPaymentIntentRepository` +
 * `PrismaUnitOfWork` + `PrismaProcessedWebhookStore`) when `prisma` is present; else in-memory. The
 * PSP (`deps.paymentProvider`) is independent of persistence — present in either branch when
 * injected (C2-2), else the offline `InMemoryPaymentProvider` stub. `ordersPort`/`financePort`/
 * `notifications` stay in-memory in both branches — reference-only outbound ports, out of scope here.
 */
export function wirePayments(deps: PaymentsWiringDeps): WiredPayments {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wirePayments: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new PaymentEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "payments",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const intents = new PrismaPaymentIntentRepository({
      prisma: deps.prisma,
      tenantId,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);
    const processedWebhooks = new PrismaProcessedWebhookStore(deps.prisma, tenantId);
    const built = buildController(intents, unitOfWork, processedWebhooks, deps);

    return {
      payments: built.controller,
      paymentProvider: built.paymentProvider,
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new PaymentEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "payments",
  });
  const context = rootEventContext(deps.idGenerator);

  const intents = new InMemoryPaymentIntentRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const processedWebhooks = new InMemoryProcessedWebhookStore();
  const built = buildController(intents, unitOfWork, processedWebhooks, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of PAYMENTS_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    payments: built.controller,
    paymentProvider: built.paymentProvider,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
