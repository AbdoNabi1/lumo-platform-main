import type {
  AccessControl,
  Authenticator,
  Clock,
  IdGenerator,
  PaymentProvider,
} from "@platform/contracts";
import { SystemClock } from "@platform/clock";
import {
  createPrismaClient,
  PrismaDeadLetterStore,
  PrismaOutboxStore,
  PrismaProcessedEventStore,
  PrismaUnitOfWork,
  type Database,
} from "@platform/db";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { EventSerializer } from "@platform/domain-events";
import { HealthRegistry } from "@platform/health";
import { CryptoIdGenerator } from "@platform/id";
import {
  createKafkaClient,
  DeadLetterPublisher,
  KafkaConsumerRuntime,
  KafkaMessageProducer,
  type Kafka,
} from "@platform/kafka";
import {
  InMemoryObjectStorage,
  StorageServiceObjectStorage,
  type ObjectStoragePort,
} from "@platform/media";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import {
  MarkOrderPaid,
  OrderEventTranslator,
  PaymentCapturedConsumer,
  PrismaOrderRepository,
  type PaymentCapturedPayload,
  type PaymentVerificationPort,
} from "@platform/orders";
import { wirePayments, type PaymentController } from "@platform/payments";
import { StripePaymentProvider } from "@platform/psp-stripe";
import { NodeCrypto, TotpMfaProvider, MapMfaProviderResolver, type MfaProviderResolver } from "@platform/security";
import type {
  PaymentsPort as ReturnsPaymentsPort,
  RefundVerificationPort,
} from "@platform/returns";
import {
  createRedis,
  RedisDistributedLock,
  RedisIdempotencyKeyStore,
  RedisRateLimiter,
  type RedisHandle,
} from "@platform/redis";
import { CachedAccessControl, JwtVerifier, KetoAccessControl } from "@platform/auth";
import { createSecretProvider } from "@platform/secrets";
import { createS3Client, S3StorageService } from "@platform/storage";
import { logger, type Logger } from "@platform/utils";
import type { RuntimeConfig } from "./config";
import { RuntimeMetrics } from "./metrics";
import { TrackingIngestHandler, type TrackingCapturedPayload } from "./tracking/tracking-ingest";
import { loadTrackingRegistry, PrismaTrackingRegistryStore } from "./tracking/tracking-registry";
import {
  TrackingRegistryHandle,
  TrackingRegistryWatcher,
} from "./tracking/tracking-registry-handle";
import { wireTrackingRuntime } from "./tracking/wire-tracking-runtime";

/**
 * The production composition root (Sprint 2.9, D-050). EVERY dependency is wired here — no
 * application code instantiates infrastructure. All clients are lazy (Prisma/Redis/Kafka
 * connect on first use), so building the graph is side-effect-free and testable without Docker;
 * `connect`/`start` happens only in the entrypoints.
 *
 * Secure defaults: authentication REQUIRES a configured JWKS issuer (no fake identity, per
 * Sprint 2.7); authorization outside `local` REQUIRES Keto — a missing authorization backend
 * fails composition, never falls open.
 */
