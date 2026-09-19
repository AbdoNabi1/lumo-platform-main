import { describe, expect, it, vi } from "vitest";
import type { Database } from "@platform/db";
import type { PaymentController } from "@platform/payments";
import { loadRuntimeConfig } from "./config";
import {
  buildPaymentCapturedRuntime,
  buildRuntimeCore,
  PrismaPaymentsPortAdapter,
  PrismaPaymentVerificationAdapter,
  PrismaRefundVerificationAdapter,
} from "./composition";
import { buildJobs, startJobLoop } from "./scheduler";
import {
  assertProductionIntegrationPortsConfigured,
  assertProductionLicensingBillingConfigured,
  assertProductionObjectStorageConfigured,
  assertProductionPaymentProviderConfigured,
  startApi,
} from "./api";
import { InMemoryObjectStorage, StorageServiceObjectStorage } from "@platform/media";
import { TotpMfaProvider } from "@platform/security";
import { StripePaymentProvider } from "@platform/psp-stripe";
import type { Logger } from "@platform/utils";

const validEnv = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://lumo:lumo@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:19092",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
  KETO_WRITE_URL: "https://keto.morbeh.local:4467",
  KRATOS_PUBLIC_URL: "https://kratos.morbeh.local:4433",
  KRATOS_ADMIN_URL: "https://kratos.morbeh.local:4434",
} as NodeJS.ProcessEnv;

describe("runtime configuration (the ONLY process.env reader)", () => {
  it("parses a valid environment with typed defaults", () => {
    const config = loadRuntimeConfig(validEnv);
    expect(config.TENANT_DEFAULT_ID).toBe("tenant-local");
    expect(config.RATE_LIMIT_PER_MINUTE).toBe(300);
    expect(config.OUTBOX_RETENTION_DAYS).toBe(7);
  });

  it("rejects a missing database url with a field-named error", () => {
    expect(() => loadRuntimeConfig({ ...validEnv, DATABASE_URL: undefined })).toThrow(
      /DATABASE_URL/,
    );
  });

  // Phase A.13 (Task 1/2): DATABASE_POOL_MAX/DATABASE_CONNECT_TIMEOUT_MS/DATABASE_STATEMENT_TIMEOUT_MS
  // used to be entirely absent from this schema — `buildRuntimeCore` built its PrismaClient from an
  // object missing these fields (silenced by an unsafe `as` cast), so they were unconfigurable for the
  // actual production runtime even though `@platform/config/server`'s equivalent schema validated them.
  it("defaults DATABASE_POOL_MAX/DATABASE_CONNECT_TIMEOUT_MS/DATABASE_STATEMENT_TIMEOUT_MS when unset", () => {
    const config = loadRuntimeConfig(validEnv);
    expect(config.DATABASE_POOL_MAX).toBe(10);
    expect(config.DATABASE_CONNECT_TIMEOUT_MS).toBe(10_000);
    expect(config.DATABASE_STATEMENT_TIMEOUT_MS).toBe(30_000);
  });

  it("lets explicit env override the database pool/timeout defaults", () => {
    const config = loadRuntimeConfig({
      ...validEnv,
      DATABASE_POOL_MAX: "20",
      DATABASE_CONNECT_TIMEOUT_MS: "5000",
      DATABASE_STATEMENT_TIMEOUT_MS: "15000",
    });
    expect(config.DATABASE_POOL_MAX).toBe(20);
    expect(config.DATABASE_CONNECT_TIMEOUT_MS).toBe(5_000);
    expect(config.DATABASE_STATEMENT_TIMEOUT_MS).toBe(15_000);
  });

  it("rejects a non-positive DATABASE_POOL_MAX", () => {
    expect(() => loadRuntimeConfig({ ...validEnv, DATABASE_POOL_MAX: "0" })).toThrow(
      /DATABASE_POOL_MAX/,
    );
  });

  it("REJECTS SECURITY_ZERO_TRUST_ENFORCEMENT=on — buildSecurityHttpGuard is not mounted in any entrypoint (H-01)", () => {
    expect(() =>
      loadRuntimeConfig({
        ...validEnv,
        SECURITY_ZERO_TRUST_ENFORCEMENT: "on",
        SECURITY_PRINCIPAL_PROVISIONING: "on",
      }),
    ).toThrow(/SECURITY_ZERO_TRUST_ENFORCEMENT=on is not supported yet/);
  });
});

