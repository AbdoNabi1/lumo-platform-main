import { describe, expect, it, vi } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { PaymentIntent } from "../domain/payment-intent";
import type { ProviderCapabilities } from "../domain/value-objects/provider-capabilities";
import { InMemoryPaymentIntentRepository } from "../infrastructure/in-memory-payment-intent-repository";
import { PaymentEventTranslator } from "../infrastructure/payment-event-translator";
import { GetPaymentIntentsByIds } from "./get-payment-intents-by-ids.use-case";

const COD: ProviderCapabilities = {
  settlesAtPayTime: true,
  deliversWebhooks: false,
  requiresMerchantCredentials: false,
  chargesOffSession: false,
};
const STRIPE: ProviderCapabilities = {
  settlesAtPayTime: false,
  deliversWebhooks: true,
  requiresMerchantCredentials: false,
  chargesOffSession: true,
};
const providers = {
  capabilitiesOf: (provider: string) =>
    provider === "cod" ? COD : provider === "stripe" ? STRIPE : undefined,
};

function egp(amountMinor: number): Money {
  const result = Money.create(amountMinor, "EGP");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

async function wire() {
  const intents = new InMemoryPaymentIntentRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new PaymentEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "payments",
    }),
    context: rootEventContext({ generate: () => "evt" }),
  });
  await intents.save(
    PaymentIntent.createIntent(UniqueEntityId.from("i-cod"), "o-1", egp(45000), "cod"),
    "t-a",
  );
  await intents.save(
    PaymentIntent.createIntent(UniqueEntityId.from("i-card"), "o-2", egp(1000), "stripe"),
    "t-a",
  );
  await intents.save(
    PaymentIntent.createIntent(UniqueEntityId.from("i-gone"), "o-3", egp(1), "retired"),
    "t-a",
  );
  await intents.save(
    PaymentIntent.createIntent(UniqueEntityId.from("i-theirs"), "o-9", egp(1), "cod"),
    "t-b",
  );
  return intents;
}

describe("GetPaymentIntentsByIds (order operations Part 1)", () => {
  it("summarizes each intent with its provider's capabilities, never the aggregate", async () => {
    const result = await new GetPaymentIntentsByIds({ intents: await wire(), providers }).execute({
      tenantId: "t-a",
      paymentIntentIds: ["i-cod", "i-card", "i-gone"],
    });
    expect(result.ok && result.value).toEqual([
      {
        id: "i-cod",
        orderRef: "o-1",
        provider: "cod",
        status: "created",
        amountMinor: 45000,
        currency: "EGP",
        settlesAtPayTime: true,
        settledByOperatorConfirmation: true,
        collectedOnDelivery: true,
      },
      {
        id: "i-card",
        orderRef: "o-2",
        provider: "stripe",
        status: "created",
        amountMinor: 1000,
        currency: "EGP",
        settlesAtPayTime: false,
        settledByOperatorConfirmation: false,
        collectedOnDelivery: false,
      },
      {
        id: "i-gone",
        orderRef: "o-3",
        provider: "retired",
        status: "created",
        amountMinor: 1,
        currency: "EGP",
        settlesAtPayTime: false,
        settledByOperatorConfirmation: false,
        collectedOnDelivery: false,
      },
    ]);
  });

  it("never returns another shop's intent", async () => {
    const result = await new GetPaymentIntentsByIds({ intents: await wire(), providers }).execute({
      tenantId: "t-a",
      paymentIntentIds: ["i-theirs"],
    });
    expect(result.ok && result.value).toEqual([]);
  });

  it("answers an empty list without reading anything", async () => {
    const intents = { findByIds: vi.fn() };
    const result = await new GetPaymentIntentsByIds({ intents, providers }).execute({
      tenantId: "t-a",
      paymentIntentIds: [],
    });
    expect(result.ok && result.value).toEqual([]);
    expect(intents.findByIds).not.toHaveBeenCalled();
  });

  it("refuses more than 250 ids", async () => {
    const result = await new GetPaymentIntentsByIds({ intents: await wire(), providers }).execute({
      tenantId: "t-a",
      paymentIntentIds: Array.from({ length: 251 }, (_, i) => `i-${i}`),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });
});
