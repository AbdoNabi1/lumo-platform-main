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
import type {
  CreditRepository,
  InvoiceRepository,
  MerchantCapabilitiesRepository,
  MerchantFeatureOverrideRepository,
  PlanRepository,
  SubscriptionRepository,
  UsageCounterRepository,
} from "./domain/repositories";
import type { FinanceLedgerPort, PaymentsPort } from "./application/ports";
import {
  InMemoryFinanceLedgerAdapter,
  InMemoryPaymentsAdapter,
} from "./infrastructure/deferred-billing-adapters";
import {
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
  PrismaCreditRepository,
  PrismaInvoiceRepository,
  PrismaMerchantCapabilitiesRepository,
  PrismaMerchantFeatureOverrideRepository,
  PrismaPlanRepository,
  PrismaSubscriptionRepository,
  PrismaUsageCounterRepository,
} from "./infrastructure/prisma-repositories";
import { LicensingController } from "./interfaces/licensing.controller";

export interface LicensingWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ all 7 Prisma repositories + `PrismaUnitOfWork`
   * (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/`wireTenancy`); absent ⇒
   * in-memory, unchanged. `processedUsageRecords` (idempotency store) and the deferred
   * `payments`/`financeLedger` billing-adapter stubs stay in-memory in both branches — out of
   * scope for C-01.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Licensing table is tenant-scoped. */
  readonly tenantId?: string;
  /**
   * Production PSP-backed billing collection (M2-3). Absent ⇒ `InMemoryPaymentsAdapter` — an
   * always-succeeds stub whose `collect()` never moves money. Same `deps.X ?? default` convention
   * as `mfaProviders`/`kms`/`crypto` in Security's composition root; `apps/runtime` refuses to
   * boot outside `local` without a real one injected here. Building the real PSP-backed adapter is
   * out of scope for this seam — shared long pole with the still-open C2-2 real-PSP-adapter work.
   */
  readonly payments?: PaymentsPort;
  /**
   * Production Finance-ledger settlement posting (M2-3). Absent ⇒ `InMemoryFinanceLedgerAdapter`
   * — a no-op stub whose `postSettlement()` never posts to the ledger. Same convention and boot
   * guard as `payments` above.
   */
  readonly financeLedger?: FinanceLedgerPort;
}

export interface WiredLicensing {
  readonly licensing: LicensingController;
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
}

/** Builds the `LicensingController` from an already-wired repo set — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  repos: LicensingRepos,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: LicensingWiringDeps,
): LicensingController {
  const processedUsageRecords = new InMemoryProcessedUsageRecordStore();
  const payments = deps.payments ?? new InMemoryPaymentsAdapter();
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

  return new LicensingController({
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
    collectInvoice: new CollectInvoice(billingDeps),
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
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireLicensing: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new LicensingEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "licensing",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const licensingDeps = { prisma: deps.prisma, tenantId, outbox, context };
    const repos: LicensingRepos = {
      plans: new PrismaPlanRepository(licensingDeps),
      subscriptions: new PrismaSubscriptionRepository(licensingDeps),
      merchantFeatureOverrides: new PrismaMerchantFeatureOverrideRepository(licensingDeps),
      merchantCapabilities: new PrismaMerchantCapabilitiesRepository(licensingDeps),
      usageCounters: new PrismaUsageCounterRepository(licensingDeps),
      credits: new PrismaCreditRepository(licensingDeps),
      invoices: new PrismaInvoiceRepository(licensingDeps),
    };
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      licensing: buildController(repos, unitOfWork, deps),
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
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
