import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { ProductRef, UniqueEntityId } from "@platform/domain";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { NotFoundError } from "@platform/utils";
import { InventoryItem } from "../domain/inventory-item";
import { Quantity } from "../domain/value-objects/quantity";
import { WarehouseId } from "../domain/value-objects/warehouse-id";
import { InMemoryInventoryItemRepository } from "../infrastructure/in-memory-inventory-item-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { InventoryEventTranslator } from "../infrastructure/inventory-event-translator";
import { AdjustInventory } from "./adjust-inventory.use-case";
import { CheckAvailability } from "./check-availability.use-case";
import { CommitReservation } from "./commit-reservation.use-case";
import { ReceiveStock } from "./receive-stock.use-case";
import { ReleaseReservation } from "./release-reservation.use-case";
import { ReserveStock } from "./reserve-stock.use-case";
import { TransferStock } from "./transfer-stock.use-case";

const TENANT = "tenant-a";

function build() {
  let counter = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(counter += 1)}` };
  const clock = { now: () => new Date("2026-10-09T00:00:00.000Z") };
  const items = new InMemoryInventoryItemRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new InventoryEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "inventory",
    }),
    context: rootEventContext(idGenerator),
  });
  const deps = { items, unitOfWork: new InMemoryUnitOfWork(), idGenerator, clock };
  return {
    items,
    receive: new ReceiveStock(deps),
    reserve: new ReserveStock(deps),
    release: new ReleaseReservation(deps),
    commit: new CommitReservation(deps),
    adjust: new AdjustInventory(deps),
    transfer: new TransferStock(deps),
    check: new CheckAvailability({ items }),
  };
}

type App = ReturnType<typeof build>;

async function available(
  app: App,
  productId: string,
  variantId: string | undefined,
  tenantId = TENANT,
  warehouseId = "w1",
) {
  const result = await app.check.execute({ tenantId, productId, variantId, warehouseId });
  return result.ok ? result.value.available : result.error;
}

async function twoSizes(app: App) {
  for (const [variantId, quantity] of [
    ["v-m", 5],
    ["v-l", 2],
  ] as const) {
    const received = await app.receive.execute({
      tenantId: TENANT,
      productId: "p1",
      variantId,
      warehouseId: "w1",
      quantity,
    });
    expect(received.ok).toBe(true);
  }
}

describe("stock per variant (Plan 2B-1)", () => {
  it("receiving for two variants creates two items, each with its own level", async () => {
    const app = build();
    await twoSizes(app);

    expect(await app.items.findByProduct("p1", TENANT)).toHaveLength(2);
    expect(await available(app, "p1", "v-m")).toBe(5);
    expect(await available(app, "p1", "v-l")).toBe(2);
  });

  it("reserving for a variant touches only that variant's item", async () => {
    const app = build();
    await twoSizes(app);

    const reserved = await app.reserve.execute({
      tenantId: TENANT,
      productId: "p1",
      variantId: "v-m",
      warehouseId: "w1",
      quantity: 4,
      reference: "order-1",
    });

    expect(reserved.ok).toBe(true);
    expect(await available(app, "p1", "v-m")).toBe(1);
    expect(await available(app, "p1", "v-l")).toBe(2);
  });

  describe("legacy product-level rows", () => {
    async function withLegacyRow(app: App, productId: string, onHand: number) {
      const product = ProductRef.create(productId);
      const warehouse = WarehouseId.create("w1");
      const quantity = Quantity.create(onHand);
      if (!product.ok || !warehouse.ok || !quantity.ok) throw new Error("invalid fixture");
      const legacy = InventoryItem.create(
        UniqueEntityId.from(`legacy-${productId}`),
        product.value,
        warehouse.value,
      );
      expect(legacy.variantRef).toBeNull();
      legacy.receive(quantity.value, "e1", new Date());
      await app.items.save(legacy, TENANT);
    }

    it("is read as the stock of the product's only variant", async () => {
      const app = build();
      await withLegacyRow(app, "p2", 7);

      expect(await available(app, "p2", undefined)).toBe(7);
      expect(await available(app, "p2", "v-only")).toBe(7);
    });

    it("is not guessed: a product with two variant rows needs a variant id", async () => {
      const app = build();
      await twoSizes(app);

      expect(await available(app, "p1", undefined)).toBeInstanceOf(NotFoundError);
    });

    it("never stands in for a variant that has no row while the product has other rows", async () => {
      const app = build();
      await twoSizes(app);

      expect(await available(app, "p1", "v-s")).toBeInstanceOf(NotFoundError);
    });
  });

  it("adjust acts on the variant's own item", async () => {
    const app = build();
    await twoSizes(app);

    const adjusted = await app.adjust.execute({
      tenantId: TENANT,
      productId: "p1",
      variantId: "v-m",
      warehouseId: "w1",
      onHand: 9,
    });

    expect(adjusted.ok).toBe(true);
    expect(await available(app, "p1", "v-m")).toBe(9);
    expect(await available(app, "p1", "v-l")).toBe(2);
  });

  it("release and commit act on the variant's own item", async () => {
    const app = build();
    await twoSizes(app);
    const reserve = async (variantId: string, quantity: number, reference: string) => {
      const result = await app.reserve.execute({
        tenantId: TENANT,
        productId: "p1",
        variantId,
        warehouseId: "w1",
        quantity,
        reference,
      });
      if (!result.ok) throw new Error("reserve failed");
      return result.value.reservationId;
    };
    const mReservation = await reserve("v-m", 3, "order-1");
    const lReservation = await reserve("v-l", 1, "order-2");

    const released = await app.release.execute({
      tenantId: TENANT,
      productId: "p1",
      variantId: "v-m",
      warehouseId: "w1",
      reservationId: mReservation,
    });
    expect(released.ok).toBe(true);
    expect(await available(app, "p1", "v-m")).toBe(5);
    expect(await available(app, "p1", "v-l")).toBe(1); // L's reservation untouched

    const committed = await app.commit.execute({
      tenantId: TENANT,
      productId: "p1",
      variantId: "v-l",
      warehouseId: "w1",
      reservationId: lReservation,
    });
    expect(committed.ok).toBe(true);
    expect(committed.ok && committed.value.onHand).toBe(1);
    expect(await available(app, "p1", "v-m")).toBe(5); // M unchanged by L's commit
  });

  it("transfer moves one variant's stock and creates the destination item for that variant", async () => {
    const app = build();
    await twoSizes(app);

    const transferred = await app.transfer.execute({
      tenantId: TENANT,
      productId: "p1",
      variantId: "v-m",
      sourceWarehouseId: "w1",
      destinationWarehouseId: "w2",
      quantity: 2,
    });

    expect(transferred.ok).toBe(true);
    expect(await available(app, "p1", "v-m")).toBe(3);
    expect(await available(app, "p1", "v-m", TENANT, "w2")).toBe(2);
    expect(await available(app, "p1", "v-l")).toBe(2);
    expect(await available(app, "p1", "v-l", TENANT, "w2")).toBeInstanceOf(NotFoundError);
  });

  it("never returns another tenant's stock for the same product and variant ids", async () => {
    const app = build();
    await twoSizes(app);

    expect(await available(app, "p1", "v-m", "tenant-b")).toBeInstanceOf(NotFoundError);
    expect(await app.items.findByProduct("p1", "tenant-b")).toHaveLength(0);
  });
});
