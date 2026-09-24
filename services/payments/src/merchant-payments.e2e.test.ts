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
import { testEnvelopeVault } from "./test-support/local-key-wrap-cipher";
import { paymobLikeRegistration } from "./test-support/paymob-like-registration";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-09-23T00:00:00.000Z") };

interface Call {
  readonly provider: string;
  readonly op: "createIntent" | "capture" | "cancel" | "refund" | "verifyWebhook";
  /** The tenant the request was for (createIntent only — the port carries it there). */
  readonly tenantId?: string;
  /** The credential this instance was BUILT with — proves whose credentials served the call. */
  readonly secretKey?: string;
  readonly reference?: string;
}

function recordingProvider(tag: string, calls: Call[], secretKey?: string): PaymentProvider {
  let n = 0;
  const base = { provider: tag, ...(secretKey !== undefined ? { secretKey } : {}) };
  return {
    createIntent: (request: PaymentIntentRequest): Promise<ProviderIntent> => {
      n += 1;
      calls.push({ ...base, op: "createIntent", tenantId: request.tenantId });
      return Promise.resolve({ providerIntentId: `${tag}-ref-${secretKey ?? "platform"}-${n}` });
    },
    capture: (reference: string) => {
      calls.push({ ...base, op: "capture", reference });
      return Promise.resolve();
    },
    cancel: (reference: string) => {
      calls.push({ ...base, op: "cancel", reference });
      return Promise.resolve();
    },
    refund: (reference: string) => {
      calls.push({ ...base, op: "refund", reference });
      return Promise.resolve();
    },
    verifyWebhook: () => {
      calls.push({ ...base, op: "verifyWebhook" });
      return Promise.resolve(true);
    },
  };
}

function wire() {
  const calls: Call[] = [];
  const app = wirePayments({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    paymentProvider: recordingProvider("stripe", calls),
    providerRegistrations: [
      paymobLikeRegistration(({ credentials }) =>
        recordingProvider("paymob", calls, credentials.secretKey),
      ),
    ],
    paymentCredentialVault: testEnvelopeVault(),
  });
  return { app, calls };
}

type Wired = ReturnType<typeof wire>["app"];

const paymob = (secretKey: string) => ({
  paymob: {
    config: { region: "egy", integrationId: 158 },
    credentials: {
      secretKey,
      hmacSecret: `hmac-of-${secretKey}`,
      publicKey: `pk-of-${secretKey}`,
    },
  },
});

async function configure(
  app: Wired,
  tenantId: string,
  enabledMethods: string[],
  secretKey = `sk-${tenantId}`,
) {
  const response = await app.payments.updateMerchantPaymentSettings({
    tenantId,
    enabledMethods,
    providerSettings: paymob(secretKey),
  });
  expect(response.status).toBe(200);
}

async function createIntent(app: Wired, tenantId: string, provider: string, orderRef = "order-1") {
  return app.payments.createIntentLifecycle({
    tenantId,
    orderRef,
    provider,
    amountMinor: 5000,
    currency: "EGP",
  });
}

const idOf = (response: { body: unknown }) =>
  (response.body as { paymentIntentId: string }).paymentIntentId;
const providerIntentIdOf = (response: { body: unknown }) =>
  (response.body as { providerIntentId: string }).providerIntentId;