describe("composition root (lazy clients — graph builds without any Docker runtime)", () => {
  it("builds the full core graph side-effect-free", () => {
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));
    expect(core.authenticator).toBeDefined();
    expect(core.rateLimiter).toBeDefined();
    expect(core.idempotencyKeys).toBeDefined();
    expect(core.distributedLock).toBeDefined();
  });

  it("REQUIRES a JWKS issuer — no fake identity provider exists (D-048)", () => {
    expect(() =>
      buildRuntimeCore(loadRuntimeConfig({ ...validEnv, AUTH_JWKS_URL: undefined })),
    ).toThrow(/AUTH_JWKS_URL/);
  });

  it("FAILS CLOSED outside local when Keto is not configured", () => {
    expect(() =>
      buildRuntimeCore(loadRuntimeConfig({ ...validEnv, APP_ENV: "production" })),
    ).toThrow(/KETO_READ_URL/);
  });

  it("FAILS CLOSED on TENANT_MODE=multi — repositories are pinned to one tenant at construction (C2-6)", () => {
    expect(() =>
      buildRuntimeCore(loadRuntimeConfig({ ...validEnv, TENANT_MODE: "multi" })),
    ).toThrow(/TENANT_MODE=multi/);
  });

  it("composes the production payment-captured consumer graph (worker slice)", () => {
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));
    const runtime = buildPaymentCapturedRuntime(core);
    expect(runtime.topic).toBe("payments.payment_intent.captured.v1");
    expect(runtime.consumerGroup).toBe("orders.payment-captured");
    expect(runtime.isRunning).toBe(false); // built, not started — start() needs the broker
  });

  it("registers postgres + redis health checks on the core registry, reporting unhealthy when they're unreachable", async () => {
    // Phase A.20 (Task 8): `validEnv` points at the shared dev-Docker postgres/redis
    // (localhost:5432/6379) — this assertion used to rely on nothing actually being there, which
    // held for the project's entire prior history (Docker/Postgres was broken) but is now false
    // once real infrastructure is running (see PHASE_A19_REAL_POSTGRESQL_VALIDATION_REPORT.md
    // §10). The health check itself was never broken — it correctly reports real reachability.
    // This test's actual contract is "unreachable infra reports unhealthy," which needs a
    // deliberately-unreachable target (port 1 refuses connections immediately) so it holds
    // regardless of whether Docker happens to be running on the host.
    const core = buildRuntimeCore(
      loadRuntimeConfig({
        ...validEnv,
        DATABASE_URL: "postgresql://lumo:lumo@127.0.0.1:1/lumo",
        REDIS_URL: "redis://127.0.0.1:1",
      }),
    );
    const report = await core.health.run();
    expect(report.components.map((c) => c.name)).toEqual(
      expect.arrayContaining(["postgres", "redis"]),
    );
    expect(report.status).toBe("unhealthy"); // both probes fail to connect
  });

  it("resolves InMemoryObjectStorage when no S3 config is present (M2-2) — unchanged prior behavior", () => {
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));
    expect(core.objectStorage).toBeInstanceOf(InMemoryObjectStorage);
  });

  it("resolves the real StorageServiceObjectStorage once S3 endpoint + credentials are configured (M2-2)", () => {
    const core = buildRuntimeCore(
      loadRuntimeConfig({
        ...validEnv,
        S3_ENDPOINT: "http://localhost:9000",
        S3_ACCESS_KEY_ID: "minioadmin",
        S3_SECRET_ACCESS_KEY: "minioadmin",
      }),
    );
    expect(core.objectStorage).toBeInstanceOf(StorageServiceObjectStorage);
  });

  it("resolves a real TotpMfaProvider unconditionally (C2-4) — no external credentials needed, unlike Stripe/S3", () => {
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));
    expect(core.mfaProviders.get("totp")).toBeInstanceOf(TotpMfaProvider);
  });

  it("resolves paymentProvider=undefined when no Stripe config is present (C2-2) — unchanged prior behavior", () => {
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));
    expect(core.paymentProvider).toBeUndefined();
  });

  it("resolves the real StripePaymentProvider once STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET are configured (C2-2)", () => {
    const core = buildRuntimeCore(
      loadRuntimeConfig({
        ...validEnv,
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_WEBHOOK_SECRET: "whsec_test_123",
      }),
    );
    expect(core.paymentProvider).toBeInstanceOf(StripePaymentProvider);
  });
});

