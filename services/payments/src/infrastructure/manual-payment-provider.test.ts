import { describe, expect, it } from "vitest";
import { ManualPaymentProvider } from "./manual-payment-provider";

describe("ManualPaymentProvider", () => {
  const provider = new ManualPaymentProvider();
  it("opens an unpaid intent with no client handle", async () => {
    expect(await provider.createIntent({ idempotencyKey: "k-1" } as never)).toEqual({
      providerIntentId: "manual:k-1",
    });
  });
  it("refuses capture and refund; cancel is a no-op; no webhook is ever authentic", async () => {
    await expect(provider.capture("x", "k")).rejects.toThrow(/confirm/);
    await expect(provider.refund("x", 1, "k")).rejects.toThrow(/outside the platform/);
    await expect(provider.cancel("x", "k")).resolves.toBeUndefined();
    expect(await provider.verifyWebhook(new Uint8Array(), "sig")).toBe(false);
  });
});
