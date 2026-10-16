import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Shipment } from "../domain/shipment";
import { ShipmentPackage } from "../domain/value-objects/shipment-package";
import { InMemoryShipmentRepository } from "./in-memory-shipment-repository";
import { ShippingEventTranslator } from "./shipping-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

function pkg(): ShipmentPackage {
  const result = ShipmentPackage.create("pkg-1", ["item-1"], 500);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

// Sprint A0 precondition scaffolding for retry-safe saga-activity idempotency — the domain
// aggregate carries no idempotencyKey field yet, so this stays a dormant, always-null lookup
// until a future milestone wires it up. Proven here so the port + adapter shape are correct now,
// ahead of that wiring, per the C10 special note (reintroduced additively, not by editing the
// frozen A0 migration file).
describe("ShipmentRepository.findByIdempotencyKey (Sprint A0 precondition)", () => {
  it("always returns null — no code path writes an idempotency key yet", async () => {
    const outbox = new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new ShippingEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date("2026-07-26T00:00:00.000Z") },
      producer: "shipping",
    });
    const repo = new InMemoryShipmentRepository({
      outbox,
      context: rootEventContext(sequentialIds()),
    });
    const shipment = Shipment.create(UniqueEntityId.from("ship-1"), "fulfillment-1", [pkg()]);
    await repo.save(shipment, "tenant-a");

    expect(await repo.findByIdempotencyKey("any-key", "tenant-a")).toBeNull();
  });
});