describe("api entrypoint", () => {
  it("no longer fails on MFA (C2-4 closed) — buildRuntimeCore's default composition now resolves a real TotpMfaProvider unconditionally, not just in local", async () => {
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv)); // local composition
    const prodConfig = loadRuntimeConfig({
      ...validEnv,
      APP_ENV: "production",
      KETO_READ_URL: "https://keto.morbeh.local",
    });
    // The remaining 4 guards (no Stripe/Licensing/S3/tax-shipping adapters wired) still reject —
    // this proves specifically that MFA is no longer among the reasons, not that boot succeeds.
    await expect(startApi(prodConfig, core)).rejects.not.toThrow(/MfaProviderResolver/);
  });

  it("G0-4 (launch-readiness review): a fresh non-local boot names EVERY failed guard in one error, not just the first", async () => {
    // The default local composition core has no production PSP/Licensing/ObjectStorage/
    // integration-port adapters wired at all — every one of the 4 still-open guards should fail
    // together. MFA (C2-4) is deliberately absent from this list — closed above.
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));
    const prodConfig = loadRuntimeConfig({
      ...validEnv,
      APP_ENV: "production",
      KETO_READ_URL: "https://keto.morbeh.local",
    });
    await expect(startApi(prodConfig, core)).rejects.toThrow(/4 production guards failed/);
    await expect(startApi(prodConfig, core)).rejects.toThrow(/PaymentProvider/);
    await expect(startApi(prodConfig, core)).rejects.toThrow(/Licensing/);
    await expect(startApi(prodConfig, core)).rejects.toThrow(/object-storage/);
    await expect(startApi(prodConfig, core)).rejects.toThrow(/still offline in-memory/);
  });

  it("FAILS CLOSED outside local without a production PaymentProvider (V-1) — same shape as the MFA guard, checked independently of it", () => {
    expect(() => assertProductionPaymentProviderConfigured("production", undefined)).toThrow(
      /PaymentProvider/,
    );
    expect(() => assertProductionPaymentProviderConfigured("production", undefined)).toThrow(
      /payments\/webhook/,
    );
  });

  it("stays permissive in local (matches the MFA guard's dev-mode behavior)", () => {
    expect(() => assertProductionPaymentProviderConfigured("local", undefined)).not.toThrow();
  });

  it("stays permissive outside local once a real PaymentProvider is resolved (C2-2)", () => {
    const fakeProvider = { createIntent: vi.fn() } as unknown as Parameters<
      typeof assertProductionPaymentProviderConfigured
    >[1];
    expect(() =>
      assertProductionPaymentProviderConfigured("production", fakeProvider),
    ).not.toThrow();
  });

  it("FAILS CLOSED outside local without a production Licensing billing adapter (M2-3) — same shape as the PaymentProvider guard, checked independently of it", () => {
    expect(() => assertProductionLicensingBillingConfigured("production")).toThrow(/Licensing/);
    expect(() => assertProductionLicensingBillingConfigured("production")).toThrow(
      /payments\/financeLedger/,
    );
  });

  it("stays permissive in local (matches the PaymentProvider guard's dev-mode behavior)", () => {
    expect(() => assertProductionLicensingBillingConfigured("local")).not.toThrow();
  });

  it("FAILS CLOSED outside local while the resolved object-storage adapter is still the in-memory stub (M2-2)", () => {
    expect(() =>
      assertProductionObjectStorageConfigured("production", new InMemoryObjectStorage()),
    ).toThrow(/object-storage/);
    expect(() =>
      assertProductionObjectStorageConfigured("production", new InMemoryObjectStorage()),
    ).toThrow(/S3_ENDPOINT/);
  });

  it("stays permissive in local while still the in-memory stub (matches the other guards' dev-mode behavior)", () => {
    expect(() =>
      assertProductionObjectStorageConfigured("local", new InMemoryObjectStorage()),
    ).not.toThrow();
  });

  it("does NOT throw outside local once a real adapter is resolved — the guard is adapter-identity-based, not appEnv-only", () => {
    const core = buildRuntimeCore(
      loadRuntimeConfig({
        ...validEnv,
        S3_ENDPOINT: "http://localhost:9000",
        S3_ACCESS_KEY_ID: "minioadmin",
        S3_SECRET_ACCESS_KEY: "minioadmin",
      }),
    );
    expect(() =>
      assertProductionObjectStorageConfigured("production", core.objectStorage),
    ).not.toThrow();
  });

  it("FAILS CLOSED outside local while any integration port is still an offline stub (Phase 3, C-03) — names every stubbed port in one error, matching the real production literal (api.ts's `integrationPorts`) which lists exactly these 4 after Tasks 9-13 wired real adapters over 8 of the original 12 and Task 17a wired the 9th, orderCreation (C-2)", () => {
    const allStubbed = {
      shippingPort: undefined,
      taxCalculation: undefined,
      shippingCalculation: undefined,
      financePort: undefined,
    };
    expect(() => assertProductionIntegrationPortsConfigured("production", allStubbed)).toThrow(
      /shippingPort, taxCalculation, shippingCalculation, financePort/,
    );
    // taxCalculation / shippingCalculation: genuinely-missing capabilities.
    expect(() => assertProductionIntegrationPortsConfigured("production", allStubbed)).toThrow(
      /taxCalculation needs a tax provider integration/,
    );
    expect(() => assertProductionIntegrationPortsConfigured("production", allStubbed)).toThrow(
      /shippingCalculation needs a shipping rate source/,
    );
    // shippingPort: the third genuinely-missing capability, found during Phase 3 implementation
    // (not one of the two the original plan named) — nothing computes package weight anywhere.
    expect(() => assertProductionIntegrationPortsConfigured("production", allStubbed)).toThrow(
      /shippingPort needs a source of package weight\/dimensions/,
    );
    // financePort: deliberately different in kind — a guard against a redundant write path, not a
    // missing capability. Assert the distinction is actually stated, not just the port name.
    expect(() => assertProductionIntegrationPortsConfigured("production", allStubbed)).toThrow(
      /financePort is different in kind/,
    );
    // This sentence has been wrong in multiple directions over time, so its CURRENT (correct)
    // state is pinned directly rather than by another round of "must not say X":
    //  - Before 1b9c639 it claimed Finance "already receives" these postings via
    //    PaymentsCapturedConsumer/RefundsIssuedConsumer — false, neither was registered.
    //  - Between Task 17b and that fix it claimed worker.ts "registers exactly one consumer" and
    //    "nothing for Finance" — false in the other direction, since Task 17b registered Finance's
    //    OrdersPaidConsumer over orders.order.paid (buildOrdersPaidConsumerRuntimes).
    //  - WP-11 (F-11) registered the remaining two (buildFinanceSettlementConsumerRuntimes), so
    //    the message now states all three are registered — the gap it used to describe is closed.
    expect(() => assertProductionIntegrationPortsConfigured("production", allStubbed)).toThrow(
      /OrdersPaidConsumer, PaymentsCapturedConsumer, and RefundsIssuedConsumer are ALL registered/,
    );
    // ...and must NOT still claim either consumer is unregistered.
    expect(() => assertProductionIntegrationPortsConfigured("production", allStubbed)).not.toThrow(
      /nothing instantiates them/,
    );
    expect(() => assertProductionIntegrationPortsConfigured("production", allStubbed)).not.toThrow(
      /registers exactly one consumer/,
    );
    // orderCreation (Task 17b, C-2): Task 16 listed it here as a genuinely-missing capability;
    // Task 17a wired `OrderCreationAdapter` over Orders' own `CreateOrderFromCheckout` as
    // `wireAdmin`'s UNCONDITIONAL default, so re-listing it would re-stub a port that already has
    // a real adapter — exactly what happened to the other 8 in Phase 3. It must be gone from both
    // the literal and the error text.
    expect(() => assertProductionIntegrationPortsConfigured("production", allStubbed)).not.toThrow(
      /orderCreation/,
    );
  });

  it("stays permissive in local (matches the other guards' dev-mode behavior)", () => {
    expect(() =>
      assertProductionIntegrationPortsConfigured("local", { paymentPort: undefined }),
    ).not.toThrow();
  });

  it("FAILS CLOSED outside local naming only the ports still stubbed, once some are resolved", () => {
    const fakePaymentPort = { requestCapture: vi.fn() };
    expect(() =>
      assertProductionIntegrationPortsConfigured("production", {
        paymentPort: fakePaymentPort,
        inventoryPort: undefined,
      }),
    ).toThrow(/^api: inventoryPort is still offline/);
  });

  it("stays permissive outside local once every port is resolved", () => {
    const fakePort = { requestCapture: vi.fn() };
    expect(() =>
      assertProductionIntegrationPortsConfigured("production", {
        paymentPort: fakePort,
        inventoryPort: fakePort,
      }),
    ).not.toThrow();
  });
});

