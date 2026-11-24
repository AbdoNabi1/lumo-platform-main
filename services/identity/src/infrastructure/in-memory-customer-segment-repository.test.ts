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
    expect(one.version).toBe(1);
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
  it("keeps the first writer's name and conditions after a stale save and isolates unsaved edits", async () => {
    const repo = new InMemoryCustomerSegmentRepository();
    expect(await repo.save(make(1, "VIP"), "a")).toBe(1);
    const winner = (await repo.findById(id(1), "a"))!;
    const loser = (await repo.findById(id(1), "a"))!;
    const winnerConditions = [{ field: "email_subscribed", value: true }] as const;
    winner.rename("winner", new Date());
    winner.replaceConditions(winnerConditions, new Date());
    loser.rename("loser", new Date());
    loser.replaceConditions([{ field: "orders_count", op: "eq", value: 0 }], new Date());
    expect(await repo.save(winner, "a")).toBe(2);
    await expect(repo.save(loser, "a")).rejects.toBeInstanceOf(ConcurrencyError);
    const stored = (await repo.findById(id(1), "a"))!;
    expect(stored.name).toBe("winner");
    expect(stored.conditions).toEqual(winnerConditions);
    expect(stored.version).toBe(2);
    // Mutating a loaded, unsaved aggregate's conditions must not alias stored state.
    const loaded = (await repo.findById(id(1), "a"))!;
    (loaded.conditions as unknown as { value?: unknown }[])[0]!.value = false;
    (loaded.conditions as unknown as unknown[]).push({ field: "language", op: "unset" });
    const fresh = (await repo.findById(id(1), "a"))!;
    expect(fresh.conditions).toEqual(winnerConditions);
    expect(fresh.version).toBe(2);
  });
  it("progresses persisted versions v1 → v2 → v3 without mutating the saved aggregate", async () => {
    const repo = new InMemoryCustomerSegmentRepository();
    expect(await repo.save(make(1, "VIP"), "a")).toBe(1);
    const v1 = (await repo.findById(id(1), "a"))!;
    expect(v1.version).toBe(1);
    v1.rename("second", new Date());
    expect(await repo.save(v1, "a")).toBe(2);
    expect(v1.version).toBe(1);
    const v2 = (await repo.findById(id(1), "a"))!;
    expect(v2.version).toBe(2);
    v2.rename("third", new Date());
    expect(await repo.save(v2, "a")).toBe(3);
    expect(v2.version).toBe(2);
    const v3 = (await repo.findById(id(1), "a"))!;
    expect(v3.version).toBe(3);
    expect(v3.name).toBe("third");
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
