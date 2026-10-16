import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { isRegisteredResource, usageResourceRegistry } from "@platform/usage";
import type { UsageRecord, UsageRecorderPort } from "@platform/usage";
import { describe, expect, it } from "vitest";
import { CatalogEventTranslator } from "../infrastructure/catalog-event-translator";
import { InMemoryProductRepository } from "../infrastructure/in-memory-product-repository";
import type { ProductRepository } from "../domain/product-repository";
import { CreateProduct, type CreateProductInput } from "./create-product.use-case";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-09-29T10:00:00.000Z") };

/**
 * A recorder that models an outbox row: it only accepts a record made INSIDE a unit of work (it is
 * handed that transaction's handle) and holds it as pending until that transaction commits. A
 * record written with no handle is exactly the dual-write bug ADR-0003 forbids, so it throws.
 */
class TransactionalRecorder implements UsageRecorderPort {
  readonly committed: UsageRecord[] = [];
  private readonly pending = new Map<unknown, UsageRecord[]>();

  async record(record: UsageRecord, tx?: unknown): Promise<void> {
    if (tx === undefined || tx === null) {
      throw new Error("usage was recorded outside the unit of work");
    }
    this.pending.set(tx, [...(this.pending.get(tx) ?? []), record]);
  }

  commit(tx: unknown): void {
    this.committed.push(...(this.pending.get(tx) ?? []));
    this.pending.delete(tx);
  }

  rollback(tx: unknown): void {
    this.pending.delete(tx);
  }
}

class RollingBackUnitOfWork implements TransactionalUnitOfWork<unknown> {
  private readonly recorder: TransactionalRecorder;

  constructor(recorder: TransactionalRecorder) {
    this.recorder = recorder;
  }

  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    const tx = { id: Symbol("tx") };
    try {
      const result = await work(tx);
      this.recorder.commit(tx);
      return result;
    } catch (error) {
      this.recorder.rollback(tx);
      throw error;
    }
  }
}

function harness(overrides: { products?: ProductRepository } = {}) {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new CatalogEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "catalog",
  });
  const recorder = new TransactionalRecorder();
  const products =
    overrides.products ??
    new InMemoryProductRepository({ outbox, context: rootEventContext(sequentialIds()) });
  const createProduct = new CreateProduct({
    products,
    unitOfWork: new RollingBackUnitOfWork(recorder),
    idGenerator: sequentialIds(),
    clock,
    usage: recorder,
  });
  return { createProduct, recorder };
}

const validInput: CreateProductInput = {
  sku: "SKU-1",
  name: "Wagon",
  slug: "wagon",
  variants: [{ sku: "SKU-1-V1", priceAmountMinor: 1999, currency: "USD" }],
  tenantId: "tenant-1",
};

describe("CreateProduct writes usage (G-79 link 1)", () => {
  it("records one PRODUCT unit for the creating tenant, in the registry's unit", async () => {
    const { createProduct, recorder } = harness();

    const created = await createProduct.execute(validInput);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(recorder.committed).toEqual([
      {
        tenant: "tenant-1",
        resource: "PRODUCT",
        amount: 1,
        unit: "count",
        occurredAt: "2026-09-29T10:00:00.000Z",
        metadata: { productId: created.value.id },
      },
    ]);
  });

  it("uses a registered resource and the unit the registry declares for it", async () => {
    const { createProduct, recorder } = harness();

    await createProduct.execute(validInput);

    const record = recorder.committed[0];
    expect(record !== undefined && isRegisteredResource(record.resource)).toBe(true);
    expect(record?.unit).toBe(usageResourceRegistry.find("PRODUCT")?.unit);
  });

  it("attributes each creation to the tenant that made it", async () => {
    const { createProduct, recorder } = harness();

    await createProduct.execute({ ...validInput, tenantId: "tenant-a" });
    await createProduct.execute({
      ...validInput,
      sku: "SKU-2",
      slug: "wagon-2",
      variants: [{ sku: "SKU-2-V1", priceAmountMinor: 1, currency: "USD" }],
      tenantId: "tenant-b",
    });

    expect(recorder.committed.map((r) => r.tenant)).toEqual(["tenant-a", "tenant-b"]);
  });

  it("writes no usage when the product has no variants", async () => {
    const { createProduct, recorder } = harness();

    const result = await createProduct.execute({ ...validInput, variants: [] });

    expect(result.ok).toBe(false);
    expect(recorder.committed).toEqual([]);
  });

  it("writes no usage when the SKU is invalid", async () => {
    const { createProduct, recorder } = harness();

    const result = await createProduct.execute({ ...validInput, sku: "" });

    expect(result.ok).toBe(false);
    expect(recorder.committed).toEqual([]);
  });

  it("writes no usage when persisting the product throws — the transaction rolls both back", async () => {
    const failing = {
      save: async () => {
        throw new Error("database unavailable");
      },
    } as unknown as ProductRepository;
    const { createProduct, recorder } = harness({ products: failing });

    await expect(createProduct.execute(validInput)).rejects.toThrow("database unavailable");

    expect(recorder.committed).toEqual([]);
  });

  it("fails the creation when the usage write itself fails (a metering fault is not silently dropped)", async () => {
    const { createProduct, recorder } = harness();
    recorder.record = async () => {
      throw new Error("outbox unavailable");
    };

    await expect(createProduct.execute(validInput)).rejects.toThrow("outbox unavailable");
    expect(recorder.committed).toEqual([]);
  });
});
