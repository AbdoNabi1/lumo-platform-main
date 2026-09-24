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
  runReadScoped,
  type Database,
} from "@platform/db";
import { JsonEventSerializer, type EventSerializer } from "@platform/domain-events";
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
import {
  EnvelopePaymentCredentialVault,
  wirePayments,
  type PaymentController,
  type PaymentCredentialVault,
  type ProviderRegistration,
} from "@platform/payments";
import { LoggingSignupEmailAdapter, type SignupEmailPort } from "@platform/admin";
import { paymobRegistration } from "./paymob-registration";
import { StripePaymentProvider } from "@platform/psp-stripe";
import { PlatformBillingPaymentsAdapter, type PaymentsPort } from "@platform/licensing";
import {
  NodeCrypto,
  TotpMfaProvider,
  MapMfaProviderResolver,
  type MfaProviderResolver,
} from "@platform/security";
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
import { EnvelopeCipher, KeyAliasRegistry, createSecretProvider } from "@platform/secrets";
import { createS3Client, S3StorageService } from "@platform/storage";
import { logger, type Logger } from "@platform/utils";
import type { RuntimeConfig } from "./config";
import { RuntimeMetrics } from "./metrics";
import { createOryFetch, isOryNetworkApiKey } from "./ory-fetch";
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
   * The payment providers registered from outside `services/payments` (which ships Stripe's binding
   * and cash on delivery itself) — the whole of "adding a provider": a key, declared capabilities
   * and a factory, registered once here at composition time (ADR-0014). Today that is Paymob
   * (`@platform/psp-paymob`), present only when `PAYMENT_CREDENTIALS_KEK_REF` is configured — and
   * then together with the real envelope vault their credentials are sealed with — otherwise it is
   * simply not registered: unavailable, never stubbed. A registration holds no merchant credential;
   * its factory receives one per call.
   */
  readonly providerRegistrations: readonly ProviderRegistration[];
  readonly paymentCredentialVault: PaymentCredentialVault | undefined;
  /**
   * WP-14 T14.4: Licensing's REAL `PaymentsPort` — Morbeh charging a merchant through MORBEH'S OWN
   * PSP account (`PLATFORM_BILLING_STRIPE_*`), as a caller of the same `PaymentProvider` port
   * (`buildPlatformBillingPayments`). `undefined` ⇒ not configured: Licensing then keeps its
   * always-succeeds in-memory stub, which `assertProductionLicensingBillingConfigured` refuses
   * outside `local`. Holds no tenant and no merchant credential, and is built from nothing the
   * per-tenant resolvers use.
   */
  readonly platformBillingPayments: PaymentsPort | undefined;
  /**
   * Production MFA provider resolver (C2-4). Real RFC 6238 `TotpMfaProvider` over `NodeCrypto`,
   * built unconditionally — unlike `objectStorage`/`paymentProvider`, this needs no external
   * account/credentials to be "real," only a `CryptoPort`, which is always available.
   * `apps/runtime/src/api.ts` refuses to boot outside `local` only while the resolved `totp`
   * provider is still the in-memory reference stub, which this composition never produces.
   */
  readonly mfaProviders: MfaProviderResolver;
  /**
   * G-72: dispatches the two signup-related emails (complete-account / already-registered). Always
   * `LoggingSignupEmailAdapter` today — no real provider is wired anywhere in this composition (D4:
   * "the user's choice", not in scope). `apps/runtime/src/api.ts` refuses to boot outside `local`
   * while this is still that logging adapter.
   */
  readonly signupEmail: SignupEmailPort;
}

