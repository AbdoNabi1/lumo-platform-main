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
import { ConfirmCodCollection } from "./application/confirm-cod-collection.use-case";
import {
  GetMerchantPaymentSettings,
  UpdateMerchantPaymentSettings,
} from "./application/merchant-payment-settings.use-cases";
import { VerifyPaymentWebhook } from "./application/verify-payment-webhook";
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
  PaymentCredentialVault,
  PaymentProviderResolver,
  PaymobProviderFactory,
  ProcessedWebhookStore,
} from "./application/ports";
import type { MerchantPaymentSettingsRepository } from "./domain/merchant-payment-settings-repository";
import type { PaymentIntentRepository } from "./domain/payment-intent-repository";
import { CashOnDeliveryProvider } from "./infrastructure/cash-on-delivery-provider";
import { InMemoryPaymentCredentialVault } from "./infrastructure/envelope-payment-credential-vault";
import { InMemoryMerchantPaymentSettingsRepository } from "./infrastructure/in-memory-merchant-payment-settings-repository";
import { PrismaMerchantPaymentSettingsRepository } from "./infrastructure/prisma-merchant-payment-settings-repository";
import { TenantPaymentProviderResolver } from "./infrastructure/tenant-payment-provider-resolver";
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
   * `PrismaUnitOfWork` + `PrismaProcessedWebhookStore`; absent ⇒ in-memory, unchanged.
   * `ordersPort`/`financePort`/`notifications` stay in-memory in both branches — reference-only
   * outbound ports, not persistence, out of scope for C-01. ADR-0014 (WP-10, T10.3): the
   * repository and store built here are tenant-agnostic singletons — no `tenantId` at composition
   * time any more.
   */
  readonly prisma?: Database;
  /**
   * The PLATFORM's Stripe adapter (C2-2) — one Stripe account for the whole platform, injected as
   * before. Absent ⇒ `InMemoryPaymentProvider`, the offline stub whose `verifyWebhook()` always
   * returns `true` and whose money operations no-op; `apps/runtime` refuses to boot outside `local`
   * with that stub backing Stripe. Since WP-13 this is only ONE input to the per-request provider
   * resolver below — it is no longer what every payment goes through.
   */
  readonly paymentProvider?: PaymentProvider;
  /**
   * Builds a merchant's Paymob provider from that merchant's own (opened) credentials. Supplied by
   * the composition root, which owns `@platform/psp-paymob`. Absent ⇒ Paymob is unavailable.
   */
  readonly paymobProviderFactory?: PaymobProviderFactory;
  /** Seals merchant PSP secrets (`@platform/secrets` envelope). Absent ⇒ an in-memory STUB the boot guard refuses outside `local`. */
  readonly paymentCredentialVault?: PaymentCredentialVault;
  /** Full override of the per-request provider resolver (tests). Absent ⇒ built from the inputs above. */
  readonly paymentProviders?: PaymentProviderResolver;
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
   * The per-request provider resolver (ADR-0014). Exposed for the production boot guard
   * (`assertProductionPaymentProviderConfigured`), which asks it what really backs each method.
   * The webhook ingress verifies through `payments.verifyWebhook`, which resolves the TENANT's own
   * provider — there is deliberately no process-wide provider left to hand out.
   */
  readonly providers: PaymentProviderResolver;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `PaymentController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  intents: PaymentIntentRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  processedWebhooks: ProcessedWebhookStore,
  settings: MerchantPaymentSettingsRepository,
  deps: PaymentsWiringDeps,
): { readonly controller: PaymentController; readonly providers: PaymentProviderResolver } {
  const credentialVault = deps.paymentCredentialVault ?? new InMemoryPaymentCredentialVault();
  const providers =
    deps.paymentProviders ??
    new TenantPaymentProviderResolver({
      settings,
      stripe: deps.paymentProvider ?? new InMemoryPaymentProvider(),
      cashOnDelivery: new CashOnDeliveryProvider(),
      paymobFactory: deps.paymobProviderFactory,
      vault: credentialVault,
    });
  const ordersPort = deps.ordersPort ?? new InMemoryOrdersAdapter();
  const financePort = deps.financePort ?? new InMemoryFinanceAdapter();
  const notifications = deps.paymentsNotifications ?? new InMemoryNotificationAdapter();

  const lifecycleDeps = {
    intents,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
    providers,
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
    confirmCodCollection: new ConfirmCodCollection({
      intents,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      captureSettlement: capturePaymentLifecycle,
    }),
    getMerchantPaymentSettings: new GetMerchantPaymentSettings({ settings, providers }),
    updateMerchantPaymentSettings: new UpdateMerchantPaymentSettings({
      settings,
      providers,
      vault: credentialVault,
      unitOfWork,
    }),
    verifyPaymentWebhook: new VerifyPaymentWebhook(providers),
  });
  return { controller, providers };
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
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new PaymentEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "payments",
    });
    // ADR-0014, WP-10 T10.3: no tenantId at composition time — every repository takes it per
    // call and merges it into the event context at write time.
    const context = rootEventContext(deps.idGenerator);
    const intents = new PrismaPaymentIntentRepository({ prisma: deps.prisma, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);
    const processedWebhooks = new PrismaProcessedWebhookStore(deps.prisma);
    const built = buildController(
      intents,
      unitOfWork,
      processedWebhooks,
      new PrismaMerchantPaymentSettingsRepository(deps.prisma),
      deps,
    );

    return {
      payments: built.controller,
      providers: built.providers,
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
  const built = buildController(
    intents,
    unitOfWork,
    processedWebhooks,
    new InMemoryMerchantPaymentSettingsRepository(),
    deps,
  );

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
    providers: built.providers,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