export interface RuntimeCore {
  readonly config: RuntimeConfig;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly prisma: Database;
  readonly redis: RedisHandle;
  readonly kafka: Kafka;
  readonly serializer: EventSerializer;
  readonly authenticator: Authenticator;
  readonly accessControl: AccessControl;
  readonly rateLimiter: RedisRateLimiter;
  readonly idempotencyKeys: RedisIdempotencyKeyStore;
  readonly distributedLock: RedisDistributedLock;
  readonly health: HealthRegistry;
  /**
   * Process-wide metrics registry (F5 / G-19). ONE instance per process, shared by every consumption
   * point: the Kafka consumer runtime (`MessagingMetrics`), the HTTP transport (`HttpMetricsSink`),
   * and the readiness reports that drive `runtime_ready`/`runtime_dependency_up`. Held here rather
   * than constructed per-entrypoint so a single `/metrics` exposition covers the whole process.
   */
  readonly metrics: RuntimeMetrics;
  /**
   * Media's outbound object-storage seam (M2-2). Real `StorageServiceObjectStorage` (wrapping
   * `@platform/storage`'s S3-compatible client, scoped to `S3_BUCKET_MEDIA`) when `S3_ENDPOINT` +
   * credentials are configured; `InMemoryObjectStorage` otherwise, unchanged from before this field
   * existed. `apps/runtime/src/api.ts` refuses to boot outside `local` while this is still the
   * in-memory stub.
   */
  readonly objectStorage: ObjectStoragePort;
  /**
   * Production PSP adapter (C2-2). Present ⇒ `StripePaymentProvider` (real Stripe REST calls),
   * built whenever `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are both configured; `undefined` ⇒
   * `wirePayments` falls back to its own `InMemoryPaymentProvider` default, unchanged from before
   * this field existed. `apps/runtime/src/api.ts` refuses to boot outside `local` while absent.
   */
  readonly paymentProvider: PaymentProvider | undefined;
  /**
   * Production MFA provider resolver (C2-4). Real RFC 6238 `TotpMfaProvider` over `NodeCrypto`,
   * built unconditionally — unlike `objectStorage`/`paymentProvider`, this needs no external
   * account/credentials to be "real," only a `CryptoPort`, which is always available.
   * `apps/runtime/src/api.ts` refuses to boot outside `local` only while the resolved `totp`
   * provider is still the in-memory reference stub, which this composition never produces.
   */
  readonly mfaProviders: MfaProviderResolver;
}