export function buildRuntimeCore(config: RuntimeConfig): RuntimeCore {
  // T10.4: TENANT_MODE=multi no longer fails here. What holds instead — and where it is enforced:
  //  - API: createAdminHttpApi resolves the tenant per request (verified claim, then header; an
  //    unresolved tenant is rejected, never defaulted) and, under multi, runs assertMultiTenantReady
  //    (apps/admin/src/tenant-mode-guard.ts): a behavioural probe of the resolver chain plus a scan
  //    of the composed graph for any construction-time tenant. The one recorded exception is
  //    services/tenancy (ADR-0014 8f), whose routes are pinned to TENANT_DEFAULT_ID and 403 every
  //    other tenant.
  //  - Worker: startWorker still refuses multi (assertWorkerTenantModeSupported) because its event
  //    consumers take TENANT_DEFAULT_ID at construction until the envelope carries a required
  //    tenantId (G-64). This function is shared by both processes and no longer decides for them.
  // Multi mode is now POSSIBLE, not SAFE: T10.5 (adversarial isolation suite) has not been written.
  // Do not enable TENANT_MODE=multi anywhere until it has.
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
  // WP-17 (Morbeh F-14): this was `InMemoryEventSerializer` from `@platform/domain-events/testing`
  // — a test-only double ("never import it from production code", per its own doc comment) —
  // imported into the production composition root unconditionally, with no boot-refusal guard.
  // `JsonEventSerializer` is byte-identical (same `contentType`, same JSON encode/decode) but is
  // the package's actual production export, not a test double.
  const serializer: EventSerializer = new JsonEventSerializer();

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
        fetch: createOryFetch(config.ORY_API_KEY),
        // Same signal createOryFetch uses (isOryNetworkApiKey, not a bare !== undefined — a
        // blank-but-set key must resolve the same way in both places, see that function's doc):
        // an API key means Ory Network, whose OPL-compiled namespaces require subject-set tuples
        // (see keto.ts's subjectConvention doc). Absent ⇒ self-hosted Keto
        // (infrastructure/docker/keto/keto.yml), unchanged subject_id behavior.
        subjectConvention: isOryNetworkApiKey(config.ORY_API_KEY) ? "subject_set" : "subject_id",
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

  // WP-13: merchant PSP credentials. The vault and the Paymob factory come together or not at all,
  // so a merchant can never be handed a Paymob provider whose secrets were sealed by a stub.
  const paymentCredentialVault: PaymentCredentialVault | undefined =
    config.PAYMENT_CREDENTIALS_KEK_REF !== undefined
      ? buildPaymentCredentialVault(config.PAYMENT_CREDENTIALS_KEK_REF)
      : undefined;
  const providerRegistrations: readonly ProviderRegistration[] =
    paymentCredentialVault !== undefined ? [paymobRegistration(logger)] : [];

  const platformBillingPayments = buildPlatformBillingPayments(config);

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
    providerRegistrations,
    paymentCredentialVault,
    platformBillingPayments,
    mfaProviders,
    signupEmail: new LoggingSignupEmailAdapter(),
  };
}

/**
 * Morbeh's own billing PSP as Licensing's `PaymentsPort` (WP-14 T14.4). Reads ONLY the dedicated
 * `PLATFORM_BILLING_STRIPE_*` pair — never `STRIPE_*` (the store's account) and never anything a
 * merchant configured — and takes no tenant, so it cannot resolve a provider from one. The adapter is
 * handed a bare `PaymentProvider`, not a resolver: see `PlatformBillingPaymentsAdapter`.
 *
 * Half-configured (one of the two set) ⇒ `undefined` and the boot guard names what is missing.
 * The billing webhook secret equal to the store's ⇒ throws: the same Stripe endpoint would deliver
 * billing events to the store's webhook handler.
 */
export function buildPlatformBillingPayments(
  config: Pick<
    RuntimeConfig,
    | "PLATFORM_BILLING_STRIPE_SECRET_KEY"
    | "PLATFORM_BILLING_STRIPE_WEBHOOK_SECRET"
    | "STRIPE_WEBHOOK_SECRET"
    | "STRIPE_API_BASE"
  >,
): PaymentsPort | undefined {
  const secretKey = config.PLATFORM_BILLING_STRIPE_SECRET_KEY;
  const webhookSecret = config.PLATFORM_BILLING_STRIPE_WEBHOOK_SECRET;
  if (secretKey === undefined || webhookSecret === undefined) return undefined;
  if (webhookSecret === config.STRIPE_WEBHOOK_SECRET) {
    throw new Error(
      "PLATFORM_BILLING_STRIPE_WEBHOOK_SECRET must not equal STRIPE_WEBHOOK_SECRET: billing needs its own " +
        "Stripe webhook endpoint, or its events would be delivered to the merchant-store webhook handler (WP-14).",
    );
  }
  return new PlatformBillingPaymentsAdapter({
    provider: new StripePaymentProvider({
      secretKey,
      webhookSecret,
      apiBase: config.STRIPE_API_BASE,
      fetch: async (url, init) => fetch(url, init),
      logger,
    }),
  });
}

