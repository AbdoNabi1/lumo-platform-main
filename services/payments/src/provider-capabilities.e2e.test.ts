import { describe, expect, it } from "vitest";
import type {
  Clock,
  IdGenerator,
  OffSessionPaymentProvider,
  PaymentIntentRequest,
  ProviderIntent,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wirePayments } from "./composition";
import type { ProviderCapabilities, ProviderRegistration } from "./application/provider-registry";
import { testEnvelopeVault } from "./test-support/local-key-wrap-cipher";

/**
 * What the payments domain does with a provider's DECLARED CAPABILITIES — never its name. Every
 * provider in this file is fictional; if any assertion needed a real provider's name to hold, the
 * capability model would be a naming scheme in disguise.
 */

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-09-24T00:00:00.000Z") };

const ALL_OFF: ProviderCapabilities = {
  settlesAtPayTime: false,
  deliversWebhooks: false,
  requiresMerchantCredentials: false,
  chargesOffSession: false,
};

interface Ledger {
  readonly built: string[];
  readonly ops: string[];
}

/** A provider that says yes to everything — so any refusal in a test comes from CAPABILITIES, not from the provider. */
function permissiveProvider(tag: string, ledger: Ledger): OffSessionPaymentProvider {
  return {
    chargeStoredMethod: () => {
      ledger.ops.push(`${tag}:chargeStoredMethod`);
      return Promise.resolve({ providerReference: `${tag}-charge` });
    },
    createIntent: (_r: PaymentIntentRequest): Promise<ProviderIntent> => {
      ledger.ops.push(`${tag}:createIntent`);
      return Promise.resolve({ providerIntentId: `${tag}-ref` });
    },
    capture: () => {
      ledger.ops.push(`${tag}:capture`);
      return Promise.resolve();
    },
    cancel: () => Promise.resolve(),
    refund: () => {
      ledger.ops.push(`${tag}:refund`);
      return Promise.resolve();
    },
    verifyWebhook: () => {
      ledger.ops.push(`${tag}:verifyWebhook`);
      return Promise.resolve(true);
    },
  };
}

function registration(
  key: string,
  ledger: Ledger,
  capabilities: Partial<ProviderCapabilities> = {},
  extra: Partial<ProviderRegistration> = {},
): ProviderRegistration {
  // `permissiveProvider` implements the off-session port, so it backs either declaration honestly.
  return {
    key,
    capabilities: { ...ALL_OFF, ...capabilities },
    backing: "real",
    create: () => {
      ledger.built.push(key);
      return permissiveProvider(key, ledger);
    },
    ...extra,
  } as ProviderRegistration;
}

function wire(registrations: readonly ProviderRegistration[], ledger: Ledger) {
  return wirePayments({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    paymentProvider: permissiveProvider("stripe", ledger),
    paymentCredentialVault: testEnvelopeVault(),
    providerRegistrations: registrations,
  });
}

const newLedger = (): Ledger => ({ built: [], ops: [] });

async function createIntent(app: ReturnType<typeof wire>, provider: string, orderRef = "o-1") {
  return app.payments.createIntentLifecycle({
    tenantId: "tenant-a",
    orderRef,
    provider,
    amountMinor: 1000,
    currency: "EGP",
  });
}

describe("nothing selects a provider on the shopper's behalf", () => {
  const keys = ["alpha", "bravo", "charlie"] as const;
  const orderings: (readonly string[])[] = [
    ["alpha", "bravo", "charlie"],
    ["charlie", "bravo", "alpha"],
    ["bravo", "charlie", "alpha"],
  ];

  it.each(keys)(
    "the shopper's choice %s serves the request whatever the registration order, enabled order or default flag",
    async (selected) => {
      for (const order of orderings) {
        const ledger = newLedger();
        const app = wire(
          order.map((key, index) =>
            registration(
              key,
              ledger,
              // Capabilities and defaults differ per provider and per ordering: if anything ranked
              // providers by them, some permutation would pick a provider other than `selected`.
              { chargesOffSession: index % 2 === 0, deliversWebhooks: index !== 1 },
              { enabledByDefault: index === 0 },
            ),
          ),
          ledger,
        );
        await app.payments.updateMerchantPaymentSettings({
          tenantId: "tenant-a",
          enabledMethods: [...order],
        });

        const created = await createIntent(app, selected);

        expect(created.status).toBe(201);
        expect(ledger.built).toEqual([selected]);
      }
    },
  );

  it("an unavailable selection is refused — it never falls back to another enabled provider", async () => {
    const ledger = newLedger();
    const needsCreds = registration(
      "needs-creds",
      ledger,
      { requiresMerchantCredentials: true },
      { credentialFields: ["apiKey"] },
    );
    const app = wire([needsCreds, registration("plain", ledger)], ledger);
    // `plain` and stripe are enabled and healthy; `needs-creds` is enabled-by-default but the merchant never configured it.
    await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["stripe", "plain", "cod"],
    });

    const refused = await createIntent(app, "needs-creds");

    expect(refused.status).toBe(422);
    expect(ledger.built).toEqual([]);
    expect(ledger.ops).toEqual([]);
  });

  it("a key nobody registered is refused rather than answered with some other provider", async () => {
    const ledger = newLedger();
    const app = wire([registration("plain", ledger)], ledger);

    const refused = await createIntent(app, "never-registered");

    expect(refused.status).toBe(422);
    expect(ledger.built).toEqual([]);
  });
});