export function buildRuntimeCore(config: RuntimeConfig): RuntimeCore {
  // C2-6: every wireX({ prisma, tenantId }) branch pins its repositories to ONE tenantId at
  // construction (ADR-0008) — TENANT_DEFAULT_ID, threaded through from here in api.ts/worker.ts.
  // There is no per-request re-composition, so TENANT_MODE=multi would boot successfully and then
  // either silently mis-scope every non-default-tenant request to TENANT_DEFAULT_ID's rows (if the
  // HTTP tenant guard were absent) or reject every one of them (with it present) — neither is
  // multi-tenancy. Fail closed at boot rather than advertise a mode nothing here implements.
  if (config.TENANT_MODE === "multi") {
    throw new Error(
      "Runtime composition does not support TENANT_MODE=multi: every Prisma repository is pinned " +
        "to one tenantId at construction (ADR-0008), never per request. Implementing multi-tenant " +
        "composition is a design change (ADR), not a configuration switch.",
    );
  }
  const clock = new SystemClock();
  const idGenerator = new CryptoIdGenerator();
  // Phase A.13 (Task 1/2): previously an unsafe `as` cast supplied only `url`/`logQueries` — the real
  // production entrypoint's PrismaClient never received `poolMax`/`connectTimeoutMs`, so
  // `buildDatasourceUrl` (packages/db/src/client.ts) would have serialized `connection_limit=undefined`
  // (the literal string) onto the datasource URL as soon as it started consuming those fields. The
  // object below now structurally satisfies `DatabaseConfig` — no cast needed.
  const prisma = createPrismaClient({
    url: config.DATABASE_URL,
    poolMax: config.DATABASE_POOL_MAX,
    connectTimeoutMs: config.DATABASE_CONNECT_TIMEOUT_MS,
    statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS,
    logQueries: false,
  });
  const redis = createRedis({
    url: config.REDIS_URL,
    keyPrefix: config.REDIS_KEY_PREFIX,
  });
  const kafka = createKafkaClient({
    brokers: config.KAFKA_BROKERS.split(","),
    clientId: config.KAFKA_CLIENT_ID,
  });

  // JSON envelope serializer: byte-compatible with everything written so far; the Apicurio
  // Avro/Protobuf serializer replaces it behind the same contract in the schema-registry sprint.
  const serializer: EventSerializer = new InMemoryEventSerializer();

  if (config.AUTH_JWKS_URL === undefined || config.AUTH_ISSUER_URL === undefined) {
    throw new Error(
      "Runtime composition requires AUTH_ISSUER_URL + AUTH_JWKS_URL — there is no fake identity provider (D-048).",
    );
  }
  const authenticator = new JwtVerifier({
    issuer: config.AUTH_ISSUER_URL,
    audience: config.AUTH_AUDIENCE,
    jwksUrl: config.AUTH_JWKS_URL,
    logger,
  });

  let accessControl: AccessControl;
  if (config.KETO_READ_URL !== undefined) {
    accessControl = new CachedAccessControl(
      new KetoAccessControl({
        readUrl: config.KETO_READ_URL,
        fetch: async (url, init) => fetch(url, init),
        logger,
      }),
      redis.cache,
    );
  } else if (config.APP_ENV === "local") {
    // Local-only escape hatch; anything else without Keto fails CLOSED at startup.
    accessControl = { authorize: () => Promise.resolve(true) };
    logger.warn("authorization is permissive: KETO_READ_URL unset and APP_ENV=local");
  } else {
    throw new Error(
      "KETO_READ_URL is required outside APP_ENV=local (authorization fails closed).",
    );
  }

  const health = new HealthRegistry();
  health.register({
    name: "postgres",
    probe: async () => {
      await prisma.$queryRawUnsafe("SELECT 1");
    },
  });
  health.register(redis.healthCheck());

  // M2-2: real adapter only once endpoint + credentials are configured — mirrors every other
  // `deps.X ?? default`-style optional provider in this composition root; local/tests build the
  // graph unchanged (side-effect-free, no Docker required) via the InMemoryObjectStorage fallback.
  const objectStorage: ObjectStoragePort =
    config.S3_ENDPOINT !== undefined &&
    config.S3_ACCESS_KEY_ID !== undefined &&
    config.S3_SECRET_ACCESS_KEY !== undefined
      ? new StorageServiceObjectStorage(
          new S3StorageService(
            createS3Client({
              endpoint: config.S3_ENDPOINT,
              region: config.S3_REGION,
              forcePathStyle: config.S3_FORCE_PATH_STYLE,
              accessKeyId: config.S3_ACCESS_KEY_ID,
              secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            }),
            config.S3_BUCKET_MEDIA,
          ),
        )
      : new InMemoryObjectStorage();

  // C2-4: unlike objectStorage/paymentProvider, a real TotpMfaProvider needs no external
  // account/credentials — only a CryptoPort — so it is built unconditionally rather than gated on
  // config presence. `assertProductionMfaConfigured` (api.ts) checks the resolved provider's
  // identity, not this composition's branching, so `local` and non-local share this exact path.
  const mfaProviders: MfaProviderResolver = new MapMfaProviderResolver([
    new TotpMfaProvider(new NodeCrypto(), clock),
  ]);

  // C2-2: same present/absent convention as `objectStorage` above — `undefined` here is the exact
  // signal `assertProductionPaymentProviderConfigured` (`api.ts`) fails closed on outside `local`.
  const paymentProvider: PaymentProvider | undefined =
    config.STRIPE_SECRET_KEY !== undefined && config.STRIPE_WEBHOOK_SECRET !== undefined
      ? new StripePaymentProvider({
          secretKey: config.STRIPE_SECRET_KEY,
          webhookSecret: config.STRIPE_WEBHOOK_SECRET,
          apiBase: config.STRIPE_API_BASE,
          fetch: async (url, init) => fetch(url, init),
          logger,
        })
      : undefined;

  return {
    config,
    logger,
    clock,
    idGenerator,
    prisma,
    redis,
    kafka,
    serializer,
    authenticator,
    accessControl,
    rateLimiter: new RedisRateLimiter(redis.client),
    idempotencyKeys: new RedisIdempotencyKeyStore(redis.client),
    distributedLock: new RedisDistributedLock(redis.client),
    health,
    metrics: new RuntimeMetrics(),
    objectStorage,
    paymentProvider,
    mfaProviders,
  };
}

/**
 * Real `PaymentVerificationPort` (Sprint A1 Task 5, G-39-adjacent): checks the `payment_intents`
 * table directly — the same schema/read-model `PrismaPaymentIntentRepository` writes to (reused,
 * not duplicated) — for a `captured` intent matching both the caller-supplied id and order.
 * Read-only, tenant-scoped; never imports `@platform/payments` (Orders/Payments stay decoupled at
 * the code level, same convention as every other cross-context port in this codebase).
 */
