import {
  createAdminHttpApi,
  LoggingSignupEmailAdapter,
  type SignupEmailPort,
} from "@platform/admin";
import { PrismaAuditTrail } from "@platform/db";
import { composePaymentProviderRegistrations } from "@platform/payments";
import { InMemoryObjectStorage, type ObjectStoragePort } from "@platform/media";
import { InMemoryTotpMfaProvider, type MfaProviderResolver } from "@platform/security";
import { logger } from "@platform/utils";
import { loadRuntimeConfig, type RuntimeConfig } from "./config";
import {
  buildReturnsPaymentsPortAdapter,
  buildRuntimeCore,
  PrismaPaymentVerificationAdapter,
  PrismaRefundVerificationAdapter,
  type RuntimeCore,
} from "./composition";
import { startRuntimeTelemetry } from "./telemetry";

/**
 * C2-4: Security's default MFA provider (services/security/src/infrastructure/in-memory-auth-
 * adapters.ts) verifies against ONE hardcoded code — a reference/test stub, not proof of
 * possession. `buildRuntimeCore` now resolves a real `TotpMfaProvider` (RFC 6238) unconditionally
 * (`apps/runtime/src/composition.ts`); this guard takes the already-resolved resolver (mirroring
 * `assertProductionObjectStorageConfigured`'s shape) and fails closed outside `local` only while
 * the `totp` method still resolves to the in-memory stub — same present/absent convention as the
 * payment-provider and object-storage guards, not the appEnv-only shape this used to have before a
 * real provider existed. `local` gets a warning so the gap stays visible during development.
 */
export function assertProductionMfaConfigured(
  appEnv: RuntimeConfig["APP_ENV"],
  mfaProviders: MfaProviderResolver,
): void {
  if (!(mfaProviders.get("totp") instanceof InMemoryTotpMfaProvider)) return;
  if (appEnv === "local") {
    logger.warn("MFA is permissive: no production mfaProviders configured, APP_ENV=local");
  } else {
    throw new Error(
      "api: no production MfaProviderResolver is configured. The in-memory reference TOTP " +
        "provider (hardcoded validCode) must never answer MFA challenges outside APP_ENV=local " +
        "(C2-4). Pass mfaProviders in createAdminHttpApi's deps once a real provider exists.",
    );
  }
}

/**
 * V-1 (closed by C2-2): services/payments previously wired `PaymentProvider` unconditionally to
 * the in-memory stub (`verifyWebhook()` always `true`), so the public `POST /payments/webhook`
 * route would have accepted any payload with no real signature check. `buildRuntimeCore` now
 * resolves a real `StripePaymentProvider` (`@platform/psp-stripe`) whenever `STRIPE_SECRET_KEY`/
 * `STRIPE_WEBHOOK_SECRET` are configured; this guard takes the already-resolved value (mirroring
 * `assertProductionObjectStorageConfigured`'s shape — a real code path now exists, so "configured"
 * vs "not" must be told apart, not just asserted always-missing) and fails closed outside `local`
 * while it is still absent. `local` gets a warning so the gap stays visible during development.
 * Extracted so it can be exercised directly in tests and collected by `startApi`'s aggregated
 * guard (G0-4) alongside the other four.
 */