describe("PrismaPaymentVerificationAdapter (M2-7 — now also wired into the consumer path's MarkOrderPaid, not just the admin path)", () => {
  interface FakeRow {
    readonly id: string;
    readonly orderRef: string;
    readonly tenantId: string;
    readonly status: string;
  }

  function fakePrisma(rows: readonly FakeRow[]): Database {
    const client = {
      $executeRaw: async () => 0,
      paymentIntent: {
        findFirst: async ({ where }: { where: FakeRow }) => {
          const row = rows.find(
            (r) =>
              r.id === where.id &&
              r.orderRef === where.orderRef &&
              r.tenantId === where.tenantId &&
              r.status === where.status,
          );
          return row ?? null;
        },
      },
      // Deliberately partial fixture (`paymentIntent.findFirst` + the transaction hooks
      // `runReadScoped` needs) — needs the `unknown` hop since it has no structural overlap with
      // the full `Database` (PrismaClient) type.
    };
    return {
      ...client,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    } as unknown as Database;
  }

  it("accepts a captured payment matching both the order and the tenant", async () => {
    const prisma = fakePrisma([
      { id: "pay-1", orderRef: "order-1", tenantId: "tenant-local", status: "captured" },
    ]);
    const adapter = new PrismaPaymentVerificationAdapter(prisma);

    expect(await adapter.hasCapturedPayment("order-1", "pay-1", "tenant-local")).toBe(true);
  });

  it("one adapter instance serves two tenants: tenant B cannot verify tenant A's captured payment (ADR-0014)", async () => {
    const prisma = fakePrisma([
      { id: "pay-1", orderRef: "order-1", tenantId: "tenant-a", status: "captured" },
    ]);
    const adapter = new PrismaPaymentVerificationAdapter(prisma);

    expect(await adapter.hasCapturedPayment("order-1", "pay-1", "tenant-a")).toBe(true);
    expect(await adapter.hasCapturedPayment("order-1", "pay-1", "tenant-b")).toBe(false);
  });

  it("rejects when no matching captured payment exists — the invalid case", async () => {
    const adapter = new PrismaPaymentVerificationAdapter(fakePrisma([]));

    expect(await adapter.hasCapturedPayment("order-1", "pay-1", "tenant-local")).toBe(false);
  });

  it("rejects a payment id captured for a different order (replayed/mismatched event guard)", async () => {
    const prisma = fakePrisma([
      { id: "pay-1", orderRef: "order-2", tenantId: "tenant-local", status: "captured" },
    ]);
    const adapter = new PrismaPaymentVerificationAdapter(prisma);

    expect(await adapter.hasCapturedPayment("order-1", "pay-1", "tenant-local")).toBe(false);
  });

  it("rejects a payment scoped to a different tenant (tenant-isolation guard)", async () => {
    const prisma = fakePrisma([
      { id: "pay-1", orderRef: "order-1", tenantId: "other-tenant", status: "captured" },
    ]);
    const adapter = new PrismaPaymentVerificationAdapter(prisma);

    expect(await adapter.hasCapturedPayment("order-1", "pay-1", "tenant-local")).toBe(false);
  });

  it("rejects a matching row that is not yet captured (e.g. still requires_payment)", async () => {
    const prisma = fakePrisma([
      { id: "pay-1", orderRef: "order-1", tenantId: "tenant-local", status: "requires_payment" },
    ]);
    const adapter = new PrismaPaymentVerificationAdapter(prisma);

    expect(await adapter.hasCapturedPayment("order-1", "pay-1", "tenant-local")).toBe(false);
  });
});

