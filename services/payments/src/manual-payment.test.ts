import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wirePayments } from "./composition";
import type { MerchantPaymentSettingsDto, PaymentIntentSummary } from "./index";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-10-25T00:00:00.000Z") };

function wired() {
  return wirePayments({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("the manual payment provider (order operations Part 4, Ruling 8)", () => {
  it("is registered but never offered: not in the settings read, not default-enabled", async () => {
    const { payments } = wired();
    const settings = (await payments.getMerchantPaymentSettings({ tenantId: "t" }))
      .body as MerchantPaymentSettingsDto;
    expect(Object.keys(settings.methods)).not.toContain("manual");
    expect(settings.enabledMethods).not.toContain("manual");
  });

  it("cannot be enabled by a merchant", async () => {
    const { payments } = wired();
    const refused = await payments.updateMerchantPaymentSettings({
      tenantId: "t",
      enabledMethods: ["manual"],
    });
    expect(refused.status).toBe(422);
  });

  it("cannot be configured by a merchant through providerSettings, and the refusal echoes nothing submitted", async () => {
    const { payments } = wired();
    const sentinel = "SENTINEL-MANUAL-SECRET-0123456789";
    const refused = await payments.updateMerchantPaymentSettings({
      tenantId: "t",
      providerSettings: { manual: { credentials: { apiKey: sentinel } } },
    });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).not.toContain(sentinel);
  });

  it("is refused by default: only a caller that explicitly allows a staff-recorded payment can open one", async () => {
    const { payments } = wired();
    const refused = await payments.createIntentLifecycle({
      tenantId: "t",
      orderRef: "o-9",
      provider: "manual",
      amountMinor: 100,
      currency: "EGP",
    });
    const explicitlyDenied = await payments.createIntentLifecycle({
      tenantId: "t",
      orderRef: "o-9",
      provider: "manual",
      amountMinor: 100,
      currency: "EGP",
      allowStaffRecorded: false,
    });
    const ordinary = await payments.createIntentLifecycle({
      tenantId: "t",
      orderRef: "o-9",
      provider: "stripe",
      amountMinor: 100,
      currency: "EGP",
    });
    expect(refused.status).toBe(422);
    expect(explicitlyDenied.status).toBe(422);
    expect(ordinary.status).toBe(201);
  });

  it("opens an intent without being enabled, and only a confirmed collection settles it", async () => {
    const { payments } = wired();
    const opened = await payments.createIntentLifecycle({
      tenantId: "t",
      orderRef: "o-1",
      provider: "manual",
      amountMinor: 49000,
      currency: "EGP",
      allowStaffRecorded: true,
    });
    expect(opened.status).toBe(201);
    const { paymentIntentId } = opened.body as { paymentIntentId: string };
    const collected = await payments.confirmCodCollection({
      tenantId: "t",
      paymentIntentId,
      collectedAmountMinor: 49000,
      currency: "EGP",
    });
    expect(collected.status).toBe(200);
    expect((collected.body as { status: string }).status).toBe("captured");
  });

  it("a cod intent still needs cod enabled (Ruling 7 — the resolver's rule is unchanged for cod)", async () => {
    const { payments } = wired();
    const refused = await payments.createIntentLifecycle({
      tenantId: "t",
      orderRef: "o-2",
      provider: "cod",
      amountMinor: 100,
      currency: "EGP",
    });
    expect(refused.status).toBe(422);
  });

  it("the batched summary says a manual intent is settled by confirmation but is NOT collected on delivery", async () => {
    const { payments } = wired();
    const manual = (
      await payments.createIntentLifecycle({
        tenantId: "t",
        orderRef: "o-3",
        provider: "manual",
        amountMinor: 100,
        currency: "EGP",
        allowStaffRecorded: true,
      })
    ).body as { paymentIntentId: string };
    await payments.updateMerchantPaymentSettings({ tenantId: "t", enabledMethods: ["cod"] });
    const cod = (
      await payments.createIntentLifecycle({
        tenantId: "t",
        orderRef: "o-4",
        provider: "cod",
        amountMinor: 100,
        currency: "EGP",
      })
    ).body as { paymentIntentId: string };
    const summaries = (
      await payments.getPaymentIntentsByIds({
        tenantId: "t",
        paymentIntentIds: [manual.paymentIntentId, cod.paymentIntentId],
      })
    ).body as PaymentIntentSummary[];
    const byProvider = Object.fromEntries(summaries.map((s) => [s.provider, s]));
    expect(byProvider["manual"]).toMatchObject({
      settledByOperatorConfirmation: true,
      collectedOnDelivery: false,
    });
    expect(byProvider["cod"]).toMatchObject({
      settledByOperatorConfirmation: true,
      collectedOnDelivery: true,
    });
  });
});