export function assertProductionPaymentProviderConfigured(
  appEnv: RuntimeConfig["APP_ENV"],
  payments: Pick<
    RuntimeCore,
    "paymentProvider" | "providerRegistrations" | "paymentCredentialVault"
  >,
): void {
  const problems: string[] = [];
  // WP-13 / open registry: ONE loop over exactly the registrations `wirePayments` will compose (the
  // same `composePaymentProviderRegistrations`), so N providers are N checks and a provider added
  // tomorrow is checked without touching this function. Each rule reasons about a registration's
  // declared backing and capabilities, never its name.
  for (const registration of composePaymentProviderRegistrations(payments)) {
    // A stub answers without a real PSP behind it (its `verifyWebhook` accepts anything), so it
    // must never serve a request outside `local`. (V-1: the Stripe binding is the one that falls
    // back to a stub when unconfigured.)
    if (registration.backing !== "real") {
      problems.push(
        `no production PaymentProvider is configured for "${registration.key}". The in-memory stub ` +
          "provider (verifyWebhook always returns true) must never accept POST /payments/webhook " +
          "outside APP_ENV=local (V-1)." +
          (registration.configurationHint === undefined
            ? ""
            : ` ${registration.configurationHint}`),
      );
    }
    // A provider that needs each merchant's own credentials must not seal them with a stand-in that
    // is not encryption (`InMemoryPaymentCredentialVault` — base64 in a column). `buildRuntimeCore`
    // only ever composes such a provider together with a real vault, so this is a tripwire on that
    // invariant. (Absent is fine: `UpdateMerchantPaymentSettings` refuses to let a merchant enable a
    // method nothing real backs, and the resolver has no stub to fall back to — unavailable is a
    // refusal, never a silent downgrade.)
    if (
      registration.capabilities.requiresMerchantCredentials &&
      (payments.paymentCredentialVault === undefined ||
        payments.paymentCredentialVault.backing !== "real")
    ) {
      problems.push(
        `payment provider "${registration.key}" needs merchant credentials but is composed without a ` +
          "real payment credential vault: merchants' PSP secrets would not be encrypted at rest " +
          "(WP-13). Set PAYMENT_CREDENTIALS_KEK_REF.",
      );
    }
  }
  if (problems.length === 0) return;
  if (appEnv === "local") {
    for (const problem of problems) {
      logger.warn(`Payments provider guard (APP_ENV=local, not enforced): ${problem}`);
    }
  } else {
    throw new Error(`api: ${problems.join(" Also: ")}`);
  }
}

/** G0-4 (launch-readiness review) — runs a guard, swallowing its throw into a message string
 * instead of letting it propagate. Lets `startApi` run every guard unconditionally and report
 * every failure in one error, instead of stopping at whichever guard happens to be checked
 * first — see the aggregation call site in `startApi` for why this matters operationally. */
