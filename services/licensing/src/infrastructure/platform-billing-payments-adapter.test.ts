import { describe, expect, it } from "vitest";
import { PlatformBillingPaymentsAdapter } from "./platform-billing-payments-adapter";
import { RecordingPaymentProvider } from "../test-support/recording-payment-provider";

/**
 * WP-14 T14.4: Morbeh's own billing is a caller of the SAME `PaymentProvider` port WP-13 wired
 * Stripe/Paymob behind (decision 2) — not a parallel payment path. This adapter is the `PaymentsPort`
 * (`collect`) implementation Licensing needed; it owns nothing else.
 */
describe("PlatformBillingPaymentsAdapter", () => {
  it("collects through the injected provider: createIntent then capture, exact minor units", async () => {
    const provider = new RecordingPaymentProvider();
    const adapter = new PlatformBillingPaymentsAdapter({ provider });

    const collected = await adapter.collect("merchant-1", 2900, "EGP", "inv-1:3:collect");

    expect(provider.intentRequests).toHaveLength(1);
    expect(provider.intentRequests[0]).toMatchObject({
      amountMinor: 2900,
      currency: "EGP",
      tenantId: "merchant-1",
    });
    expect(provider.moved).toEqual([
      { providerIntentId: collected.reference, amountMinor: 2900, currency: "EGP" },
    ]);
  });

  it("records the charge against a billing reference, never an order reference", async () => {
    const provider = new RecordingPaymentProvider();
    const adapter = new PlatformBillingPaymentsAdapter({ provider });
    await adapter.collect("merchant-1", 2900, "USD", "inv-1:3:collect");
    expect(provider.intentRequests[0]?.orderRef).toBe("billing:inv-1:3:collect");
  });

  it("charges once when the same collection is presented twice (deterministic idempotency keys)", async () => {
    const provider = new RecordingPaymentProvider();
    const adapter = new PlatformBillingPaymentsAdapter({ provider });
    const first = await adapter.collect("merchant-1", 2900, "USD", "inv-1:3:collect");
    const second = await adapter.collect("merchant-1", 2900, "USD", "inv-1:3:collect");
    expect(second.reference).toBe(first.reference);
    expect(provider.moved).toHaveLength(1);
  });

  it("refuses to collect without an idempotency key — a real charge must be dedupable", async () => {
    const adapter = new PlatformBillingPaymentsAdapter({
      provider: new RecordingPaymentProvider(),
    });
    await expect(adapter.collect("merchant-1", 2900, "USD")).rejects.toThrow(/idempotency/i);
  });

  it("refuses a non-positive or fractional amount before any PSP call", async () => {
    const provider = new RecordingPaymentProvider();
    const adapter = new PlatformBillingPaymentsAdapter({ provider });
    await expect(adapter.collect("merchant-1", 0, "USD", "k")).rejects.toThrow(/minor/i);
    await expect(adapter.collect("merchant-1", 10.5, "USD", "k")).rejects.toThrow(/minor/i);
    expect(provider.intentRequests).toHaveLength(0);
  });

  it("a declined capture leaves no money moved and surfaces the failure", async () => {
    const provider = new RecordingPaymentProvider();
    provider.declineCapture = true;
    const adapter = new PlatformBillingPaymentsAdapter({ provider });
    await expect(adapter.collect("merchant-1", 2900, "USD", "k")).rejects.toThrow("card declined");
    expect(provider.moved).toHaveLength(0);
  });

  it("is marked real, so the production guard can tell it from the in-memory stub", () => {
    const adapter = new PlatformBillingPaymentsAdapter({
      provider: new RecordingPaymentProvider(),
    });
    expect(adapter.backing).toBe("real");
  });
});