describe("PrismaRefundVerificationAdapter (Phase A.2 — F-04 closure: refundable ceiling derived from Payments' own charges/refunds ledger)", () => {
  interface FakeCharge {
    readonly amountMinor: number;
  }
  interface FakeRefund {
    readonly amountMinor: number;
    readonly status?: string;
  }
  interface FakeIntentRow {
    readonly orderRef: string;
    readonly tenantId: string;
    readonly currency: string;
    readonly charges: readonly FakeCharge[];
    readonly refunds: readonly FakeRefund[];
  }

  function fakePrisma(rows: readonly FakeIntentRow[]): Database {
    const client = {
      $executeRaw: async () => 0,
      paymentIntent: {
        findMany: async ({
          where,
        }: {
          where: { orderRef: string; tenantId: string; currency: string };
        }) =>
          rows.filter(
            (r) =>
              r.orderRef === where.orderRef &&
              r.tenantId === where.tenantId &&
              r.currency === where.currency,
          ),
      },
      // Deliberately partial fixture (only `paymentIntent.findMany`) — same convention as
      // `PrismaPaymentVerificationAdapter`'s fixture above.
    };
    return {
      ...client,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    } as unknown as Database;
  }

  const CAPTURED_1000_REFUNDED_200: FakeIntentRow = {
    orderRef: "order-1",
    tenantId: "tenant-local",
    currency: "USD",
    charges: [{ amountMinor: 1000 }],
    refunds: [{ amountMinor: 200 }],
  };

  it("one adapter instance serves two tenants: tenant B cannot borrow tenant A's refundable ceiling (ADR-0014)", async () => {
    const adapter = new PrismaRefundVerificationAdapter(
      fakePrisma([{ ...CAPTURED_1000_REFUNDED_200, tenantId: "tenant-a" }]),
    );

    expect(await adapter.isRefundable("order-1", 300, "USD", "tenant-a")).toBe(true);
    expect(await adapter.isRefundable("order-1", 300, "USD", "tenant-b")).toBe(false);
  });

  it("valid: a refund well within the remaining ceiling (300 of 800 remaining) is allowed", async () => {
    const adapter = new PrismaRefundVerificationAdapter(fakePrisma([CAPTURED_1000_REFUNDED_200]));
    expect(await adapter.isRefundable("order-1", 300, "USD", "tenant-local")).toBe(true);
  });

  it("boundary: a refund of exactly the remaining ceiling (800) is allowed", async () => {
    const adapter = new PrismaRefundVerificationAdapter(fakePrisma([CAPTURED_1000_REFUNDED_200]));
    expect(await adapter.isRefundable("order-1", 800, "USD", "tenant-local")).toBe(true);
  });

  it("invalid: a refund one cent over the remaining ceiling (801) is rejected", async () => {
    const adapter = new PrismaRefundVerificationAdapter(fakePrisma([CAPTURED_1000_REFUNDED_200]));
    expect(await adapter.isRefundable("order-1", 801, "USD", "tenant-local")).toBe(false);
  });

  it("extreme (Task 4 exploit scenario): captured=1000, alreadyRefunded=200, requested=5000 is rejected — never reaches PaymentsPort", async () => {
    const adapter = new PrismaRefundVerificationAdapter(fakePrisma([CAPTURED_1000_REFUNDED_200]));
    expect(await adapter.isRefundable("order-1", 5000, "USD", "tenant-local")).toBe(false);
  });

  it("extreme: an absurd request (1,000,000) against a 0-captured order is rejected", async () => {
    const adapter = new PrismaRefundVerificationAdapter(fakePrisma([]));
    expect(await adapter.isRefundable("order-1", 1_000_000, "USD", "tenant-local")).toBe(false);
  });

  it("sums charges/refunds across multiple payment intents for the same order", async () => {
    const rows: FakeIntentRow[] = [
      {
        orderRef: "order-1",
        tenantId: "tenant-local",
        currency: "USD",
        charges: [{ amountMinor: 600 }],
        refunds: [],
      },
      {
        orderRef: "order-1",
        tenantId: "tenant-local",
        currency: "USD",
        charges: [{ amountMinor: 400 }],
        refunds: [{ amountMinor: 200 }],
      },
    ];
    const adapter = new PrismaRefundVerificationAdapter(fakePrisma(rows));
    // totalCaptured = 1000, totalRefunded = 200, remaining = 800
    expect(await adapter.isRefundable("order-1", 800, "USD", "tenant-local")).toBe(true);
    expect(await adapter.isRefundable("order-1", 801, "USD", "tenant-local")).toBe(false);
  });

  it("rejects a refund scoped to a different tenant (tenant-isolation guard)", async () => {
    const adapter = new PrismaRefundVerificationAdapter(
      fakePrisma([{ ...CAPTURED_1000_REFUNDED_200, tenantId: "other-tenant" }]),
    );
    expect(await adapter.isRefundable("order-1", 300, "USD", "tenant-local")).toBe(false);
  });

  it("Phase A.10 (Task 3): a FAILED refund's released reservation does not shrink the refundable ceiling", async () => {
    const row: FakeIntentRow = {
      orderRef: "order-1",
      tenantId: "tenant-local",
      currency: "USD",
      charges: [{ amountMinor: 1000 }],
      // A prior refund attempt that failed at the PSP — its reservation was released
      // (`PaymentIntent.remaining()` already excludes it domain-side); this adapter's OWN ceiling
      // check must match, not double-count it as still-refunded.
      refunds: [{ amountMinor: 600, status: "failed" }],
    };
    const adapter = new PrismaRefundVerificationAdapter(fakePrisma([row]));
    // remaining = 1000 - 0 (failed excluded) = 1000, not 1000 - 600 = 400.
    expect(await adapter.isRefundable("order-1", 1000, "USD", "tenant-local")).toBe(true);
  });

  it("rejects a currency mismatch (order captured in USD, refund requested in EUR)", async () => {
    const adapter = new PrismaRefundVerificationAdapter(fakePrisma([CAPTURED_1000_REFUNDED_200]));
    expect(await adapter.isRefundable("order-1", 300, "EUR", "tenant-local")).toBe(false);
  });

  it("rejects any amount when no captured payment exists for the order", async () => {
    const adapter = new PrismaRefundVerificationAdapter(fakePrisma([]));
    expect(await adapter.isRefundable("order-1", 1, "USD", "tenant-local")).toBe(false);
  });
});

