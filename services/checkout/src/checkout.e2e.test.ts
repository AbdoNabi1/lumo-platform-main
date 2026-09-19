import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCheckout } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-06-30T00:00:00.000Z") };

function wire() {
  return wireCheckout({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

async function newSessionId(app: ReturnType<typeof wire>): Promise<string> {
  const started = await app.checkout.start({
    tenantId: "tenant-a",
    cartRef: "cart-1",
    customerRef: "customer-1",
    sessionRef: "session-1",
    currency: "USD",
  });
  expect(started.status).toBe(201);
  return (started.body as { checkoutSessionId: string }).checkoutSessionId;
}

const readyAddress = {
  line1: "1 Main St",
  city: "Springfield",
  postalCode: "00000",
  country: "US",
};

/** Drives a fresh session through items/addresses/totals so `complete()` can generate an order draft. */
async function readySessionId(app: ReturnType<typeof wire>): Promise<string> {
  const id = await newSessionId(app);
  await app.checkout.loadItems({
    tenantId: "tenant-a",
    checkoutSessionId: id,
    items: [{ productId: "product-1", quantity: 2, unitPriceAmountMinor: 1000, currency: "USD" }],
  });
  await app.checkout.setBillingAddress({
    tenantId: "tenant-a",
    checkoutSessionId: id,
    ...readyAddress,
  });
  await app.checkout.setShippingAddress({
    tenantId: "tenant-a",
    checkoutSessionId: id,
    ...readyAddress,
  });
  await app.checkout.recalculateTotals({ tenantId: "tenant-a", checkoutSessionId: id });
  return id;
}

describe("checkout (end to end)", () => {
  it("starts then completes a session, publishing checkout.completed", async () => {
    const app = wire();
    const id = await readySessionId(app);

    const completed = await app.checkout.complete({
      tenantId: "tenant-a",
      checkoutSessionId: id,
      idempotencyKey: "idem-1",
    });
    expect(completed.status).toBe(200);
    expect((completed.body as { state: string }).state).toBe("completed");
    expect((completed.body as { orderRef: string }).orderRef).toBe(`order-${id}`);

    // readySessionId's recalculateTotals() also emits checkout_session.recalculated, so the
    // outbox carries 2 events (recalculated + completed), not just the one from complete().
    expect(await app.drainOutbox()).toBe(2);
    expect(app.deliveredEventTypes).toContain("checkout.checkout_session.completed");
  });

  it("returns the same orderRef without creating a second order when completed twice", async () => {
    const app = wire();
    const id = await readySessionId(app);

    const first = await app.checkout.complete({
      tenantId: "tenant-a",
      checkoutSessionId: id,
      idempotencyKey: "idem-1",
    });
    expect(first.status).toBe(200);

    const second = await app.checkout.complete({
      tenantId: "tenant-a",
      checkoutSessionId: id,
      idempotencyKey: "idem-1",
    });
    expect(second.status).toBe(200);
    expect((second.body as { orderRef: string }).orderRef).toBe(
      (first.body as { orderRef: string }).orderRef,
    );
  });

  it("fails a session, publishing checkout.failed", async () => {
    const app = wire();
    const id = await newSessionId(app);

    const failed = await app.checkout.fail({
      tenantId: "tenant-a",
      checkoutSessionId: id,
      reason: "payment_failed",
    });
    expect(failed.status).toBe(200);
    expect((failed.body as { state: string }).state).toBe("failed");

    expect(await app.drainOutbox()).toBe(1);
    expect(app.deliveredEventTypes).toContain("checkout.checkout_session.failed");
  });

  it("rejects completing an already-failed session (409)", async () => {
    const app = wire();
    const id = await newSessionId(app);
    await app.checkout.fail({
      tenantId: "tenant-a",
      checkoutSessionId: id,
      reason: "payment_failed",
    });
    const response = await app.checkout.complete({
      tenantId: "tenant-a",
      checkoutSessionId: id,
      idempotencyKey: "idem-1",
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown session", async () => {
    const app = wire();
    const response = await app.checkout.complete({
      tenantId: "tenant-a",
      checkoutSessionId: "missing",
      idempotencyKey: "idem-1",
    });
    expect(response.status).toBe(404);
  });

  it("rejects starting checkout with a blank cart reference (422)", async () => {
    const app = wire();
    const response = await app.checkout.start({
      tenantId: "tenant-a",
      cartRef: "  ",
      customerRef: "customer-1",
      sessionRef: "session-1",
      currency: "USD",
    });
    expect(response.status).toBe(422);
  });

  it("runs the full flow: items -> addresses -> tax -> shipping -> recalc -> order draft + payment intent", async () => {
    const app = wire();
    const id = await newSessionId(app);

    const loaded = await app.checkout.loadItems({
      tenantId: "tenant-a",
      checkoutSessionId: id,
      items: [{ productId: "product-1", quantity: 2, unitPriceAmountMinor: 1000, currency: "USD" }],
    });
    expect(loaded.status).toBe(200);

    const address = {
      line1: "1 Main St",
      city: "Springfield",
      postalCode: "00000",
      country: "US",
    };
    expect(
      (
        await app.checkout.setBillingAddress({
          tenantId: "tenant-a",
          checkoutSessionId: id,
          ...address,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.checkout.setShippingAddress({
          tenantId: "tenant-a",
          checkoutSessionId: id,
          ...address,
        })
      ).status,
    ).toBe(200);

    const validated = await app.checkout.validateCheckout({
      tenantId: "tenant-a",
      checkoutSessionId: id,
    });
    expect(validated.status).toBe(200);
    expect((validated.body as { valid: boolean }).valid).toBe(true);

    const taxed = await app.checkout.requestTaxCalculation({
      tenantId: "tenant-a",
      checkoutSessionId: id,
    });
    expect(taxed.status).toBe(200);
    expect((taxed.body as { taxMinor: number }).taxMinor).toBeGreaterThanOrEqual(0);

    const quoted = await app.checkout.requestShippingQuote({
      tenantId: "tenant-a",
      checkoutSessionId: id,
    });
    expect(quoted.status).toBe(200);
    const quotes = (
      quoted.body as { quotes: readonly { method: string; rateAmountMinor: number }[] }
    ).quotes;
    expect(quotes.length).toBeGreaterThan(0);

    const selected = await app.checkout.selectShipping({
      tenantId: "tenant-a",
      checkoutSessionId: id,
      method: quotes[0]?.method ?? "standard",
    });
    expect(selected.status).toBe(200);

    expect(
      (
        await app.checkout.selectPayment({
          tenantId: "tenant-a",
          checkoutSessionId: id,
          paymentMethodRef: "pm-1",
          provider: "stripe",
        })
      ).status,
    ).toBe(200);

    const promo = await app.checkout.validatePromotion({
      tenantId: "tenant-a",
      checkoutSessionId: id,
    });
    expect(promo.status).toBe(200);

    const recalculated = await app.checkout.recalculateTotals({
      tenantId: "tenant-a",
      checkoutSessionId: id,
    });
    expect(recalculated.status).toBe(200);

    const draft = await app.checkout.generateOrderDraft({
      tenantId: "tenant-a",
      checkoutSessionId: id,
    });
    expect(draft.status).toBe(200);
    expect((draft.body as { items: readonly unknown[] }).items).toHaveLength(1);

    const intentRequest = await app.checkout.generatePaymentIntentRequest({
      tenantId: "tenant-a",
      checkoutSessionId: id,
    });
    expect(intentRequest.status).toBe(200);
    expect((intentRequest.body as { paymentMethodRef: string }).paymentMethodRef).toBe("pm-1");
  });

  it("locks a session then still allows completing it, publishing checkout_session.locked", async () => {
    const app = wire();
    const id = await readySessionId(app);

    const locked = await app.checkout.lock({ tenantId: "tenant-a", checkoutSessionId: id });
    expect(locked.status).toBe(200);
    expect((locked.body as { state: string }).state).toBe("locked");

    const completed = await app.checkout.complete({
      tenantId: "tenant-a",
      checkoutSessionId: id,
      idempotencyKey: "idem-1",
    });
    expect(completed.status).toBe(200);

    await app.drainOutbox();
    expect(app.deliveredEventTypes).toContain("checkout.checkout_session.locked");
  });

  it("expires an open session, publishing checkout_session.expired", async () => {
    const app = wire();
    const id = await newSessionId(app);

    const expired = await app.checkout.expire({ tenantId: "tenant-a", checkoutSessionId: id });
    expect(expired.status).toBe(200);
    expect((expired.body as { state: string }).state).toBe("expired");

    await app.drainOutbox();
    expect(app.deliveredEventTypes).toContain("checkout.checkout_session.expired");
  });
});
