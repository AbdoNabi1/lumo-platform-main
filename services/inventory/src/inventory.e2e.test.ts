import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireInventory } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-06-30T00:00:00.000Z") };
const TENANT = "tenant-a";

function wire() {
  return wireInventory({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("inventory (end to end)", () => {
  it("receives then reserves stock, emitting inventory.adjusted via the outbox", async () => {
    const app = wire();

    const received = await app.inventory.receive({
      tenantId: TENANT,
      productId: "product-1",
      warehouseId: "wh-1",
      quantity: 10,
    });
    expect(received.status).toBe(200);

    const reserved = await app.inventory.reserve({
      tenantId: TENANT,
      productId: "product-1",
      warehouseId: "wh-1",
      quantity: 4,
      reference: "order-1",
    });
    expect(reserved.status).toBe(201);
    expect((reserved.body as { available: number }).available).toBe(6);

    const count = await app.drainOutbox();
    expect(count).toBe(2); // received + reserved
    expect(app.deliveredEventTypes).toContain("inventory.inventory_item.adjusted");
  });

  it("rejects reserving more than available (409)", async () => {
    const app = wire();
    await app.inventory.receive({
      tenantId: TENANT,
      productId: "product-2",
      warehouseId: "wh-1",
      quantity: 3,
    });

    const response = await app.inventory.reserve({
      tenantId: TENANT,
      productId: "product-2",
      warehouseId: "wh-1",
      quantity: 5,
      reference: "order-2",
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 when reserving an unknown item", async () => {
    const app = wire();
    const response = await app.inventory.reserve({
      tenantId: TENANT,
      productId: "missing",
      warehouseId: "wh-1",
      quantity: 1,
      reference: "order-3",
    });
    expect(response.status).toBe(404);
  });

  it("rejects an invalid quantity (422)", async () => {
    const app = wire();
    const response = await app.inventory.receive({
      tenantId: TENANT,
      productId: "product-3",
      warehouseId: "wh-1",
      quantity: 0,
    });
    expect(response.status).toBe(422);
  });

  it("commits a reservation, dropping on-hand and reserved together", async () => {
    const app = wire();
    await app.inventory.receive({
      tenantId: TENANT,
      productId: "product-4",
      warehouseId: "wh-1",
      quantity: 10,
    });
    const reserved = await app.inventory.reserve({
      tenantId: TENANT,
      productId: "product-4",
      warehouseId: "wh-1",
      quantity: 4,
      reference: "order-4",
    });
    const { reservationId } = reserved.body as { reservationId: string };

    const committed = await app.inventory.commit({
      tenantId: TENANT,
      productId: "product-4",
      warehouseId: "wh-1",
      reservationId,
    });
    expect(committed.status).toBe(200);
    expect(committed.body).toEqual({ onHand: 6, available: 6 });
  });

  it("double-committing the same reservation fails (409, reservation already consumed)", async () => {
    const app = wire();
    await app.inventory.receive({
      tenantId: TENANT,
      productId: "product-5",
      warehouseId: "wh-1",
      quantity: 10,
    });
    const reserved = await app.inventory.reserve({
      tenantId: TENANT,
      productId: "product-5",
      warehouseId: "wh-1",
      quantity: 4,
      reference: "order-5",
    });
    const { reservationId } = reserved.body as { reservationId: string };
    await app.inventory.commit({
      tenantId: TENANT,
      productId: "product-5",
      warehouseId: "wh-1",
      reservationId,
    });

    const second = await app.inventory.commit({
      tenantId: TENANT,
      productId: "product-5",
      warehouseId: "wh-1",
      reservationId,
    });
    expect(second.status).toBe(409);
  });

  it("transfers unreserved stock between warehouses", async () => {
    const app = wire();
    await app.inventory.receive({
      tenantId: TENANT,
      productId: "product-6",
      warehouseId: "wh-1",
      quantity: 10,
    });

    const transferred = await app.inventory.transfer({
      tenantId: TENANT,
      productId: "product-6",
      sourceWarehouseId: "wh-1",
      destinationWarehouseId: "wh-2",
      quantity: 4,
    });
    expect(transferred.status).toBe(200);
    expect(transferred.body).toEqual({ sourceAvailable: 6, destinationAvailable: 4 });
  });

  it("rejects a same-warehouse transfer (422)", async () => {
    const app = wire();
    await app.inventory.receive({
      tenantId: TENANT,
      productId: "product-7",
      warehouseId: "wh-1",
      quantity: 10,
    });

    const response = await app.inventory.transfer({
      tenantId: TENANT,
      productId: "product-7",
      sourceWarehouseId: "wh-1",
      destinationWarehouseId: "wh-1",
      quantity: 1,
    });
    expect(response.status).toBe(422);
  });

  it("rejects transferring more than available (409)", async () => {
    const app = wire();
    await app.inventory.receive({
      tenantId: TENANT,
      productId: "product-8",
      warehouseId: "wh-1",
      quantity: 3,
    });

    const response = await app.inventory.transfer({
      tenantId: TENANT,
      productId: "product-8",
      sourceWarehouseId: "wh-1",
      destinationWarehouseId: "wh-2",
      quantity: 5,
    });
    expect(response.status).toBe(409);
  });

  it("registers a warehouse, rejects a duplicate code, then deactivates it", async () => {
    const app = wire();

    const registered = await app.warehouse.register({
      tenantId: TENANT,
      code: "WH-EAST",
      name: "East DC",
    });
    expect(registered.status).toBe(201);
    const { warehouseId } = registered.body as { warehouseId: string };

    const duplicate = await app.warehouse.register({
      tenantId: TENANT,
      code: "WH-EAST",
      name: "East DC (dup)",
    });
    expect(duplicate.status).toBe(409);

    const invalid = await app.warehouse.register({ tenantId: TENANT, code: "", name: "Nameless" });
    expect(invalid.status).toBe(422);

    const deactivated = await app.warehouse.deactivate({ tenantId: TENANT, warehouseId });
    expect(deactivated.status).toBe(200);
    expect((deactivated.body as { status: string }).status).toBe("inactive");

    const count = await app.drainOutbox();
    expect(app.deliveredEventTypes).toContain("inventory.warehouse.registered");
    expect(app.deliveredEventTypes).toContain("inventory.warehouse.deactivated");
    expect(count).toBeGreaterThan(0);
  });

  it("rejects deactivating an already-inactive warehouse (409)", async () => {
    const app = wire();
    const registered = await app.warehouse.register({
      tenantId: TENANT,
      code: "WH-WEST",
      name: "West DC",
    });
    const { warehouseId } = registered.body as { warehouseId: string };
    await app.warehouse.deactivate({ tenantId: TENANT, warehouseId });

    const second = await app.warehouse.deactivate({ tenantId: TENANT, warehouseId });
    expect(second.status).toBe(409);
  });
});
