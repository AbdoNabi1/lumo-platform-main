import { describe, expect, it } from "vitest";
import type {
  Clock,
  IdGenerator,
  PaymentIntentRequest,
  PaymentProvider,
  ProviderIntent,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wirePayments } from "./composition";
import type { ProviderRegistration } from "./application/provider-registry";
import { testEnvelopeVault } from "./test-support/local-key-wrap-cipher";

/**
 * THE PROOF that the registry is open: a provider this repository has never heard of — its own key,
 * its own credentials, its own non-secret routing config, its own capabilities — is registered at
 * composition time and reaches a shopper. Nothing in this file may need an edit to
 * `services/payments/src/domain`, the Prisma schema, or any `switch` on a provider name; if a future
 * change makes that necessary, this test is what stops being writable.
 */

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-09-24T00:00:00.000Z") };

interface Call {
  readonly provider: string;
  readonly op: "createIntent" | "capture" | "refund" | "verifyWebhook";
  /** The credential this instance was BUILT with — proves whose secret served the call. */
  readonly apiKey?: string;
  readonly merchantCode?: string;
}

function recordingProvider(
  tag: string,
  calls: Call[],
  built?: { apiKey: string; merchantCode: string },
): PaymentProvider {
  const base = { provider: tag, ...built };
  let n = 0;
  return {
    createIntent: (_request: PaymentIntentRequest): Promise<ProviderIntent> => {
      n += 1;
      calls.push({ ...base, op: "createIntent" });
      return Promise.resolve({
        providerIntentId: `${tag}-ref-${built?.apiKey ?? "platform"}-${n}`,
        clientHandle: `https://pay.${tag}.example/${built?.merchantCode ?? "platform"}`,
      });
    },
    capture: () => {
      calls.push({ ...base, op: "capture" });
      return Promise.resolve();
    },
    cancel: () => Promise.resolve(),
    refund: () => {
      calls.push({ ...base, op: "refund" });
      return Promise.resolve();
    },
    verifyWebhook: () => {
      calls.push({ ...base, op: "verifyWebhook" });
      return Promise.resolve(true);
    },
  };
}

/** The fictional provider. Needs per-merchant credentials, delivers webhooks, can charge off-session. */
function acmeRegistration(calls: Call[]): ProviderRegistration {
  return {
    key: "acme-pay",
    capabilities: {
      settlesAtPayTime: false,
      deliversWebhooks: true,
      requiresMerchantCredentials: true,
      chargesOffSession: true,
    },
    backing: "real",
    credentialFields: ["apiKey"],
    parseConfig: (raw) => {
      const code = (raw as { merchantCode?: unknown } | null)?.merchantCode;
      return typeof code === "string" && /^M\d+$/.test(code)
        ? { ok: true, value: { merchantCode: code } }
        : { ok: false, reason: "merchantCode must look like M123" };
    },
    create: ({ config, credentials }) => ({
      ...recordingProvider("acme-pay", calls, {
        apiKey: credentials.apiKey ?? "",
        merchantCode: String(config.merchantCode),
      }),
      // Declared off-session, so it must implement the port (the type requires it).
      chargeStoredMethod: () => Promise.resolve({ providerReference: "acme-charge" }),
    }),
  };
}

function wire(extra: readonly ProviderRegistration[] = []) {
  const calls: Call[] = [];
  const app = wirePayments({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    paymentProvider: recordingProvider("stripe", calls),
    paymentCredentialVault: testEnvelopeVault(),
    providerRegistrations: [acmeRegistration(calls), ...extra],
  });
  return { app, calls };
}

const acmeSettings = (apiKey: string, merchantCode: string) => ({
  "acme-pay": { config: { merchantCode }, credentials: { apiKey } },
});

async function createIntent(
  app: ReturnType<typeof wire>["app"],
  tenantId: string,
  provider: string,
  orderRef = "order-1",
) {
  return app.payments.createIntentLifecycle({
    tenantId,
    orderRef,
    provider,
    amountMinor: 5000,
    currency: "EGP",
  });
}

