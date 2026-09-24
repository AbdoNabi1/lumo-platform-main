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
  CollectInvoice,
  ConsumeCredit,
  CreateInvoice,
  ExpireCredit,
  GrantCredit,
  IssueInvoice,
} from "./application/billing.use-cases";
import {
  ActivateSubscription,
  ArchivePlanVersion,
  CancelSubscription,
  ClonePlanVersion,
  ComparePlanVersions,
  CreatePlan,
  CreatePlanDraft,
  CreateSubscription,
  GetUsageCounter,
  GrantMerchantCapability,
  PauseSubscription,
  PreviewRenewal,
  PublishPlanVersion,
  RecordUsage,
  RepinSubscription,
  ResumeSubscription,
  RevokeMerchantCapability,
  RollbackPlan,
  SchedulePlanVersion,
  SetMerchantFeatureOverride,
} from "./application/licensing.use-cases";
import {
  BeginCardEnrolment,
  RecordCardToken,
  RevokeBillingPaymentMethod,
} from "./application/payment-method.use-cases";
import { BillSubscriptionRenewal } from "./application/renewal.use-cases";
import type { OffSessionCharger } from "@platform/contracts";
import type {
  BillingPaymentMethodRepository,
  CreditRepository,
  InvoiceRepository,
  MerchantCapabilitiesRepository,
  MerchantFeatureOverrideRepository,
  PlanRepository,
  SubscriptionRepository,
  UsageCounterRepository,
} from "./domain/repositories";
import type {
  BillingTokenSealer,
  CardEnrolmentPort,
  CardTokenCallbackVerifier,
  FinanceLedgerPort,
  PaymentsPort,
} from "./application/ports";
import { StoredMethodBillingPaymentsAdapter } from "./infrastructure/stored-method-billing-payments-adapter";
import {
  InMemoryFinanceLedgerAdapter,
  InMemoryPaymentsAdapter,
} from "./infrastructure/deferred-billing-adapters";
import {
  InMemoryBillingPaymentMethodRepository,
  InMemoryCreditRepository,
  InMemoryInvoiceRepository,
  InMemoryMerchantCapabilitiesRepository,
  InMemoryMerchantFeatureOverrideRepository,
  InMemoryPlanRepository,
  InMemoryProcessedUsageRecordStore,
  InMemorySubscriptionRepository,
  InMemoryUsageCounterRepository,
} from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  LICENSING_PUBLISHED_EVENTS,
  LicensingEventTranslator,
} from "./infrastructure/licensing-event-translator";
import {
  PrismaBillingPaymentMethodRepository,
  PrismaCreditRepository,
  PrismaInvoiceRepository,
  PrismaMerchantCapabilitiesRepository,
  PrismaMerchantFeatureOverrideRepository,
  PrismaPlanRepository,
  PrismaSubscriptionRepository,
  PrismaUsageCounterRepository,
} from "./infrastructure/prisma-repositories";
import { LicensingController } from "./interfaces/licensing.controller";

/**
 * Everything renewals need to charge a merchant's SAVED card with no payer present (G-74 (1)), all of
 * it on MORBEH'S OWN PSP account: the narrow off-session port, the card-token callback verifier, the
 * interactive first-payment starter, and the sealer for the stored token.
 */
export interface StoredMethodBillingDeps {
  readonly sealer: BillingTokenSealer;
  /** The narrow port: a provider that cannot charge off-session is not assignable here. */
  readonly charger: OffSessionCharger;
  readonly enrolment: CardEnrolmentPort;
  readonly cardTokenVerifier: CardTokenCallbackVerifier;
}