describe("PrismaPaymentsPortAdapter (Phase A.3 — refund execution closure: bridges Returns' PaymentsPort to Payments' real RefundPaymentLifecycle)", () => {
  interface FakeCharge {
    readonly amountMinor: number;
  }
  interface FakeRefund {
    readonly amountMinor: number;
    readonly status?: string;
  }
  interface FakeIntentRow {
    readonly id: string;
    readonly orderRef: string;
    readonly tenantId: string;
    readonly currency: string;
    readonly charges: readonly FakeCharge[];
    readonly refunds: readonly FakeRefund[];
  }

  function fakePrisma(rows: readonly FakeIntentRow[]): Database {
    const client = {
      $executeRaw: async () => 0,
      paymentIntent: {
        findMany: async ({
          where,
        }: {
          where: { orderRef: string; tenantId: string; currency: string };
        }) =>
          rows.filter(
            (r) =>
              r.orderRef === where.orderRef &&
              r.tenantId === where.tenantId &&
              r.currency === where.currency,
          ),
      },
      // Deliberately partial fixture (only `paymentIntent.findMany`) — same convention as
      // `PrismaRefundVerificationAdapter`'s fixture above; the WRITE goes through the fake
      // `PaymentController` below, never through this fake client.
    };
    return {
      ...client,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    } as unknown as Database;
  }

  /** Records every call and returns a fixed `ControllerResponse` — proves exactly what the
   * adapter sent downstream, without needing a real Payments composition. */
  function fakePaymentController(
    response: { status: number; body: unknown } = { status: 200, body: { status: "refunded" } },
  ): { controller: PaymentController; calls: unknown[] } {
    const calls: unknown[] = [];
    const controller = {
      refundLifecycle: async (input: unknown) => {
        calls.push(input);
        return response;
      },
    } as unknown as PaymentController;
    return { controller, calls };
  }

  const SINGLE_INTENT_800_REMAINING: FakeIntentRow = {
    id: "intent-1",
    orderRef: "order-1",
    tenantId: "tenant-local",
    currency: "USD",
    charges: [{ amountMinor: 1000 }],
    refunds: [{ amountMinor: 200 }],
  };

  it("selects the matching intent and delegates to payments.refundLifecycle with paymentIntentId/amountMinor/currency/idempotencyKey", async () => {
    const { controller, calls } = fakePaymentController();
    const adapter = new PrismaPaymentsPortAdapter(
      fakePrisma([SINGLE_INTENT_800_REMAINING]),
      controller,
    );

    await adapter.requestRefund("order-1", 300, "USD", "return-1:refund", "tenant-local");

    expect(calls).toEqual([
      {
        tenantId: "tenant-local",
        paymentIntentId: "intent-1",
        amountMinor: 300,
        currency: "USD",
        idempotencyKey: "return-1:refund",
      },
    ]);
  });

  it("threads Returns' caller-supplied idempotency key through unchanged (Phase A.5 — previously discarded)", async () => {
    const { controller, calls } = fakePaymentController();
    const adapter = new PrismaPaymentsPortAdapter(
      fakePrisma([SINGLE_INTENT_800_REMAINING]),
      controller,
    );

    await adapter.requestRefund("order-1", 300, "USD", "return-42:refund", "tenant-local");
    await adapter.requestRefund("order-1", 300, "USD", "return-42:refund", "tenant-local");

    expect(calls).toHaveLength(2);
    expect((calls[0] as { idempotencyKey: string }).idempotencyKey).toBe("return-42:refund");
    expect((calls[1] as { idempotencyKey: string }).idempotencyKey).toBe("return-42:refund");
  });

  it("boundary: refunding exactly the remaining ceiling (800) succeeds", async () => {
    const { controller, calls } = fakePaymentController();
    const adapter = new PrismaPaymentsPortAdapter(
      fakePrisma([SINGLE_INTENT_800_REMAINING]),
      controller,
    );

    await adapter.requestRefund("order-1", 800, "USD", "return-1:refund", "tenant-local");

    expect(calls).toHaveLength(1);
  });

  it("fails closed (throws, does not silently succeed) when no intent has sufficient remaining amount", async () => {
    const { controller, calls } = fakePaymentController();
    const adapter = new PrismaPaymentsPortAdapter(
      fakePrisma([SINGLE_INTENT_800_REMAINING]),
      controller,
    );

    await expect(
      adapter.requestRefund("order-1", 801, "USD", "return-1:refund", "tenant-local"),
    ).rejects.toThrow(/sufficient remaining amount/);
    expect(calls).toHaveLength(0);
  });

  it("fails closed when no payment intent exists for the order at all", async () => {
    const { controller, calls } = fakePaymentController();
    const adapter = new PrismaPaymentsPortAdapter(fakePrisma([]), controller);

    await expect(
      adapter.requestRefund("order-1", 1, "USD", "return-1:refund", "tenant-local"),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("scopes to tenant — an intent under a different tenant is never selected", async () => {
    const { controller, calls } = fakePaymentController();
    const adapter = new PrismaPaymentsPortAdapter(
      fakePrisma([{ ...SINGLE_INTENT_800_REMAINING, tenantId: "other-tenant" }]),
      controller,
    );

    await expect(
      adapter.requestRefund("order-1", 300, "USD", "return-1:refund", "tenant-local"),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("scopes to currency — an intent captured in a different currency is never selected", async () => {
    const { controller, calls } = fakePaymentController();
    const adapter = new PrismaPaymentsPortAdapter(
      fakePrisma([SINGLE_INTENT_800_REMAINING]),
      controller,
    );

    await expect(
      adapter.requestRefund("order-1", 300, "EUR", "return-1:refund", "tenant-local"),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("selects among multiple intents for the same order, picking the one with sufficient remaining", async () => {
    const rows: FakeIntentRow[] = [
      {
        id: "intent-1",
        orderRef: "order-1",
        tenantId: "tenant-local",
        currency: "USD",
        charges: [{ amountMinor: 200 }],
        refunds: [],
      },
      {
        id: "intent-2",
        orderRef: "order-1",
        tenantId: "tenant-local",
        currency: "USD",
        charges: [{ amountMinor: 1000 }],
        refunds: [],
      },
    ];
    const { controller, calls } = fakePaymentController();
    const adapter = new PrismaPaymentsPortAdapter(fakePrisma(rows), controller);

    await adapter.requestRefund("order-1", 900, "USD", "return-1:refund", "tenant-local");

    expect(calls).toEqual([
      {
        tenantId: "tenant-local",
        paymentIntentId: "intent-2",
        amountMinor: 900,
        currency: "USD",
        idempotencyKey: "return-1:refund",
      },
    ]);
  });

  it("Phase A.10 (Task 3): a FAILED refund on the target intent does not shrink the remaining amount this adapter computes", async () => {
    const row: FakeIntentRow = {
      id: "intent-1",
      orderRef: "order-1",
      tenantId: "tenant-local",
      currency: "USD",
      charges: [{ amountMinor: 1000 }],
      refunds: [{ amountMinor: 700, status: "failed" }],
    };
    const { controller, calls } = fakePaymentController();
    const adapter = new PrismaPaymentsPortAdapter(fakePrisma([row]), controller);

    // Pre-fix this adapter computed remaining = 1000 - 700 = 300 and would have rejected this call
    // ("no payment intent has sufficient remaining amount") even though the failed refund's
    // reservation was actually released — the domain's own `remaining()` would allow the full 1000.
    await adapter.requestRefund(
      "order-1",
      1000,
      "USD",
      "return-failed-retry:refund",
      "tenant-local",
    );

    expect(calls).toEqual([
      {
        tenantId: "tenant-local",
        paymentIntentId: "intent-1",
        amountMinor: 1000,
        currency: "USD",
        idempotencyKey: "return-failed-retry:refund",
      },
    ]);
  });

  it("propagates a downstream failure (Payments rejects the refund, e.g. 409 over-capture) as a thrown error — never a silent success", async () => {
    const { controller, calls } = fakePaymentController({
      status: 409,
      body: { code: "BUSINESS_RULE", message: "refund exceeds captured amount" },
    });
    const adapter = new PrismaPaymentsPortAdapter(
      fakePrisma([SINGLE_INTENT_800_REMAINING]),
      controller,
    );

    await expect(
      adapter.requestRefund("order-1", 300, "USD", "return-1:refund", "tenant-local"),
    ).rejects.toThrow(/refund execution failed \(status 409\)/);
    expect(calls).toHaveLength(1); // it DID call through — the failure is Payments', not a silent no-op
  });
});

describe("scheduler jobs", () => {
  it("defines the outbox-prune job and the loop respects the distributed lock", async () => {
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));
    const jobs = buildJobs(core);
    expect(jobs.map((j) => j.name)).toEqual(["outbox-prune", "cdc-watchdog"]);

    let ran = 0;
    const silent: Logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      child: () => silent,
    };
    const timers = startJobLoop(
      [{ name: "t", intervalMs: 5, run: async () => void (ran += 1) }],
      silent,
      { acquire: async () => null }, // another instance holds the lock
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    for (const t of timers) clearInterval(t);
    expect(ran).toBe(0); // lock respected — single-flight across instances
  });
});