describe("the shopper's selected method determines the adapter invoked", () => {
  it.each(["stripe", "paymob", "cod"] as const)(
    "selecting %s invokes that adapter and no other — whatever order the merchant listed them in",
    async (selected) => {
      const { app, calls } = wire();
      // Deliberately listed with the OTHER methods first: order is not a priority.
      const order = ["stripe", "paymob", "cod"].filter((m) => m !== selected).concat(selected);
      await configure(app, "tenant-a", order);

      const created = await createIntent(app, "tenant-a", selected);

      expect(created.status).toBe(201);
      expect((created.body as { provider: string }).provider).toBe(selected);
      const invoked = new Set(calls.filter((c) => c.op === "createIntent").map((c) => c.provider));
      if (selected === "cod") {
        // COD has no external adapter: nothing recorded, and the reference is COD's own.
        expect(invoked.size).toBe(0);
        expect(providerIntentIdOf(created)).toMatch(/^cod:/);
      } else {
        expect([...invoked]).toEqual([selected]);
      }
    },
  );

  it("does not fall back to another provider when the selected one is not enabled", async () => {
    const { app, calls } = wire();
    await configure(app, "tenant-a", ["stripe"]); // paymob configured but NOT enabled

    const refused = await createIntent(app, "tenant-a", "paymob");

    expect(refused.status).toBe(422);
    expect(calls).toEqual([]); // nothing — not even the enabled Stripe — was invoked in its place
  });

  it("refuses a missing or unknown method rather than choosing one", async () => {
    const { app, calls } = wire();
    await configure(app, "tenant-a", ["stripe", "cod"]);

    const unknown = await createIntent(app, "tenant-a", "bitcoin");
    const missing = await app.payments.createIntentLifecycle({
      tenantId: "tenant-a",
      orderRef: "order-2",
      amountMinor: 5000,
      currency: "EGP",
    } as never);

    expect(unknown.status).toBe(422);
    expect(missing.status).toBe(422);
    expect(calls).toEqual([]);
  });

  it("uses the provider the intent was created with for capture, not the merchant's current settings", async () => {
    const { app, calls } = wire();
    await configure(app, "tenant-a", ["stripe", "cod"]);
    const created = await createIntent(app, "tenant-a", "stripe");
    const id = idOf(created);
    await app.payments.advance({
      tenantId: "tenant-a",
      paymentIntentId: id,
      toStatus: "processing",
    });
    await app.payments.authorize({
      tenantId: "tenant-a",
      paymentIntentId: id,
      pspReference: providerIntentIdOf(created),
      paymentMethodToken: "tok_visa",
      authorizedAmountMinor: 5000,
    });
    // The merchant later switches Stripe off; a payment already taken through it must still settle.
    await app.payments.updateMerchantPaymentSettings({
      tenantId: "tenant-a",
      enabledMethods: ["cod"],
    });

    const captured = await app.payments.captureLifecycle({
      tenantId: "tenant-a",
      paymentIntentId: id,
    });

    expect(captured.status).toBe(200);
    expect(calls.filter((c) => c.op === "capture").map((c) => c.provider)).toEqual(["stripe"]);
  });
});

describe("two merchants, two Paymob credentials", () => {
  it("each charge is created with its own merchant's credential — never the other's", async () => {
    const { app, calls } = wire();
    await configure(app, "tenant-a", ["paymob"], "sk-merchant-A");
    await configure(app, "tenant-b", ["paymob"], "sk-merchant-B");

    // Interleaved, so a provider resolved once and shared would serve the wrong merchant.
    await createIntent(app, "tenant-a", "paymob", "order-a1");
    await createIntent(app, "tenant-b", "paymob", "order-b1");
    await createIntent(app, "tenant-a", "paymob", "order-a2");

    const created = calls.filter((c) => c.op === "createIntent");
    expect(created).toEqual([
      expect.objectContaining({ tenantId: "tenant-a", secretKey: "sk-merchant-A" }),
      expect.objectContaining({ tenantId: "tenant-b", secretKey: "sk-merchant-B" }),
      expect.objectContaining({ tenantId: "tenant-a", secretKey: "sk-merchant-A" }),
    ]);
  });

  it("a refund goes out through the merchant that took the payment", async () => {
    const { app, calls } = wire();
    await configure(app, "tenant-a", ["paymob"], "sk-merchant-A");
    await configure(app, "tenant-b", ["paymob"], "sk-merchant-B");
    const a = await createIntent(app, "tenant-a", "paymob", "order-a");
    const b = await createIntent(app, "tenant-b", "paymob", "order-b");
    for (const [tenantId, created] of [
      ["tenant-a", a],
      ["tenant-b", b],
    ] as const) {
      await app.payments.recordWebhook({
        tenantId,
        provider: "paymob",
        paymentIntentId: providerIntentIdOf(created),
        eventId: `txn-${tenantId}`,
        kind: "captured",
        providerTransactionRef: tenantId === "tenant-a" ? "1001" : "2002",
      });
    }

    await app.payments.refundLifecycle({
      tenantId: "tenant-b",
      paymentIntentId: idOf(b),
      amountMinor: 1000,
      currency: "EGP",
    });

    expect(calls.filter((c) => c.op === "refund")).toEqual([
      expect.objectContaining({ secretKey: "sk-merchant-B", reference: "2002" }),
    ]);
  });

  it("a tenant cannot reach another tenant's intent or credentials", async () => {
    const { app } = wire();
    await configure(app, "tenant-a", ["paymob"], "sk-merchant-A");
    const created = await createIntent(app, "tenant-a", "paymob");

    const crossTenant = await app.payments.captureLifecycle({
      tenantId: "tenant-b",
      paymentIntentId: idOf(created),
    });
    const bSettings = await app.payments.getMerchantPaymentSettings({ tenantId: "tenant-b" });

    expect(crossTenant.status).toBe(404);
    expect(
      (bSettings.body as { methods: { paymob: { configured: boolean } } }).methods.paymob
        .configured,
    ).toBe(false);
  });

  it("verifies a webhook with the RECEIVING tenant's provider (and only that tenant's)", async () => {
    const { app } = wire();
    await configure(app, "tenant-a", ["paymob"]);
    // tenant-b has no Paymob configured → nothing can verify on its behalf.
    const forA = await app.payments.verifyWebhook({
      tenantId: "tenant-a",
      provider: "paymob",
      payload: new Uint8Array(),
      signature: "x",
    });
    const forB = await app.payments.verifyWebhook({
      tenantId: "tenant-b",
      provider: "paymob",
      payload: new Uint8Array(),
      signature: "x",
    });
    expect(forA).toBe(true); // the recording double accepts; the point is WHICH tenant resolved
    expect(forB).toBe(false);
  });
});