export class PrismaPaymentVerificationAdapter implements PaymentVerificationPort {
  private readonly prisma: RuntimeCore["prisma"];
  private readonly tenantId: string;

  constructor(prisma: RuntimeCore["prisma"], tenantId: string) {
    this.prisma = prisma;
    this.tenantId = tenantId;
  }

  async hasCapturedPayment(orderId: string, paymentRef: string): Promise<boolean> {
    const row = await this.prisma.paymentIntent.findFirst({
      where: { id: paymentRef, orderRef: orderId, tenantId: this.tenantId, status: "captured" },
      select: { id: true },
    });
    return row !== null;
  }
}

/**
 * Real `RefundVerificationPort` (Phase A.2, F-04 closure): sums `charges`/`refunds` across every
 * payment intent for the order (same `payment_intents`/`charges`/`refunds` schema
 * `PrismaPaymentIntentRepository` already writes, reused not duplicated) to derive the refundable
 * ceiling — captured minus already-refunded, in the requested currency — and compares the
 * caller-supplied amount against it. Read-only, tenant-scoped; never imports `@platform/payments`
 * (same decoupling convention as `PrismaPaymentVerificationAdapter` above). This mirrors that
 * adapter's exact shape: Returns asks Payments' own authoritative ledger, Returns computes nothing
 * itself.
 */
export class PrismaRefundVerificationAdapter implements RefundVerificationPort {
  private readonly prisma: RuntimeCore["prisma"];
  private readonly tenantId: string;

  constructor(prisma: RuntimeCore["prisma"], tenantId: string) {
    this.prisma = prisma;
    this.tenantId = tenantId;
  }

  async isRefundable(orderRef: string, amountMinor: number, currency: string): Promise<boolean> {
    const intents = await this.prisma.paymentIntent.findMany({
      where: { orderRef, tenantId: this.tenantId, currency },
      include: { charges: true, refunds: true },
    });
    const totalCaptured = intents.reduce(
      (sum, intent) =>
        sum + intent.charges.reduce((chargeSum, charge) => chargeSum + charge.amountMinor, 0),
      0,
    );
    // Phase A.10 (Task 3): same fix as `PrismaPaymentsPortAdapter.requestRefund` below — a `failed`
    // refund's reservation was released domain-side and must not shrink the refundable ceiling this
    // check reports back to Returns' `DecideResolution`.
    const totalRefunded = intents.reduce(
      (sum, intent) =>
        sum +
        intent.refunds
          .filter((refund) => refund.status !== "failed")
          .reduce((refundSum, refund) => refundSum + refund.amountMinor, 0),
      0,
    );
    return amountMinor <= totalCaptured - totalRefunded;
  }
}