describe("a provider registered at composition time reaches a shopper with no core edit", () => {
  it("is configured by a merchant, offered, selected by the shopper and served with THAT merchant's credentials", async () => {
    const { app, calls } = wire();

    const configured = await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["stripe", "acme-pay"],
      providerSettings: acmeSettings("key-a", "M1"),
    });
    expect(configured.status).toBe(200);

    const created = await createIntent(app, "tenant-a", "acme-pay");

    expect(created.status).toBe(201);
    expect((created.body as { provider: string }).provider).toBe("acme-pay");
    expect((created.body as { clientHandle?: string }).clientHandle).toBe(
      "https://pay.acme-pay.example/M1",
    );
    expect(calls.filter((c) => c.op === "createIntent")).toEqual([
      { provider: "acme-pay", op: "createIntent", apiKey: "key-a", merchantCode: "M1" },
    ]);
  });

  it("keeps two merchants' credential sets apart", async () => {
    const { app, calls } = wire();
    for (const [tenant, key, code] of [
      ["tenant-a", "key-a", "M1"],
      ["tenant-b", "key-b", "M2"],
    ] as const) {
      const response = await app.payments.updateMerchantPaymentSettings({
        tenantId: tenant,
        enabledMethods: ["acme-pay"],
        providerSettings: acmeSettings(key, code),
      });
      expect(response.status).toBe(200);
    }

    await createIntent(app, "tenant-a", "acme-pay", "order-a");
    await createIntent(app, "tenant-b", "acme-pay", "order-b");

    expect(calls.filter((c) => c.op === "createIntent").map((c) => c.apiKey)).toEqual([
      "key-a",
      "key-b",
    ]);
  });

  it("reads back a settings DTO that carries the provider's routing config and never its secret", async () => {
    const { app } = wire();
    await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["acme-pay"],
      providerSettings: acmeSettings("super-secret-key", "M7"),
    });

    const read = await app.payments.getMerchantPaymentSettings({ tenantId: "tenant-a" });

    expect(read.status).toBe(200);
    const body = read.body as {
      methods: Record<string, { available: boolean; configured?: boolean; config?: unknown }>;
    };
    expect(body.methods["acme-pay"]).toMatchObject({
      available: true,
      configured: true,
      config: { merchantCode: "M7" },
    });
    expect(JSON.stringify(read.body)).not.toContain("super-secret-key");
  });

  it("refuses config the provider's own validation rejects, and credentials missing a declared field", async () => {
    const { app } = wire();

    const badConfig = await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["acme-pay"],
      providerSettings: acmeSettings("key-a", "not-a-code"),
    });
    const noKey = await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["acme-pay"],
      providerSettings: { "acme-pay": { config: { merchantCode: "M1" }, credentials: {} } },
    });

    expect(badConfig.status).toBe(422);
    expect(noKey.status).toBe(422);
  });

  it("refuses to enable a credentialed provider the merchant has not configured, and a key nobody registered", async () => {
    const { app } = wire();

    const unconfigured = await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["acme-pay"],
    });
    const unknown = await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["nobody-registered-this"],
    });

    expect(unconfigured.status).toBe(409);
    expect(unknown.status).toBe(422);
  });

  it("verifies its webhook against the receiving merchant's own provider", async () => {
    const { app, calls } = wire();
    await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["acme-pay"],
      providerSettings: acmeSettings("key-a", "M1"),
    });

    const verified = await app.payments.verifyWebhook({
      tenantId: "tenant-a",
      provider: "acme-pay",
      payload: new Uint8Array([1]),
      signature: "sig",
    });

    expect(verified).toBe(true);
    expect(calls.filter((c) => c.op === "verifyWebhook").map((c) => c.apiKey)).toEqual(["key-a"]);
  });
});
