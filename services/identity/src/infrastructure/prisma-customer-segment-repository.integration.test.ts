import { afterEach, describe, expect, it } from "vitest";
import { PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { ConcurrencyError, ConflictError } from "@platform/utils";
import { CreateCustomerSegment } from "../application/customer-segment.use-cases";
import { CustomerSegment } from "../domain/customer-segment";
import { PrismaCustomerSegmentRepository } from "./prisma-customer-segment-repository";

const url = process.env["DATABASE_URL_TEST"];
describe.runIf(Boolean(url))("Prisma customer segments (integration)", () => {
  const clients: ReturnType<typeof createTestPrismaClient>[] = [];
  const tenants: string[] = [];
  afterEach(async () => {
    const client = clients[0];
    if (client)
      for (const tenantId of tenants.splice(0))
        await client.customerSegment.deleteMany({ where: { tenantId } });
    await Promise.all(clients.splice(0).map((c) => c.$disconnect()));
  });
  const wire = () => {
    const prisma = createTestPrismaClient(url);
    clients.push(prisma);
    const tenantId = `segments-${crypto.randomUUID()}`;
    tenants.push(tenantId);
    const segments = new PrismaCustomerSegmentRepository({ prisma });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    const create = new CreateCustomerSegment({
      segments,
      unitOfWork,
      idGenerator: { generate: () => crypto.randomUUID() },
      clock: { now: () => new Date() },
    });
    return { segments, unitOfWork, tenantId, create };
  };
  const condition = [{ field: "email_subscribed" as const, value: true }];
  const make = (name: string) =>
    CustomerSegment.create(
      UniqueEntityId.from(crypto.randomUUID()),
      name,
      condition,
      null,
      new Date(),
    );
  it("round trips, enforces unique names and CAS, and isolates tenants", async () => {
    const { segments, unitOfWork, tenantId } = wire();
    const other = `${tenantId}-other`;
    tenants.push(other);
    const first = make("VIP");
    await unitOfWork.run((tx) => segments.save(first, tenantId, tx));
    expect(await segments.findById("bad", tenantId)).toBeNull();
    expect(await segments.findById(first.id.toString(), other)).toBeNull();
    const a = (await segments.findById(first.id.toString(), tenantId))!;
    const b = (await segments.findById(first.id.toString(), tenantId))!;
    expect(a.version).toBe(1);
    const winnerConditions = [{ field: "orders_count" as const, op: "gte" as const, value: 5 }];
    a.rename("winner", new Date());
    a.replaceConditions(winnerConditions, new Date());
    expect(await unitOfWork.run((tx) => segments.save(a, tenantId, tx))).toBe(2);
    b.rename("loser", new Date());
    b.replaceConditions([{ field: "orders_count", op: "eq", value: 0 }], new Date());
    await expect(unitOfWork.run((tx) => segments.save(b, tenantId, tx))).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
    const afterLoss = (await segments.findById(first.id.toString(), tenantId))!;
    expect(afterLoss.name).toBe("winner");
    expect(afterLoss.conditions).toEqual(winnerConditions);
    expect(afterLoss.version).toBe(2);
    await expect(
      unitOfWork.run((tx) => segments.save(make("WINNER"), tenantId, tx)),
    ).rejects.toBeInstanceOf(ConflictError);
    await unitOfWork.run((tx) => segments.save(make("winner"), other, tx));
    const c = (await segments.findById(first.id.toString(), tenantId))!;
    c.rename("third", new Date());
    expect(await unitOfWork.run((tx) => segments.save(c, tenantId, tx))).toBe(3);
    expect((await segments.findById(first.id.toString(), tenantId))?.version).toBe(3);
  });
  it("serializes concurrent creation at 99 per tenant", async () => {
    const { segments, unitOfWork, tenantId, create } = wire();
    const other = `${tenantId}-other`;
    tenants.push(other);
    await unitOfWork.run(async (tx) => {
      for (let i = 0; i < 99; i++) await segments.save(make(`segment ${i}`), tenantId, tx);
    });
    const input = (name: string, t = tenantId) => ({
      tenantId: t,
      name,
      conditions: condition,
      createdBy: null,
    });
    const results = await Promise.all([
      create.execute(input("last a")),
      create.execute(input("last b")),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) expect(failed.error.code).toBe("BUSINESS_RULE");
    expect(await segments.count(tenantId)).toBe(100);
    expect((await create.execute(input("other", other))).ok).toBe(true);
  });
});