/**
 * Real Returns `PaymentsPort` (Phase A.3, refund execution closure): `services/returns/src/
 * composition.ts` hardcoded an offline no-op (`InMemoryPaymentsAdapter`) as this port in every
 * environment, so an approved, amount-bounded Returns refund had zero downstream Payments effect
 * anywhere in this codebase (flagged, not fixed, by `PHASE_A2_REFUND_SECURITY_CLOSURE_AUDIT.md`
 * Risk 1). This adapter closes it by bridging to Payments' OWN already-real execution path —
 * `RefundPaymentLifecycle` (the identical use case `POST /payment-intents/:id/refund` already
 * uses), reached here through the already-public `wirePayments()`/`PaymentController` — so the
 * money movement goes through the exact same domain invariant (`totalRefunded <= totalCaptured`),
 * optimistic locking, and PSP call as the pre-existing real refund route. No new business logic is
 * introduced; this is wiring, not a new architecture.
 *
 * The target `PaymentIntent` is resolved the same way `PrismaRefundVerificationAdapter` above
 * derives its refundable ceiling: reading Payments' own `payment_intents`/`charges`/`refunds`
 * tables directly, tenant-scoped, never importing `@platform/payments`'s domain/Prisma internals
 * for this read. The WRITE, by contrast, deliberately does go through `@platform/payments`'s public
 * `wirePayments()` — Phase L's own guidance prefers reusing an existing Payments application use
 * case over re-deriving its invariants outside the aggregate.
 *
 * Known, documented limitation (not solved here — no speculative engineering, ADR-0014-class
 * tension left for a future sprint if it ever becomes real): picks the single payment intent for
 * the order+currency with sufficient remaining; does not split a refund across multiple intents.
 * Every order this codebase's checkout flow produces has exactly one `PaymentIntent` per currency.
 *
 * Idempotency (Phase A.4 + A.5): `RefundPaymentLifecycle`'s PSP idempotency key is derived from its
 * own durably-reserved refund id (`payment-lifecycle.use-cases.ts`'s `reserve()`), not a fresh id
 * per call. Through Phase A.4 that only protected retries of ONE reservation's settlement step
 * (e.g. an optimistic-lock conflict); Returns' own caller-supplied idempotency key (this
 * adapter's `idempotencyKey` parameter) was received and then discarded (`_idempotencyKey`,
 * unused) — so a caller retrying the WHOLE `requestRefund()` call (e.g. after a timeout) got a
 * brand-new reservation with a brand-new id, and the PSP could not recognize it as a retry of the
 * same logical refund. Phase A.5 closes this: the key is now threaded straight through to
 * `RefundPaymentLifecycleInput.idempotencyKey`, which `PaymentIntent.requestRefund` uses to find
 * (not recreate) the existing reservation on a full-request retry — see the Phase A.5 report's
 * Idempotency Key Trace / Minimal Fix sections.
 *
 * Atomicity note (Phase A.13.1): Returns' `DecideResolution` now calls this AFTER its own Prisma
 * transaction has already committed — the resolution decision is durable before this ever runs.
 * This method itself is not wrapped in any transaction; internally it opens its OWN independent
 * `prisma.$transaction()`(s) — Phase A.4 split `RefundPaymentLifecycle` into two committed
 * transactions (reserve, then settle) around the PSP call, still on the same shared `prisma`
 * client. None of these are atomically joined with Returns' own transaction, and none needs to be:
 * no Postgres transaction (Returns' or Payments') is open while the PSP call is in flight. See
 * PHASE_A13_1_RETURNS_REFUND_TRANSACTION_BOUNDARY_CLOSURE_REPORT.md and the Phase A.4 report's PSP
 * Ordering / Retry Analysis sections.
 */
export class PrismaPaymentsPortAdapter implements ReturnsPaymentsPort {
  private readonly prisma: RuntimeCore["prisma"];
  private readonly tenantId: string;
  private readonly payments: PaymentController;

  constructor(prisma: RuntimeCore["prisma"], tenantId: string, payments: PaymentController) {
    this.prisma = prisma;
    this.tenantId = tenantId;
    this.payments = payments;
  }

  async requestRefund(
    orderRef: string,
    amountMinor: number,
    currency: string,
    idempotencyKey: string,
  ): Promise<void> {
    const intents = await this.prisma.paymentIntent.findMany({
      where: { orderRef, tenantId: this.tenantId, currency },
      include: { charges: true, refunds: true },
    });
    const target = intents.find((intent) => {
      const captured = intent.charges.reduce((sum, charge) => sum + charge.amountMinor, 0);
      // Phase A.10 (Task 3): mirrors `PaymentIntent.remaining()` (`services/payments/src/domain/
      // payment-intent.ts`) — a `failed` refund's reservation was released and must not shrink the
      // capacity this pre-check computes. Pre-fix this summed every refund row unconditionally, so
      // an order with a prior failed refund attempt could be wrongly reported as having
      // insufficient remaining amount even though the domain's own authoritative check would have
      // allowed it — a false rejection, never an over-refund (the domain check downstream is
      // unaffected), but still a real selection-layer miscount worth closing with the same filter
      // the domain already applies.
      const refunded = intent.refunds
        .filter((refund) => refund.status !== "failed")
        .reduce((sum, refund) => sum + refund.amountMinor, 0);
      return captured - refunded >= amountMinor;
    });
    if (target === undefined) {
      throw new Error(
        `PrismaPaymentsPortAdapter: no payment intent for order "${orderRef}" (${currency}) has ` +
          `sufficient remaining amount to refund ${amountMinor}`,
      );
    }

    const response = await this.payments.refundLifecycle({
      paymentIntentId: target.id,
      amountMinor,
      currency,
      idempotencyKey,
    });
    if (response.status >= 400) {
      throw new Error(
        `PrismaPaymentsPortAdapter: refund execution failed (status ${response.status}): ` +
          JSON.stringify(response.body),
      );
    }
  }
}