export interface LicensingWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ all 7 Prisma repositories + `PrismaUnitOfWork`;
   * absent ⇒ in-memory, unchanged. ADR-0014 (WP-10, T10.5): the repositories built here are
   * tenant-agnostic singletons — no `tenantId` at composition time any more.
   * `processedUsageRecords` (idempotency store) and the deferred `payments`/`financeLedger`
   * billing-adapter stubs stay in-memory in both branches — out of scope for C-01.
   */
  readonly prisma?: Database;
  /**
   * Production PSP-backed billing collection (M2-3). Absent ⇒ `InMemoryPaymentsAdapter` — an
   * always-succeeds stub whose `collect()` never moves money. Same `deps.X ?? default` convention
   * as `mfaProviders`/`kms`/`crypto` in Security's composition root; `apps/runtime` refuses to
   * boot outside `local` without a real one injected here. Building the real PSP-backed adapter is
   * out of scope for this seam — shared long pole with the still-open C2-2 real-PSP-adapter work.
   */
  readonly payments?: PaymentsPort;
  /**
   * Charging a merchant's saved card off-session (G-74 (1)). Present ⇒ renewals collect through
   * `StoredMethodBillingPaymentsAdapter` — the only real path that can actually move money, since the
   * on-session `payments` adapter can never complete without a payer — and it takes precedence over
   * `payments`. Absent ⇒ unchanged: `payments`, else the in-memory stub. The card-enrolment and
   * token-callback use cases exist only when this is present.
   */
  readonly storedMethodBilling?: StoredMethodBillingDeps;
  /**
   * Production Finance-ledger settlement posting (M2-3). Absent ⇒ `InMemoryFinanceLedgerAdapter`
   * — a no-op stub whose `postSettlement()` never posts to the ledger. Same convention and boot
   * guard as `payments` above.
   */
  readonly financeLedger?: FinanceLedgerPort;
  /**
   * The platform-operator tenant (WP-14, T14.2): plans, subscriptions, invoices, credits and
   * renewal billing are PLATFORM-owned, and a caller from any other tenant is refused with a 403 at
   * `LicensingController`. Absent ⇒ single-tenant deployment (the one tenant is the platform).
   * `apps/admin`'s composition passes the deployment tenant under `TENANT_MODE=multi` (ADR-0014 8f).
   */
  readonly platformTenantId?: string;
}

