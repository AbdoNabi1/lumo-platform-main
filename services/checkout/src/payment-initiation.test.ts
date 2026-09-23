import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCheckout } from "./composition";
import type { PaymentInitiationPort, PaymentMethodPort } from "./application/ports";

/**
 * WP-13 in the checkout context: the shopper's selection is validated against what the merchant
 * offers, and payment is opened for EXACTLY that selection — never a default, never an override.
 */

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-09-23T00:00:00.000Z") };
const address = { line1: "1 Main St", city: "Springfield", postalCode: "00000", country: "US" };

interface Initiated {
  readonly tenantId: string;
  readonly orderRef: string;
  readonly provider: string;
  readonly amountMinor: number;
  readonly currency: string;
}

function wire(offered: readonly string[]) {
  const initiated: Initiated[] = [];
  const paymentMethods: PaymentMethodPort = { enabledMethods: () => Promise.resolve(offered) };
  const paymentInitiation: PaymentInitiationPort = {
    initiate: (input) => {
      initiated.push(input);
      return Promise.resolve({
        paymentIntentId: `pi-${initiated.length}`,
        status: "created",
        provider: input.provider,
      });
    },
  };
  const app = wireCheckout({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    paymentMethods,
    paymentInitiation,
  });
  return { app, initiated };
}

async function readySession(app: ReturnType<typeof wire>["app"], provider?: string) {
  const started = await app.checkout.start({
    tenantId: "tenant-a",
    cartRef: "cart-1",
    sessionRef: "session-1",
    currency: "USD",
  });
  const id = (started.body as { checkoutSessionId: string }).checkoutSessionId;
  await app.checkout.loadItems({
    tenantId: "tenant-a",
    checkoutSessionId: id,
    items: [{ productId: "product-1", quantity: 2, unitPriceAmountMinor: 1000, currency: "USD" }],
  });
  await app.checkout.setBillingAddress({ tenantId: "tenant-a", checkoutSessionId: id, ...address });
  await app.checkout.setShippingAddress({
    tenantId: "tenant-a",
    checkoutSessionId: id,
    ...address,
  });
  await app.checkout.setContactEmail({
    tenantId: "tenant-a",
    checkoutSessionId: id,
    email: "shopper@example.com",
  });
  if (provider !== undefined) {
    const selected = await app.checkout.selectPayment({
      tenantId: "tenant-a",
      checkoutSessionId: id,
      paymentMethodRef: "pm-1",
      provider,
    });
    expect(selected.status).toBe(200);
  }
  await app.checkout.recalculateTotals({ tenantId: "tenant-a", checkoutSessionId: id });
  return id;
}

describe("SelectPayment validates the shopper's choice against what the merchant offers", () => {
  it("refuses an unoffered method and records nothing", async () => {
    const { app } = wire(["stripe", "cod"]);
    const started = await app.checkout.start({
      tenantId: "tenant-a",
      cartRef: "cart-1",
      sessionRef: "session-1",
      currency: "USD",
    });
    const id = (started.body as { checkoutSessionId: string }).checkoutSessionId;

    const refused = await app.checkout.selectPayment({
      tenantId: "tenant-a",
      checkoutSessionId: id,
      paymentMethodRef: "pm-1",
      provider: "paymob",
    });

    expect(refused.status).toBe(422);
    const session = (await app.checkout.generatePaymentIntentRequest({
      tenantId: "tenant-a",
      checkoutSessionId: id,
    })) as { status: number };
    expect(session.status).not.toBe(200); // still no payment selection on the session
  });

  it("accepts any offered method — including one listed last", async () => {
    const { app } = wire(["stripe", "cod", "paymob"]);
    await expect(readySession(app, "paymob")).resolves.toBeDefined();
  });
});

describe("InitiatePayment opens payment for exactly the shopper's selection", () => {
  it.each(["stripe", "paymob", "cod"])(
    "hands %s — the selected method — to the port, with the session's own totals",
    async (provider) => {
      const { app, initiated } = wire(["stripe", "paymob", "cod"]);
      const id = await readySession(app, provider);
      await app.checkout.complete({
        tenantId: "tenant-a",
        checkoutSessionId: id,
        idempotencyKey: "k1",
      });

      const response = await app.checkout.initiatePayment({
        tenantId: "tenant-a",
        checkoutSessionId: id,
      });

      expect(response.status).toBe(201);
      expect(initiated).toEqual([
        expect.objectContaining({
          tenantId: "tenant-a",
          provider,
          amountMinor: 2000,
          currency: "USD",
          orderRef: expect.any(String),
        }),
      ]);
    },
  );

  it("refuses before the checkout is completed, and without a selected method", async () => {
    const { app, initiated } = wire(["stripe"]);
    const early = await readySession(app, "stripe");
    const noSelection = await readySession(app);
    await app.checkout.complete({
      tenantId: "tenant-a",
      checkoutSessionId: noSelection,
      idempotencyKey: "k2",
    });

    const notCompleted = await app.checkout.initiatePayment({
      tenantId: "tenant-a",
      checkoutSessionId: early,
    });
    const unselected = await app.checkout.initiatePayment({
      tenantId: "tenant-a",
      checkoutSessionId: noSelection,
    });

    expect(notCompleted.status).toBe(409);
    expect(unselected.status).toBe(409);
    expect(initiated).toEqual([]); // never a default method
  });

  it("is idempotent: a second call resumes the recorded intent and opens nothing new", async () => {
    const { app, initiated } = wire(["stripe"]);
    const id = await readySession(app, "stripe");
    await app.checkout.complete({
      tenantId: "tenant-a",
      checkoutSessionId: id,
      idempotencyKey: "k3",
    });

    const first = await app.checkout.initiatePayment({
      tenantId: "tenant-a",
      checkoutSessionId: id,
    });
    const second = await app.checkout.initiatePayment({
      tenantId: "tenant-a",
      checkoutSessionId: id,
    });

    expect((second.body as { paymentIntentId: string }).paymentIntentId).toBe(
      (first.body as { paymentIntentId: string }).paymentIntentId,
    );
    expect(initiated).toHaveLength(1);
  });

  it("does not reach another tenant's session", async () => {
    const { app, initiated } = wire(["stripe"]);
    const id = await readySession(app, "stripe");
    await app.checkout.complete({
      tenantId: "tenant-a",
      checkoutSessionId: id,
      idempotencyKey: "k4",
    });

    const foreign = await app.checkout.initiatePayment({
      tenantId: "tenant-b",
      checkoutSessionId: id,
    });

    expect(foreign.status).toBe(404);
    expect(initiated).toEqual([]);
  });
});