/**
 * Builds the `PaymentController` `PrismaPaymentsPortAdapter` bridges to — a second `wirePayments()`
 * instance from the one `wireAdmin`'s own `payments` screen uses, same convention as
 * `buildPaymentCapturedRuntime` building its own separate Orders slice: stateless composition over
 * the SAME shared `prisma` client and `paymentProvider`, so a second instance is cheap and correct,
 * not duplicated persistence.
 */
export function buildReturnsPaymentsPortAdapter(core: RuntimeCore): PrismaPaymentsPortAdapter {
  const tenantId = core.config.TENANT_DEFAULT_ID;
  const { payments } = wirePayments({
    serializer: core.serializer,
    idGenerator: core.idGenerator,
    clock: core.clock,
    prisma: core.prisma,
    tenantId,
    paymentProvider: core.paymentProvider,
  });
  return new PrismaPaymentsPortAdapter(core.prisma, tenantId, payments);
}

/**
 * Production Orders slice for the worker: Prisma repository + tx-scoped outbox (ADR-0003) +
 * `MarkOrderPaid` use case + the payments-captured consumer — activities/consumers call the
 * APPLICATION layer only. Tenant scope per ADR-0008: single-tenant deployments pin the
 * configured tenant; multi-tenant consumer sharding is the Tenancy-context follow-up (G-23).
 */
export function buildPaymentCapturedRuntime(
  core: RuntimeCore,
): KafkaConsumerRuntime<PaymentCapturedPayload> {
  const consumerGroup = "orders.payment-captured";
  const outbox = new OutboxWriter({
    store: new PrismaOutboxStore(core.prisma),
    translator: new OrderEventTranslator(),
    serializer: core.serializer,
    clock: core.clock,
    producer: "orders",
  });
  const orders = new PrismaOrderRepository({
    prisma: core.prisma,
    outbox,
    context: rootEventContext(core.idGenerator, core.config.TENANT_DEFAULT_ID),
    tenantId: core.config.TENANT_DEFAULT_ID,
  });
  const markOrderPaid = new MarkOrderPaid({
    orders,
    unitOfWork: new PrismaUnitOfWork(core.prisma),
    idGenerator: core.idGenerator,
    clock: core.clock,
    // M2-7: this consumer path omitted the same verification gate the admin path (`api.ts`) already
    // wires — reuses the identical `PrismaPaymentVerificationAdapter`, no new class, no contract
    // change (the field is already optional on `MarkOrderPaidDeps`).
    paymentVerification: new PrismaPaymentVerificationAdapter(
      core.prisma,
      core.config.TENANT_DEFAULT_ID,
    ),
  });
  const producer = new KafkaMessageProducer(core.kafka);
  return new KafkaConsumerRuntime({
    kafka: core.kafka,
    handler: new PaymentCapturedConsumer({ markOrderPaid, logger: core.logger }),
    consumerGroup,
    serializer: core.serializer,
    processedEvents: new PrismaProcessedEventStore(core.prisma, consumerGroup),
    deadLetters: new DeadLetterPublisher({
      publisher: producer,
      store: new PrismaDeadLetterStore(core.prisma, consumerGroup, core.idGenerator),
      clock: core.clock,
    }),
    retryPublisher: producer,
    clock: core.clock,
    logger: core.logger,
    // F5: without this the runtime silently defaults to `noopMetrics`, so every
    // `messaging_messages_*_total` series the SLO/alert rules query stays absent.
    metrics: core.metrics,
  });
}