describe("cash on delivery is never paid before an explicit collection confirmation", () => {
  async function codIntent() {
    const { app, calls } = wire();
    await configure(app, "tenant-a", ["cod"]);
    const created = await createIntent(app, "tenant-a", "cod");
    return { app, calls, created, id: idOf(created) };
  }

  const status = async (app: Wired, id: string) =>
    (
      (await app.payments.getPaymentIntent({ tenantId: "tenant-a", paymentIntentId: id })).body as {
        status: { value: string };
      }
    ).status.value;

  const capturedEvents = async (app: Wired) => {
    await app.drainOutbox();
    return app.deliveredEventTypes.filter((t) => t === "payments.payment_intent.captured");
  };

  it("creating the COD payment leaves it unpaid — no captured status, no paid event", async () => {
    const { app, created, id } = await codIntent();

    expect(created.status).toBe(201);
    expect(await status(app, id)).toBe("created");
    expect(await capturedEvents(app)).toEqual([]);
  });

  it("a capture request cannot settle it, and never reaches a provider", async () => {
    const { app, calls, id } = await codIntent();

    const attempt = await app.payments.captureLifecycle({
      tenantId: "tenant-a",
      paymentIntentId: id,
    });

    expect(attempt.status).toBe(409);
    expect(await status(app, id)).toBe("created");
    expect(calls.filter((c) => c.op === "capture")).toEqual([]);
    expect(await capturedEvents(app)).toEqual([]);
  });

  it("a provider webhook cannot settle it", async () => {
    const { app, id } = await codIntent();

    const forged = await app.payments.recordWebhook({
      tenantId: "tenant-a",
      provider: "cod",
      paymentIntentId: id,
      eventId: "evt-1",
      kind: "captured",
    });

    expect(await status(app, id)).not.toBe("captured");
    expect(await capturedEvents(app)).toEqual([]);
    expect(forged.status).toBe(409);
  });

  it("a collection of the wrong amount is refused, not settled as paid", async () => {
    const { app, id } = await codIntent();

    const short = await app.payments.confirmCodCollection({
      tenantId: "tenant-a",
      paymentIntentId: id,
      collectedAmountMinor: 4999,
      currency: "EGP",
    });

    expect(short.status).toBe(409);
    expect(await status(app, id)).toBe("created");
    expect(await capturedEvents(app)).toEqual([]);
  });

  it("only an explicit confirmed collection marks it paid — once", async () => {
    const { app, id } = await codIntent();

    const confirmed = await app.payments.confirmCodCollection({
      tenantId: "tenant-a",
      paymentIntentId: id,
      collectedAmountMinor: 5000,
      currency: "EGP",
    });

    expect(confirmed.status).toBe(200);
    expect(await status(app, id)).toBe("captured");
    expect(await capturedEvents(app)).toHaveLength(1);

    // A repeat (operator double-click, retry) is a no-op — never a second Charge or paid event.
    const again = await app.payments.confirmCodCollection({
      tenantId: "tenant-a",
      paymentIntentId: id,
      collectedAmountMinor: 5000,
      currency: "EGP",
    });
    expect(again.status).toBe(200);
    expect(await capturedEvents(app)).toHaveLength(1);
  });

  it("cannot be used to settle a non-COD payment", async () => {
    const { app } = wire();
    await configure(app, "tenant-a", ["stripe"]);
    const stripe = await createIntent(app, "tenant-a", "stripe");

    const attempt = await app.payments.confirmCodCollection({
      tenantId: "tenant-a",
      paymentIntentId: idOf(stripe),
      collectedAmountMinor: 5000,
      currency: "EGP",
    });

    expect(attempt.status).toBe(409);
  });

  it("a collection cannot be confirmed for another tenant's payment", async () => {
    const { app, id } = await codIntent();

    const attempt = await app.payments.confirmCodCollection({
      tenantId: "tenant-b",
      paymentIntentId: id,
      collectedAmountMinor: 5000,
      currency: "EGP",
    });

    expect(attempt.status).toBe(404);
    expect(await status(app, id)).toBe("created");
  });

  it("COD cannot be refunded through the provider port — refusing beats recording a refund nobody made", async () => {
    const { app, id } = await codIntent();
    await app.payments.confirmCodCollection({
      tenantId: "tenant-a",
      paymentIntentId: id,
      collectedAmountMinor: 5000,
      currency: "EGP",
    });

    await expect(
      app.payments.refundLifecycle({
        tenantId: "tenant-a",
        paymentIntentId: id,
        amountMinor: 1000,
        currency: "EGP",
      }),
    ).rejects.toThrow(/cash on delivery/i);
  });
});

