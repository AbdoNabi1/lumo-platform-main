import { UniqueEntityId } from "@platform/domain";
import { ConcurrencyError, ConflictError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { CustomerSegment } from "../domain/customer-segment";
import { InMemoryCustomerSegmentRepository } from "./in-memory-customer-segment-repository";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const make = (n: number, name = `name ${n}`) =>
  CustomerSegment.create(
    UniqueEntityId.from(id(n)),
    name,
    [{ field: "tags", op: "has_any", values: ["vip"] }],
    null,
    new Date("2026-01-01"),
  );
describe("in-memory customer segments", () => {
  it("isolates snapshots and enforces versions, tenant uniqueness, and deletes", async () => {
    const repo = new InMemoryCustomerSegmentRepository();
    const original = make(1, "VIP");
    expect(await repo.save(original, "a")).toBe(1);
    original.rename("unsaved", new Date());
    const one = (await repo.findById(id(1), "a"))!;
    const two = (await repo.findById(id(1), "a"))!;
    expect(one.name).toBe("VIP");
    one.rename("first", new Date());
    expect(await repo.save(one, "a")).toBe(2);
    two.rename("second", new Date());
    await expect(repo.save(two, "a")).rejects.toBeInstanceOf(ConcurrencyError);
    expect((await repo.findById(id(1), "a"))!.name).toBe("first");
    await expect(repo.save(make(2, " FIRST "), "a")).rejects.toBeInstanceOf(ConflictError);
    expect(await repo.save(make(3, "first"), "b")).toBe(1);
    expect(await repo.findById(id(1), "b")).toBeNull();
    expect(await repo.findById("bad", "a")).toBeNull();
    expect(await repo.delete(id(1), 1, "a")).toBe("stale");
    expect(await repo.delete(id(1), 2, "a")).toBe("deleted");
    expect(await repo.delete(id(1), 2, "a")).toBe("not_found");
  });
  it("serializes count and create per tenant at the cap", async () => {
    const repo = new InMemoryCustomerSegmentRepository();
    for (let n = 1; n <= 99; n++) await repo.save(make(n), "a");
    const create = (n: number, tenant: string) =>
      repo.withTenantSegmentsLock(tenant, async () => {
        if ((await repo.count(tenant)) >= 100) return "cap";
        await Promise.resolve();
        await repo.save(make(n), tenant);
        return "ok";
      });
    expect((await Promise.all([create(100, "a"), create(101, "a")])).sort()).toEqual(["cap", "ok"]);
    expect(await repo.count("a")).toBe(100);
    expect(await create(102, "b")).toBe("ok");
  });
});
