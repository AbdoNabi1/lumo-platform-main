import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { PaymentIntent } from "../domain/payment-intent";
import { PaymentEventTranslator } from "./payment-event-translator";
import { InMemoryPaymentIntentRepository } from "./in-memory-payment-intent-repository";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

function usd(amountMinor: number): Money {
  const result = Money.create(amountMinor, "USD");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

// Sprint A0 precondition scaffolding for A3's saga-activity idempotency — the domain aggregate
// carries no idempotencyKey field yet, so this stays a dormant, always-null lookup until A3 wires
// it up. Proven here so the port + adapter shape are correct now, ahead of that wiring.
describe("PaymentIntentRepository.findByIdempotencyKey (Sprint A0 precondition)", () => {
  it("always returns null — no code path writes an idempotency key yet", async () => {
    const outbox = new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new PaymentEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date("2026-07-26T00:00:00.000Z") },
      producer: "payments",
    });
    const repo = new InMemoryPaymentIntentRepository({
      outbox,
      context: rootEventContext(sequentialIds()),
    });
    const intent = PaymentIntent.create(
      UniqueEntityId.from("intent-1"),
      "order-1",
      usd(1000),
      "stripe",
    );
    await repo.save(intent, "tenant-a");

    expect(await repo.findByIdempotencyKey("any-key", "tenant-a")).toBeNull();
  });
});