function collectGuardFailure(guard: () => void): string | undefined {
  try {
    guard();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * M2-3 (reshaped by WP-14): services/licensing wired PaymentsPort/FinanceLedgerPort unconditionally to
 * InMemoryPaymentsAdapter/InMemoryFinanceLedgerAdapter in every environment — collect() always
 * "succeeded" and no money moved, so a merchant could hold an active paid subscription while zero
 * money was collected. This guard used to assert "always missing", because no real adapter existed.
 * One now can (`PlatformBillingPaymentsAdapter`, Morbeh's OWN PSP account, composed by
 * `buildRuntimeCore` from `PLATFORM_BILLING_STRIPE_*`), so — exactly like
 * `assertProductionPaymentProviderConfigured` — "configured" must be told apart from "not". It takes the
 * already-resolved adapter and fails closed outside `local` when it is absent, OR present but not
 * `backing: "real"`: a stub that "collects" successfully must be impossible outside `local`.
 * `local` gets a warning so the gap stays visible.
 *
 * Deliberately NOT asserted here: the Finance-ledger settlement post (`FinanceLedgerPort`). It is a
 * best-effort mirror of an invoice that is already durably `paid`, no real adapter exists yet, and
 * demanding one would keep this guard failing forever — tracked as an open gap, not hidden.
 */
export function assertProductionLicensingBillingConfigured(
  appEnv: RuntimeConfig["APP_ENV"],
  billing: Pick<RuntimeCore, "platformBillingPayments">,
): void {
  const payments = billing.platformBillingPayments;
  const problems: string[] = [];
  if (payments === undefined) {
    problems.push(
      "no production Licensing billing payments adapter is configured. Morbeh's own PSP account is " +
        "not set: the in-memory stub (collect() always succeeds, no money moves) must never back " +
        "billing outside APP_ENV=local (M2-3). Set PLATFORM_BILLING_STRIPE_SECRET_KEY and " +
        "PLATFORM_BILLING_STRIPE_WEBHOOK_SECRET (a dedicated billing endpoint, not the store's).",
    );
  } else if (payments.backing !== "real") {
    problems.push(
      "the Licensing billing payments adapter is not a real PSP-backed adapter (its backing is " +
        `"${payments.backing ?? "unknown"}"): a stub that "collects" without moving money must never ` +
        "back billing outside APP_ENV=local (M2-3).",
    );
  }
  if (problems.length === 0) return;
  if (appEnv === "local") {
    for (const problem of problems) {
      logger.warn(`Licensing billing guard (APP_ENV=local, not enforced): ${problem}`);
    }
  } else {
    throw new Error(`api: ${problems.join(" Also: ")}`);
  }
}

/**
 * M2-2: services/media wires `ObjectStoragePort` to `InMemoryObjectStorage` whenever no real
 * adapter is injected (services/media/src/infrastructure/object-storage-adapters.ts) — `exists()`
 * always returns `true` and `getDownloadUrl()` returns a URL template that has never pointed at
 * real storage, so every media asset's existence check and download link resolve through a stub
 * once Media's already-durable Postgres asset rows are browsed. `buildRuntimeCore` now resolves a
 * real `StorageServiceObjectStorage` whenever `S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/
 * `S3_SECRET_ACCESS_KEY` are configured; this guard fails closed outside `local` if the resolved
 * adapter is still the in-memory stub, mirroring the MFA (C2-4) / PaymentProvider (V-1) /
 * Licensing (M2-3) guards above. Takes the already-resolved adapter (not just `appEnv`) because,
 * unlike those three, a real code path exists here — the guard must tell "configured" from "not".
 */
export function assertProductionObjectStorageConfigured(
  appEnv: RuntimeConfig["APP_ENV"],
  objectStorage: ObjectStoragePort,
): void {
  if (!(objectStorage instanceof InMemoryObjectStorage)) return;
  if (appEnv === "local") {
    logger.warn("Media object storage is permissive: no production S3 config, APP_ENV=local");
  } else {
    throw new Error(
      "api: no production object-storage adapter is configured for Media (M2-2). The in-memory " +
        "stub (exists() always true, getDownloadUrl() a URL template that never points at real " +
        "storage) must never back Media outside APP_ENV=local. Set S3_ENDPOINT, S3_ACCESS_KEY_ID, " +
        "and S3_SECRET_ACCESS_KEY to configure the real MinIO/S3 adapter.",
    );
  }
}

/**
 * G-72: no real `SignupEmailPort` provider is wired anywhere in this codebase (D4 — "the user's
 * choice", deliberately out of scope) — `buildRuntimeCore` always resolves `LoggingSignupEmailAdapter`
 * (logs the signup-completion link instead of emailing it). This guard fails closed outside `local`
 * while that is still the resolved adapter, same `instanceof`-based shape as
 * `assertProductionMfaConfigured`/`assertProductionObjectStorageConfigured` above. Once a real
 * provider (Resend/SendGrid/SES/...) is chosen and wired through `AdminWiringDeps.signupEmail`, this
 * guard passes without any change to it.
 */
export function assertProductionSignupEmailConfigured(
  appEnv: RuntimeConfig["APP_ENV"],
  signupEmail: SignupEmailPort,
): void {
  if (!(signupEmail instanceof LoggingSignupEmailAdapter)) return;
  if (appEnv === "local") {
    logger.warn(
      "Signup verification email is permissive: no production SignupEmailPort configured, APP_ENV=local",
    );
  } else {
    throw new Error(
      "api: no production SignupEmailPort is configured (G-72). The logging dev adapter (writes " +
        "the signup-completion link to the log instead of emailing it) must never back account " +
        "verification outside APP_ENV=local. Pass signupEmail in createAdminHttpApi's deps once a " +
        "real provider (Resend/SendGrid/SES/...) is chosen and wired.",
    );
  }
}

/**
 * Stage 5 / Phase 3 (audit remediation plan, C-03): this guard originally covered 12 outbound
 * ports Orders/Checkout/Payments call to reach across context boundaries, all still offline
 * in-memory stubs. Tasks 9-13 wired real adapters over 8 of them (pricingValidation,
 * inventoryValidation, promotionValidation, inventoryPort, notifications, paymentPort,
 * ordersPort, paymentsNotifications), and Task 17a (C-2) wired a 9th, `orderCreation`, over
 * Orders' own `CreateOrderFromCheckout` — `wireAdmin` now wires each of those unconditionally by
 * default, so they no longer appear in `integrationPorts` below at all (re-listing one `undefined`
 * here would just re-stub a port that already has a real adapter and defeat this guard). Four
 * ports remain, for three different reasons:
 *   - `taxCalculation` / `shippingCalculation` are genuinely missing capabilities: nothing in
 *     this codebase computes tax or quotes a shipping rate yet (checkout's figures are a flat 10%
 *     stub and hardcoded numbers, respectively).
 *   - `shippingPort` is also a genuinely missing capability, found during Phase 3 implementation:
 *     `services/shipping`'s shipment-creation flow requires `weightGrams` per package, and nothing
 *     in Catalog, Orders, or Fulfillment computes or stores a product/order weight anywhere —
 *     fabricating one would be the same class of silent-wrong-behavior defect this phase exists to
 *     remove.
 *   - `financePort` is different in kind: not a missing capability but a deliberate guard against
 *     a redundant write path — and as of Task 17b (C-2) part of that async path is wired, though
 *     narrower than it looks. Finance's `OrdersPaidConsumer` IS registered with the Kafka consumer
 *     fleet: `worker.ts` builds it through `buildOrdersPaidConsumerRuntimes`
 *     (`apps/runtime/src/consumers/orders-paid.consumers.ts`) on `orders.order.paid`. But an order
 *     only ever reaches that topic through `markPaid`/`completePayment`
 *     (`services/orders/src/domain/order.ts`), i.e. the LEGACY `PlaceOrder`/admin-mark-paid path
 *     (status `placed` → `paid`) or a full walk to `payment_received`. Orders created by the
 *     checkout flow this phase exists to build (`CreateOrderFromCheckout` →
 *     `Order.createFromCheckout`) start and stay at status `created`, raising only
 *     `OrderTransitioned(created→created)` — and the transition table admits only
 *     `created → confirmed | cancelled`, with nothing in this codebase driving that chain further.
 *     So today: a legacy placed-then-marked-paid order posts its revenue/receivable entry
 *     asynchronously; a CHECKOUT-created order posts nothing, because `orders.order.paid` never
 *     fires for it. This is an OPEN C-2 sub-gap, deliberately left visible rather than papered
 *     over: closing it needs a product decision about how payment capture integrates with checkout
 *     completion (`CheckoutSession` has no method to record a captured payment reference back onto
 *     itself — `generatePaymentIntentRequest()` is a one-way DTO export), and fabricating a
 *     `paymentRef` to force the transition would put wrong-but-plausible entries in Finance's
 *     ledger. Pinned by an integration test over the real composition:
 *     `apps/admin/src/http/cart-checkout-pricing-security.e2e.test.ts`.
 *     The pair this port actually shadows (`PaymentsCapturedConsumer`/`RefundsIssuedConsumer`,
 *     `services/finance/src/interfaces/finance-consumers.ts`, covering
 *     `payments.payment_intent.captured`/`.refunded`) is now registered too (WP-11, F-11 closed):
 *     `worker.ts` builds them through `buildFinanceSettlementConsumerRuntimes`
 *     (`apps/runtime/src/consumers/finance-settlement.consumers.ts`), wrapped for the atomic path
 *     exactly like `OrdersPaidConsumer` above (a ledger append is not idempotent by itself). A
 *     captured payment now posts its fee entry and an issued refund now posts its contra entry,
 *     asynchronously, the same way the paid-order revenue entry does. `financePort` stays unwired
 *     here regardless — Payments' own `FinancePort` remains a permanent no-op stub
 *     (`InMemoryFinanceAdapter`), by design: a synchronous adapter here would be a second,
 *     uncoordinated write path over the same ledger the consumer fleet writes to asynchronously.
 * This remains a single combined guard (not per-port ones) so a caller sees every still-stubbed
 * port in one error rather than discovering them one boot-failure at a time — same reasoning as
 * when this guard covered 12 ports, just narrower now.
 */
export interface IntegrationPorts {
  readonly [portName: string]: unknown;
}

export function assertProductionIntegrationPortsConfigured(
  appEnv: RuntimeConfig["APP_ENV"],
  ports: IntegrationPorts,
): void {
  const stubbed = Object.entries(ports)
    .filter(([, port]) => port === undefined)
    .map(([name]) => name);
  if (stubbed.length === 0) return;
  if (appEnv === "local") {
    logger.warn("integration ports are offline in-memory stubs, APP_ENV=local", { stubbed });
  } else {
    throw new Error(
      `api: ${stubbed.join(", ")} ${stubbed.length === 1 ? "is" : "are"} still offline in-memory ` +
        "stub(s) (C-03). taxCalculation needs a tax provider integration (e.g. Avalara/TaxJar) or " +
        "a local tax-authority table — nothing in this codebase computes tax today (checkout's " +
        "tax figure is a flat 10% stub). shippingCalculation needs a shipping rate source (a " +
        "carrier rating API or an in-house rate table) — nothing in this codebase quotes a " +
        "shipping rate today (checkout's shipping figures are hardcoded). shippingPort needs a " +
        "source of package weight/dimensions per product — services/shipping's shipment-creation " +
        "flow requires weightGrams per package and nothing in Catalog, Orders, or Fulfillment " +
        "computes or stores one. financePort is different in kind from the other three: it is not " +
        "a missing capability but a deliberate guard against a redundant write path, and that path " +
        "is now fully async and real (WP-11, F-11 closed). Finance's OrdersPaidConsumer, " +
        "PaymentsCapturedConsumer, and RefundsIssuedConsumer are ALL registered with the Kafka " +
        "consumer fleet (worker.ts, via buildOrdersPaidConsumerRuntimes and " +
        "buildFinanceSettlementConsumerRuntimes in apps/runtime/src/consumers/), so a paid order " +
        "posts its ledger revenue entry, a captured payment posts its fee entry, and an issued " +
        "refund posts its contra entry, all asynchronously. financePort stays unwired here " +
        "regardless, since a synchronous adapter would be a second, uncoordinated write path over " +
        "the same ledger the consumer fleet now writes. " +
        "Whichever of these remain listed above " +
        "must never back real money, shipping cost, or tax calculation outside " +
        "APP_ENV=local. Wire the real adapter once the underlying capability exists " +
        "(taxCalculation / shippingCalculation / shippingPort), or pass it " +
        "explicitly in createAdminHttpApi's deps; leave financePort unwired unless deliberately " +
        "replacing the async consumer path.",
    );
  }
}

/**
 * API entrypoint (Sprint 2.9): the admin surface behind the full production pipeline —
 * JwtVerifier authentication, Keto-backed authorization (fail-closed outside local), Redis rate
 * limiting + idempotency, tenant-first resolution, health/ready/metrics/OpenAPI. gRPC binding
 * joins this process when the first internal caller (saga activities via api-clients, G-18)
 * exists — binding a port with zero callers would be decoration, not composition.
 *
 * G-39 (Runtime, partial close): `createAdminHttpApi` now passes `prisma`/`tenantId` through, so
 * every wired context with its own Prisma composition branch runs Prisma-backed here instead of
 * in-memory. M-4 (re-measured 2026-08-24 by grepping every context's own composition file — not
 * `wireAdmin` itself — for an `if (deps.prisma !== undefined)`-shaped branch, since receiving
 * `deps` and passing it through is not the same as branching on it): 37 of the 39 contexts
 * `wireAdmin` wires have their own such branch today. Only 2 wired contexts have none —
 * `analytics` (`wireAnalytics()`) and `platformConsole` (`wirePlatformConsole()`) — and that is
 * because neither takes a `deps` parameter at all, not because a branch was skipped. This does not
 * add a branch for those 2, only threads `prisma`/`tenantId` through what the other 37 already
 * have.
 *
 * Purchase Saga (Sprint A1 Task 5): also passes a real `paymentVerification` adapter, so the
 * admin backoffice `markOrderPaid` action is gated against an actually-captured payment instead
 * of accepting any non-empty string. The event-driven `PaymentCapturedConsumer` path (in
 * `worker.ts`) is untouched — it builds its own separate `MarkOrderPaid` instance and was already
 * trustworthy by construction.
 */
export async function startApi(config: RuntimeConfig, core?: RuntimeCore): Promise<void> {
  const runtime = core ?? buildRuntimeCore(config);

  // Stage 5 (C-03 partial): none of these 12 ports have a real adapter yet (Stage 6) — this object
  // is the single source of truth for both the guard below and the deps spread into
  // createAdminHttpApi further down, so the two can never drift apart. As Stage 6 lands real
  // adapters, each `undefined` here becomes a resolved adapter and the guard reflects it
  // automatically. Deliberately NOT annotated `: IntegrationPorts` — TS infers this literal's
  // precise per-key type (each `undefined` today, a resolved adapter type once Stage 6 lands one),
  // which is what lets the same object satisfy both the guard's index-signature parameter AND,
  // unmodified, the spread into createAdminHttpApi's precisely-typed deps further down. An
  // explicit `IntegrationPorts` annotation here would widen every property to `unknown` and break
  // that second use.
  const integrationPorts = {
    shippingPort: undefined,
    // paymentPort is deliberately absent here (Phase 3 Task 12b, C-3): `wireAdmin` now always
    // wires a real `OrdersPaymentAdapter` over Payments' own `createIntentLifecycle` ->
    // `captureLifecycle` chain by default — there is no offline stub left in production to guard
    // against, so listing it `undefined` here would just re-stub it and defeat the guard below.
    // inventoryPort is deliberately absent here (Phase 3 Task 12, C-3): `wireAdmin` now always
    // wires a real `OrdersInventoryAdapter` over Inventory's own `reserve` use case by default —
    // there is no offline stub left in production to guard against, so listing it `undefined` here
    // would just re-stub it and defeat the guard below.
    // notifications is deliberately absent here for the same reason (Phase 3 Task 12, C-3):
    // `wireAdmin` now always wires a real `OrdersNotificationAdapter` over Notifications' own
    // create -> queue -> send lifecycle by default.
    // pricingValidation is deliberately absent here (Phase 3 Task 9, C-3, closes H-1):
    // `wireAdmin` now always wires a real PricingValidationAdapter over Pricing's own
    // published-price data by default — there is no offline stub left in production to guard
    // against, so listing it `undefined` here would just re-stub it and defeat the guard below.
    // promotionValidation is deliberately absent here (Phase 3 Task 11, C-3): `wireAdmin` now
    // always wires a real PromotionValidationAdapter over Promotions' own EvaluatePromotions use
    // case by default — there is no offline stub left in production to guard against, so listing
    // it `undefined` here would just re-stub it and defeat the guard below.
    taxCalculation: undefined,
    shippingCalculation: undefined,
    // ordersPort/paymentsNotifications are deliberately absent here (Phase 3 Task 13, C-3):
    // `wireAdmin` now always wires real `PaymentsOrdersAdapter`/`PaymentsNotificationAdapter`
    // adapters over Orders' `getOrder` / Notifications' create -> queue -> send lifecycle by
    // default — there is no offline stub left in production to guard against, so listing them
    // `undefined` here would just re-stub them and defeat the guard below.
    // financePort stays listed: Payments' own `financePort` fallback (`InMemoryFinanceAdapter`)
    // is intentionally NOT replaced with a real adapter — Finance's ledger is written from the
    // async event path (Task 17b registered `OrdersPaidConsumer` on `orders.order.paid`;
    // `PaymentsCapturedConsumer`/`RefundsIssuedConsumer` remain an unregistered follow-up), and a
    // synchronous `financePort` adapter here would open a second write path over that same ledger
    // and risk double-posting it. This is a documented no-op stub, not a gap Stage 6 needs to
    // close. (The unregistered pair IS a real gap — tracked in the guard's own text above, not
    // fixable by wiring this port.)
    financePort: undefined,
    // orderCreation is deliberately absent here (Task 17a, C-2): `wireAdmin` now always wires a
    // real `OrderCreationAdapter` over Orders' own `CreateOrderFromCheckout` by default — there is
    // no offline stub left in production to guard against, so listing it `undefined` here would
    // just re-stub it and defeat the guard below.
  };

  // G0-4 (launch-readiness review): these 5 guards used to run sequentially and throw
  // immediately, so a boot attempt outside `local` discovered exactly one missing production
  // dependency per attempt — fix MFA, reboot, discover PSP, fix, reboot, discover Licensing, and
  // so on. Every guard now always runs; every failure is collected and reported together, so a
  // single boot attempt on a fresh environment reveals everything still missing at once.
  const guardFailures = [
    collectGuardFailure(() => assertProductionMfaConfigured(config.APP_ENV, runtime.mfaProviders)),
    collectGuardFailure(() => assertProductionPaymentProviderConfigured(config.APP_ENV, runtime)),
    collectGuardFailure(() => assertProductionLicensingBillingConfigured(config.APP_ENV, runtime)),
    collectGuardFailure(() =>
      assertProductionObjectStorageConfigured(config.APP_ENV, runtime.objectStorage),
    ),
    collectGuardFailure(() =>
      assertProductionIntegrationPortsConfigured(config.APP_ENV, integrationPorts),
    ),
    collectGuardFailure(() =>
      assertProductionSignupEmailConfigured(config.APP_ENV, runtime.signupEmail),
    ),
  ].filter((message): message is string => message !== undefined);

  if (guardFailures.length > 0) {
    throw new Error(
      `api: refusing to boot outside APP_ENV=local — ${guardFailures.length} production guard` +
        `${guardFailures.length === 1 ? "" : "s"} failed:\n\n` +
        guardFailures.map((message, index) => `${index + 1}. ${message}`).join("\n\n"),
    );
  }

  // H-03: the shipped config enables OTEL_TRACES_ENABLED/OTEL_METRICS_ENABLED, but no entrypoint ever
  // called startRuntimeTelemetry — no trace or metric ever left the process. createTelemetry() is a
  // no-op when both flags are false (local/tests), so this is side-effect-free off the production path.
  // Started after the fail-closed guards above so a boot-time rejection never spins up telemetry.
  const telemetry = startRuntimeTelemetry(config, "api");

  const app = await createAdminHttpApi({
    ...integrationPorts,
    mfaProviders: runtime.mfaProviders,
    serializer: runtime.serializer,
    idGenerator: runtime.idGenerator,
    clock: runtime.clock,
    accessControl: runtime.accessControl,
    authenticator: runtime.authenticator,
    rateLimiter: runtime.rateLimiter,
    idempotencyKeys: runtime.idempotencyKeys,
    responseCache: runtime.redis.cache,
    health: runtime.health,
    metrics: runtime.metrics,
    prisma: runtime.prisma,
    // T10.4: `multi` swaps the pinned resolver for the claim → header chain and runs the boot
    // assertion inside createAdminHttpApi. `tenantId` below is still passed because the tenancy
    // context (ADR-0014 8f) alone stays pinned to it; its routes reject every other tenant.
    tenantMode: runtime.config.TENANT_MODE,
    tenantId: runtime.config.TENANT_DEFAULT_ID,
    paymentVerification: new PrismaPaymentVerificationAdapter(runtime.prisma),
    // Phase A.2 (F-04 closure): gates Returns' DecideResolution refund amount against the
    // refundable ceiling derived from Payments' own charges/refunds ledger — same wiring
    // convention as paymentVerification above (mirrors PrismaPaymentVerificationAdapter).
    refundVerification: new PrismaRefundVerificationAdapter(runtime.prisma),
    // Phase A.3 (refund execution closure): the actual write side effect of an approved Returns
    // refund — bridges to Payments' own real `RefundPaymentLifecycle`, same wiring convention as
    // refundVerification above (present ⇒ real adapter; absent ⇒ Returns' own no-op stub, unchanged
    // for tests/local composition that don't pass it).
    paymentsPort: buildReturnsPaymentsPortAdapter(runtime),
    objectStorage: runtime.objectStorage,
    paymentProvider: runtime.paymentProvider,
    // WP-13: registered providers (Paymob today; each built per request from the tenant's own
    // sealed credentials) and the vault that seals them. Neither is a process-wide provider.
    providerRegistrations: runtime.providerRegistrations,
    paymentCredentialVault: runtime.paymentCredentialVault,
    // WP-14 T14.4: Licensing's REAL collection, through Morbeh's own PSP account. Absent ⇒ Licensing
    // keeps its in-memory stub, which assertProductionLicensingBillingConfigured refuses outside local.
    ...(runtime.platformBillingPayments === undefined
      ? {}
      : { payments: runtime.platformBillingPayments }),
    // H-02: every authorization decision on every admin action was recorded to a process-local,
    // never-pruned in-memory array (destroyed on restart, unbounded growth against the container
    // memory limit). The durable adapter, the `platform.audit_events` table, and the 7-year-retention
    // `platform.audit.entry_recorded.v1` topic all already existed — only this wiring was missing.
    auditTrail: new PrismaAuditTrail(runtime.prisma, runtime.idGenerator),
    // G-72: guarded above by assertProductionSignupEmailConfigured.
    signupEmail: runtime.signupEmail,
    storefrontPublicUrl: config.STOREFRONT_PUBLIC_URL,
    // H-04 (audit): /docs, /openapi.json, and /readyz's full dependency-error detail are verified
    // publicly reachable, unauthenticated, on a hosted deployment — the composition root (here,
    // not the transport) is what actually knows whether this process is `local` dev or a
    // deployed/staging/production one, so it — not a transport-level default — makes the call.
    exposeDocs: config.APP_ENV === "local",
    readinessDetail: config.APP_ENV === "local" ? "full" : "status-only",
  });
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  logger.info("api listening", { port: config.PORT, env: config.APP_ENV });

  const shutdown = async (): Promise<void> => {
    logger.info("api shutting down");
    await app.close();
    await runtime.redis.disconnect();
    await runtime.prisma.$disconnect();
    await telemetry.shutdown();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

if (process.argv[1]?.endsWith("api.ts") || process.argv[1]?.endsWith("api.js")) {
  startApi(loadRuntimeConfig()).catch((error: unknown) => {
    logger.error("api failed to start", { error: String(error) });
    process.exitCode = 1;
  });
}