describe("a provider that lacks a capability is refused the operation, never silently no-opped", () => {
  it("a provider without webhooks cannot verify or record one, even when its own verifyWebhook says yes", async () => {
    const ledger = newLedger();
    const app = wire([registration("no-hooks", ledger)], ledger); // deliversWebhooks: false
    await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["no-hooks"],
    });
    const created = await createIntent(app, "no-hooks");
    const id = (created.body as { paymentIntentId: string }).paymentIntentId;

    const verified = await app.payments.verifyWebhook({
      tenantId: "tenant-a",
      provider: "no-hooks",
      payload: new Uint8Array([1]),
      signature: "sig",
    });
    const recorded = await app.payments.recordWebhook({
      tenantId: "tenant-a",
      paymentIntentId: id,
      provider: "no-hooks",
      eventId: "evt-1",
      kind: "captured",
    });

    expect(verified).toBe(false);
    expect(ledger.ops).not.toContain("no-hooks:verifyWebhook");
    expect(recorded.status).toBe(409);
    const read = await app.payments.getPaymentIntent({ tenantId: "tenant-a", paymentIntentId: id });
    expect((read.body as { status: string }).status).not.toBe("captured");
  });

  it("a provider that settles at pay time refuses a capture request instead of pretending to capture", async () => {
    const ledger = newLedger();
    const app = wire([registration("pays-now", ledger, { settlesAtPayTime: true })], ledger);
    await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["pays-now"],
    });
    const created = await createIntent(app, "pays-now");
    const id = (created.body as { paymentIntentId: string }).paymentIntentId;

    const capture = await app.payments.captureLifecycle({
      tenantId: "tenant-a",
      paymentIntentId: id,
    });

    expect(capture.status).toBe(409);
    expect(ledger.ops).not.toContain("pays-now:capture");
  });

  it("built-in cash on delivery: capture and refund are refused, and only an explicit collection settles it", async () => {
    const ledger = newLedger();
    const app = wire([], ledger);
    await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["cod"],
    });
    const created = await createIntent(app, "cod");
    const id = (created.body as { paymentIntentId: string }).paymentIntentId;

    const capture = await app.payments.captureLifecycle({
      tenantId: "tenant-a",
      paymentIntentId: id,
    });
    const webhook = await app.payments.recordWebhook({
      tenantId: "tenant-a",
      paymentIntentId: id,
      provider: "cod",
      eventId: "evt-1",
      kind: "captured",
    });
    const refund = await app.payments.refundLifecycle({
      tenantId: "tenant-a",
      paymentIntentId: id,
      amountMinor: 1000,
      currency: "EGP",
    });

    expect(capture.status).toBe(409);
    expect(webhook.status).toBe(409);
    expect(refund.status).not.toBe(200);
    const read = await app.payments.getPaymentIntent({ tenantId: "tenant-a", paymentIntentId: id });
    expect((read.body as { status: string }).status).not.toBe("captured");

    const collected = await app.payments.confirmCodCollection({
      tenantId: "tenant-a",
      paymentIntentId: id,
      collectedAmountMinor: 1000,
      currency: "EGP",
    });
    expect(collected.status).toBe(200);
    expect((collected.body as { status: string }).status).toBe("captured");
  });

  it("operator confirmation is available to ANY provider that settles at pay time without webhooks — not to a provider named cod", async () => {
    const ledger = newLedger();
    const app = wire(
      [
        registration("bank-transfer", ledger, { settlesAtPayTime: true }),
        registration("card-like", ledger, { deliversWebhooks: true }),
      ],
      ledger,
    );
    await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["bank-transfer", "card-like"],
    });
    const transfer = await createIntent(app, "bank-transfer", "o-1");
    const card = await createIntent(app, "card-like", "o-2");

    const ok = await app.payments.confirmCodCollection({
      tenantId: "tenant-a",
      paymentIntentId: (transfer.body as { paymentIntentId: string }).paymentIntentId,
      collectedAmountMinor: 1000,
      currency: "EGP",
    });
    const refused = await app.payments.confirmCodCollection({
      tenantId: "tenant-a",
      paymentIntentId: (card.body as { paymentIntentId: string }).paymentIntentId,
      collectedAmountMinor: 1000,
      currency: "EGP",
    });

    expect(ok.status).toBe(200);
    expect(refused.status).toBe(409);
  });
});

describe("recurring billing may only select a provider that can charge off-session", () => {
  it("resolves one that declares the capability and refuses one that does not", async () => {
    const ledger = newLedger();
    const app = wire(
      [
        registration("can-recur", ledger, { chargesOffSession: true }),
        registration("cannot-recur", ledger, { chargesOffSession: false }),
      ],
      ledger,
    );
    await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["can-recur", "cannot-recur", "cod"],
    });

    await expect(
      app.providers.resolveForOffSession("tenant-a", "can-recur"),
    ).resolves.toBeDefined();
    await expect(app.providers.resolveForOffSession("tenant-a", "cannot-recur")).rejects.toThrow(
      /off-session/,
    );
    // Cash on delivery: no payer-less charge is possible.
    await expect(app.providers.resolveForOffSession("tenant-a", "cod")).rejects.toThrow(
      /off-session/,
    );
    expect(ledger.built).toEqual(["can-recur"]);
  });

  it("does not hand out a provider the merchant has not enabled, even one that could charge off-session", async () => {
    const ledger = newLedger();
    const app = wire([registration("can-recur", ledger, { chargesOffSession: true })], ledger);

    await expect(app.providers.resolveForOffSession("tenant-a", "can-recur")).rejects.toThrow(
      /not enabled/,
    );
  });
});