describe("Paymob webhooks reuse RecordWebhook's idempotency", () => {
  async function paidByPaymob() {
    const { app, calls } = wire();
    await configure(app, "tenant-a", ["paymob"]);
    const created = await createIntent(app, "tenant-a", "paymob");
    return { app, calls, created, id: idOf(created), orderId: providerIntentIdOf(created) };
  }

  const callback = (orderId: string, eventId: string, extra: Record<string, unknown> = {}) => ({
    tenantId: "tenant-a",
    provider: "paymob",
    paymentIntentId: orderId,
    eventId,
    kind: "captured",
    providerTransactionRef: "192036465",
    amountMinor: 5000,
    currency: "EGP",
    ...extra,
  });

  it("a signed success callback captures the payment (no capture request was ever made)", async () => {
    const { app, calls, id, orderId } = await paidByPaymob();

    const response = await app.payments.recordWebhook(callback(orderId, "192036465:captured"));

    expect(response.status).toBe(200);
    const intent = await app.payments.getPaymentIntent({
      tenantId: "tenant-a",
      paymentIntentId: id,
    });
    expect((intent.body as { status: { value: string } }).status.value).toBe("captured");
    expect(calls.filter((c) => c.op === "capture")).toEqual([]);
    await app.drainOutbox();
    expect(app.deliveredEventTypes).toContain("payments.payment_intent.captured");
  });

  it("a redelivered callback is a recorded duplicate: no second settlement", async () => {
    const { app, orderId } = await paidByPaymob();

    const first = await app.payments.recordWebhook(callback(orderId, "192036465:captured"));
    const second = await app.payments.recordWebhook(callback(orderId, "192036465:captured"));

    expect((first.body as { duplicate: boolean }).duplicate).toBe(false);
    expect((second.body as { duplicate: boolean }).duplicate).toBe(true);
    await app.drainOutbox();
    expect(
      app.deliveredEventTypes.filter((t) => t === "payments.payment_intent.captured"),
    ).toHaveLength(1);
  });

  it("rejects a callback whose signed amount differs from the intent's", async () => {
    const { app, id, orderId } = await paidByPaymob();

    const response = await app.payments.recordWebhook(
      callback(orderId, "txn-1:captured", { amountMinor: 100 }),
    );

    expect(response.status).toBe(409);
    const intent = await app.payments.getPaymentIntent({
      tenantId: "tenant-a",
      paymentIntentId: id,
    });
    expect((intent.body as { status: { value: string } }).status.value).toBe("created");
  });

  it("rejects a callback from a different provider than the one the shopper chose for this intent", async () => {
    const { app, id, orderId } = await paidByPaymob();

    const response = await app.payments.recordWebhook(
      callback(orderId, "evt-1", { provider: "stripe" }),
    );

    expect(response.status).toBe(409);
    const intent = await app.payments.getPaymentIntent({
      tenantId: "tenant-a",
      paymentIntentId: id,
    });
    expect((intent.body as { status: { value: string } }).status.value).toBe("created");
  });

  it("refunds through Paymob using the transaction id from the signed callback, not the order id", async () => {
    const { app, calls, id, orderId } = await paidByPaymob();
    await app.payments.recordWebhook(callback(orderId, "192036465:captured"));

    const refund = await app.payments.refundLifecycle({
      tenantId: "tenant-a",
      paymentIntentId: id,
      amountMinor: 1000,
      currency: "EGP",
    });

    expect(refund.status).toBe(200);
    expect(calls.filter((c) => c.op === "refund")).toEqual([
      expect.objectContaining({ provider: "paymob", reference: "192036465" }),
    ]);
  });

  it("a generic capture request cannot capture a Paymob payment", async () => {
    const { app, calls, id } = await paidByPaymob();

    const attempt = await app.payments.captureLifecycle({
      tenantId: "tenant-a",
      paymentIntentId: id,
    });

    expect(attempt.status).toBe(409);
    expect(calls.filter((c) => c.op === "capture")).toEqual([]);
  });
});