export interface WiredLicensing {
  readonly licensing: LicensingController;
  /** The platform-scoped saved-card store: exposed for the composition root and for isolation tests. */
  readonly billingPaymentMethods: BillingPaymentMethodRepository;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

interface LicensingRepos {
  readonly plans: PlanRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly merchantFeatureOverrides: MerchantFeatureOverrideRepository;
  readonly merchantCapabilities: MerchantCapabilitiesRepository;
  readonly usageCounters: UsageCounterRepository;
  readonly credits: CreditRepository;
  readonly invoices: InvoiceRepository;
  readonly billingPaymentMethods: BillingPaymentMethodRepository;
}

/** Builds the `LicensingController` from an already-wired repo set — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  repos: LicensingRepos,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: LicensingWiringDeps,
): LicensingController {
  const processedUsageRecords = new InMemoryProcessedUsageRecordStore();
  const stored = deps.storedMethodBilling;
  const payments: PaymentsPort =
    stored === undefined
      ? (deps.payments ?? new InMemoryPaymentsAdapter())
      : new StoredMethodBillingPaymentsAdapter({
          methods: repos.billingPaymentMethods,
          sealer: stored.sealer,
          charger: stored.charger,
        });
  const financeLedger = deps.financeLedger ?? new InMemoryFinanceLedgerAdapter();

  const licensingDeps = {
    plans: repos.plans,
    subscriptions: repos.subscriptions,
    merchantFeatureOverrides: repos.merchantFeatureOverrides,
    merchantCapabilities: repos.merchantCapabilities,
    usageCounters: repos.usageCounters,
    processedUsageRecords,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };
  const billingDeps = {
    invoices: repos.invoices,
    credits: repos.credits,
    payments,
    financeLedger,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };

  const collectInvoice = new CollectInvoice(billingDeps);
  const paymentMethodDeps =
    stored === undefined
      ? undefined
      : {
          methods: repos.billingPaymentMethods,
          invoices: repos.invoices,
          sealer: stored.sealer,
          enrolment: stored.enrolment,
          cardTokenVerifier: stored.cardTokenVerifier,
          unitOfWork,
          idGenerator: deps.idGenerator,
          clock: deps.clock,
        };

  return new LicensingController({
    platformTenantId: deps.platformTenantId,
    ...(paymentMethodDeps === undefined
      ? {}
      : {
          beginCardEnrolment: new BeginCardEnrolment(paymentMethodDeps),
          recordCardToken: new RecordCardToken(paymentMethodDeps),
          revokeBillingPaymentMethod: new RevokeBillingPaymentMethod(paymentMethodDeps),
        }),
    billSubscriptionRenewal: new BillSubscriptionRenewal({
      subscriptions: repos.subscriptions,
      plans: repos.plans,
      invoices: repos.invoices,
      collectInvoice,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    createPlan: new CreatePlan(licensingDeps),
    createPlanDraft: new CreatePlanDraft(licensingDeps),
    schedulePlanVersion: new SchedulePlanVersion(licensingDeps),
    publishPlanVersion: new PublishPlanVersion(licensingDeps),
    rollbackPlan: new RollbackPlan(licensingDeps),
    clonePlanVersion: new ClonePlanVersion(licensingDeps),
    archivePlanVersion: new ArchivePlanVersion(licensingDeps),
    comparePlanVersions: new ComparePlanVersions(licensingDeps),
    createSubscription: new CreateSubscription(licensingDeps),
    repinSubscription: new RepinSubscription(licensingDeps),
    activateSubscription: new ActivateSubscription(licensingDeps),
    pauseSubscription: new PauseSubscription(licensingDeps),
    resumeSubscription: new ResumeSubscription(licensingDeps),
    cancelSubscription: new CancelSubscription(licensingDeps),
    previewRenewal: new PreviewRenewal(licensingDeps),
    setMerchantFeatureOverride: new SetMerchantFeatureOverride(licensingDeps),
    grantMerchantCapability: new GrantMerchantCapability(licensingDeps),
    revokeMerchantCapability: new RevokeMerchantCapability(licensingDeps),
    recordUsage: new RecordUsage(licensingDeps),
    getUsageCounter: new GetUsageCounter(licensingDeps),
    createInvoice: new CreateInvoice(billingDeps),
    issueInvoice: new IssueInvoice(billingDeps),
    collectInvoice,
    grantCredit: new GrantCredit(billingDeps),
    consumeCredit: new ConsumeCredit(billingDeps),
    expireCredit: new ExpireCredit(billingDeps),
  });
}

/**
 * Composition root for the Licensing context. Prisma slice (all 7 repositories +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireLicensing(deps: LicensingWiringDeps): WiredLicensing {
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new LicensingEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "licensing",
    });
    const context = rootEventContext(deps.idGenerator);
    const licensingDeps = { prisma: deps.prisma, outbox, context };
    const repos: LicensingRepos = {
      plans: new PrismaPlanRepository(licensingDeps),
      subscriptions: new PrismaSubscriptionRepository(licensingDeps),
      merchantFeatureOverrides: new PrismaMerchantFeatureOverrideRepository(licensingDeps),
      merchantCapabilities: new PrismaMerchantCapabilitiesRepository(licensingDeps),
      usageCounters: new PrismaUsageCounterRepository(licensingDeps),
      credits: new PrismaCreditRepository(licensingDeps),
      invoices: new PrismaInvoiceRepository(licensingDeps),
      billingPaymentMethods: new PrismaBillingPaymentMethodRepository(licensingDeps),
    };
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      licensing: buildController(repos, unitOfWork, deps),
      billingPaymentMethods: repos.billingPaymentMethods,
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new LicensingEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "licensing",
  });
  const context = rootEventContext(deps.idGenerator);

  const repos: LicensingRepos = {
    plans: new InMemoryPlanRepository({ outbox: outboxWriter, context }),
    subscriptions: new InMemorySubscriptionRepository({ outbox: outboxWriter, context }),
    merchantFeatureOverrides: new InMemoryMerchantFeatureOverrideRepository({
      outbox: outboxWriter,
      context,
    }),
    merchantCapabilities: new InMemoryMerchantCapabilitiesRepository({
      outbox: outboxWriter,
      context,
    }),
    usageCounters: new InMemoryUsageCounterRepository({ outbox: outboxWriter, context }),
    credits: new InMemoryCreditRepository({ outbox: outboxWriter, context }),
    invoices: new InMemoryInvoiceRepository({ outbox: outboxWriter, context }),
    billingPaymentMethods: new InMemoryBillingPaymentMethodRepository(),
  };
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(repos, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of LICENSING_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    licensing: controller,
    billingPaymentMethods: repos.billingPaymentMethods,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