/**
 * The real credential vault (WP-13): `@platform/secrets`' envelope encryption over
 * `@platform/security`'s `NodeCrypto` (AES-256-GCM; the data key is wrapped under a KEK derived from
 * `kekRef`). A KMS-backed `CryptoPort` satisfies the same `KeyWrapCipher` shape and can replace
 * `NodeCrypto` here without touching Payments.
 */
function buildPaymentCredentialVault(kekRef: string): PaymentCredentialVault {
  const aliases = new KeyAliasRegistry();
  aliases.set("payments-credentials", kekRef);
  return new EnvelopePaymentCredentialVault(
    new EnvelopeCipher(new NodeCrypto(), aliases),
    "payments-credentials",
  );
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

  /** ADR-0014 (WP-10, T10.3): stateless per tenant — `PaymentVerificationPort.hasCapturedPayment` carries `tenantId` per call. */
  constructor(prisma: RuntimeCore["prisma"]) {
    this.prisma = prisma;
  }

  async hasCapturedPayment(
    orderId: string,
    paymentRef: string,
    tenantId: string,
  ): Promise<boolean> {
    const row = await runReadScoped(this.prisma, tenantId, (client) =>
      client.paymentIntent.findFirst({
        where: { id: paymentRef, orderRef: orderId, tenantId, status: "captured" },
        select: { id: true },
      }),
    );
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

  /** ADR-0014 (WP-10, T10.3): stateless per tenant — `RefundVerificationPort.isRefundable` carries `tenantId` per call. */
  constructor(prisma: RuntimeCore["prisma"]) {
    this.prisma = prisma;
  }

  async isRefundable(
    orderRef: string,
    amountMinor: number,
    currency: string,
    tenantId: string,
  ): Promise<boolean> {
    const intents = await runReadScoped(this.prisma, tenantId, (client) =>
      client.paymentIntent.findMany({
        where: { orderRef, tenantId, currency },
        include: { charges: true, refunds: true },
      }),
    );
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
  private readonly payments: PaymentController;

  /** ADR-0014 (WP-10, T10.3): stateless per tenant — `PaymentsPort.requestRefund` carries `tenantId` per call. */
  constructor(prisma: RuntimeCore["prisma"], payments: PaymentController) {
    this.prisma = prisma;
    this.payments = payments;
  }

  async requestRefund(
    orderRef: string,
    amountMinor: number,
    currency: string,
    idempotencyKey: string,
    tenantId: string,
  ): Promise<void> {
    const intents = await runReadScoped(this.prisma, tenantId, (client) =>
      client.paymentIntent.findMany({
        where: { orderRef, tenantId, currency },
        include: { charges: true, refunds: true },
      }),
    );
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
      tenantId,
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
  const { payments } = wirePayments({
    serializer: core.serializer,
    idGenerator: core.idGenerator,
    clock: core.clock,
    prisma: core.prisma,
    paymentProvider: core.paymentProvider,
    // WP-13: a Returns refund of a Paymob payment goes out through the same per-merchant provider.
    providerRegistrations: core.providerRegistrations,
    paymentCredentialVault: core.paymentCredentialVault,
  });
  return new PrismaPaymentsPortAdapter(core.prisma, payments);
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
    context: rootEventContext(core.idGenerator),
  });
  const markOrderPaid = new MarkOrderPaid({
    orders,
    unitOfWork: new PrismaUnitOfWork(core.prisma),
    idGenerator: core.idGenerator,
    clock: core.clock,
    // M2-7: this consumer path omitted the same verification gate the admin path (`api.ts`) already
    // wires — reuses the identical `PrismaPaymentVerificationAdapter`, no new class, no contract
    // change (the field is already optional on `MarkOrderPaidDeps`).
    paymentVerification: new PrismaPaymentVerificationAdapter(core.prisma),
  });
  const producer = new KafkaMessageProducer(core.kafka);
  return new KafkaConsumerRuntime({
    kafka: core.kafka,
    handler: new PaymentCapturedConsumer({
      markOrderPaid,
      logger: core.logger,
      // G-64 (class D): sourced from config until `tenantId` is required on the event envelope.
      tenantId: core.config.TENANT_DEFAULT_ID,
    }),
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