/**
 * Tracking ingest slice (P1.3, investigation C-07): the consumer of
 * `tracking.event.captured.v1` — the one thing that was missing for the tracking platform to
 * function. The collector published to that topic and **nothing subscribed**, so every beacon was
 * accepted, written to Kafka, and aged out unprocessed: no validation, no enrichment, no identity
 * stitching, no attribution, no consent-gated delivery. All of it ran through
 * `ingestTrackingEvent`, which had zero callers.
 *
 * Reuses the SAME infrastructure the payments consumer uses — `KafkaConsumerRuntime`, the Postgres
 * inbox (`PrismaProcessedEventStore`), the DLQ topic + row, retry topics — rather than inventing a
 * second consumer stack.
 *
 * **Scope (P1.3).** Ingest only. Replay, the inspector timeline, and the event/parameter definition
 * registries are not wired: they need `packages/tracking`'s `runtime/{replay-runtime,telemetry}.ts`,
 * `inspector/timeline.ts` and `definitions/{event-definition,parameter}.ts`, which K7 deferred for
 * lack of primary-source evidence (`K7_FINAL_RECONCILIATION_REPORT.md`, and the per-symbol analysis
 * in `TRACKING_COMPATIBILITY_REPORT.md`). Nothing on the ingest path resolves any of them — the
 * records written here are the same immutable base-plus-revision rows replay reads, so enabling
 * replay later needs no data migration.
 *
 * Returns `null` when `TRACKING_INGEST_ENABLED` is off, so an unseeded deployment is unchanged.
 */
export async function buildTrackingIngestRuntime(
  core: RuntimeCore,
): Promise<KafkaConsumerRuntime<TrackingCapturedPayload> | null> {
  if (!core.config.TRACKING_INGEST_ENABLED) return null;

  const tenantId = core.config.TENANT_DEFAULT_ID;
  const registryStore = new PrismaTrackingRegistryStore(core.prisma, core.idGenerator);

  // Loaded once at boot, then hot-reloaded by the watcher. `loadTrackingRegistry` throws on an empty
  // registry rather than starting: a runtime that captured events and forwarded them nowhere is the
  // exact silent-loss failure this milestone exists to remove.
  const snapshot = await loadTrackingRegistry(registryStore, tenantId);
  const handle = new TrackingRegistryHandle(snapshot, await registryStore.signal(tenantId));
  new TrackingRegistryWatcher({
    handle,
    store: registryStore,
    tenantId,
    logger: core.logger,
    intervalMs: core.config.TRACKING_REGISTRY_POLL_MS,
  }).start();

  const consumerGroup = "tracking.ingest";
  const producer = new KafkaMessageProducer(core.kafka);
  const deadLetters = new PrismaDeadLetterStore(core.prisma, consumerGroup, core.idGenerator);

  const tracking = wireTrackingRuntime({
    db: core.prisma,
    idGenerator: core.idGenerator,
    secrets: createSecretProvider(),
    registry: handle,
    ruleSetKey: core.config.TRACKING_RULE_SET_KEY,
    clock: core.clock,
    processed: new PrismaProcessedEventStore(core.prisma, consumerGroup),
    deadLetters,
    logger: core.logger,
  });

  return new KafkaConsumerRuntime({
    kafka: core.kafka,
    handler: new TrackingIngestHandler({
      // A provider, not a fixed object: each call pins the snapshot current at that moment, so a
      // hot reload landing mid-event cannot change the definitions under it.
      ingest: () => tracking.ingest(),
      deadLetters,
      logger: core.logger,
      clock: core.clock,
    }),
    consumerGroup,
    serializer: core.serializer,
    processedEvents: new PrismaProcessedEventStore(core.prisma, consumerGroup),
    deadLetters: new DeadLetterPublisher({
      publisher: producer,
      store: deadLetters,
      clock: core.clock,
    }),
    retryPublisher: producer,
    clock: core.clock,
    logger: core.logger,
    metrics: core.metrics,
  });
}
