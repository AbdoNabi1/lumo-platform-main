import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { Result } from "@platform/types";
import {
  BusinessRuleError,
  ConcurrencyError,
  ConflictError,
  NotFoundError,
  ValidationError,
  type DomainError,
} from "@platform/utils";
import { CustomerSegment, DEFAULT_SEGMENTS } from "../domain/customer-segment";
import type { CustomerSegmentRepository } from "../domain/customer-segment-repository";
import { InMemoryCustomerSegmentRepository } from "../infrastructure/in-memory-customer-segment-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { CustomerSegmentController } from "../interfaces/customer-segment.controller";
import {
  CreateCustomerSegment,
  DeleteCustomerSegment,
  GetCustomerSegment,
  ListCustomerSegments,
  UpdateCustomerSegment,
} from "./customer-segment.use-cases";

const conditions = [{ field: "orders_count", op: "gte", value: 1 }];
function fixture() {
  const segments = new InMemoryCustomerSegmentRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  let n = 0;
  const idGenerator = {
    generate: () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`,
  };
  const clock = { now: () => new Date("2026-01-01") };
  const createCustomerSegment = new CreateCustomerSegment({
    segments,
    unitOfWork,
    idGenerator,
    clock,
  });
  const updateCustomerSegment = new UpdateCustomerSegment({ segments, unitOfWork, clock });
  const deleteCustomerSegment = new DeleteCustomerSegment({ segments, unitOfWork });
  const listCustomerSegments = new ListCustomerSegments({ segments });
  const getCustomerSegment = new GetCustomerSegment({ segments });
  return {
    segments,
    create: createCustomerSegment,
    update: updateCustomerSegment,
    del: deleteCustomerSegment,
    list: listCustomerSegments,
    get: getCustomerSegment,
    controller: new CustomerSegmentController({
      createCustomerSegment,
      updateCustomerSegment,
      deleteCustomerSegment,
      listCustomerSegments,
      getCustomerSegment,
    }),
  };
}
const input = (name: string, tenantId = "a") => ({ tenantId, name, conditions, createdBy: null });
const fail = <T>(result: Result<T, DomainError>): DomainError => {
  if (result.ok) throw new Error("expected a failed Result");
  return result.error;
};
/** Wraps a repository so every call is recorded; `override` replaces selected methods. */
function recording(
  target: CustomerSegmentRepository,
  override: Partial<CustomerSegmentRepository> = {},
) {
  const calls: string[] = [];
  const repo = new Proxy(target, {
    get(t, prop) {
      const impl = (override as Record<string | symbol, unknown>)[prop] ?? Reflect.get(t, prop);
      if (typeof impl !== "function") return impl;
      return (...args: unknown[]) => {
        calls.push(String(prop));
        return (impl as (...a: unknown[]) => unknown).apply(t, args);
      };
    },
  });
  return { repo, calls };
}
function countingUnitOfWork() {
  const inner = new InMemoryUnitOfWork();
  const state = { runs: 0 };
  const unitOfWork: TransactionalUnitOfWork<unknown> = {
    run: (work) => {
      state.runs++;
      return inner.run(work);
    },
  };
  return { unitOfWork, state };
}
function guarded(
  makeOverride: (
    base: InMemoryCustomerSegmentRepository,
  ) => Partial<CustomerSegmentRepository> = () => ({}),
) {
  const base = new InMemoryCustomerSegmentRepository();
  const { repo, calls } = recording(base, makeOverride(base));
  const { unitOfWork, state } = countingUnitOfWork();
  let n = 0;
  const idGenerator = {
    generate: () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`,
  };
  const clock = { now: () => new Date("2026-01-01") };
  return {
    base,
    calls,
    uow: state,
    create: new CreateCustomerSegment({ segments: repo, unitOfWork, idGenerator, clock }),
    update: new UpdateCustomerSegment({ segments: repo, unitOfWork, clock }),
    del: new DeleteCustomerSegment({ segments: repo, unitOfWork }),
  };
}
const SEG = "00000000-0000-0000-0000-000000000001";
const seedDirect = async (g: ReturnType<typeof guarded>) => {
  await g.base.save(
    CustomerSegment.create(
      UniqueEntityId.from(SEG),
      "Seed",
      [{ field: "email_subscribed", value: true }],
      null,
      new Date("2026-01-01"),
    ),
    "a",
  );
  return SEG;
};
const seed = async (g: ReturnType<typeof guarded>, name = "Seed", tenantId = "a") => {
  const r = await g.create.execute(input(name, tenantId));
  if (!r.ok) throw r.error;
  g.calls.length = 0;
  g.uow.runs = 0;
  return r.value.segmentId;
};
describe("customer segment use cases", () => {
  it("validates all fields together and enforces tenant-scoped uniqueness", async () => {
    const f = fixture();
    const invalid = await f.create.execute({ ...input(" "), conditions: [{ field: "bad" }] });
    const error = fail(invalid);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.code).toBe("VALIDATION");
    expect(error.message).toBe("Invalid segment");
    expect((error as ValidationError).fields.map((x) => x.field)).toEqual([
      "name",
      "conditions.0.field",
    ]);
    expect((await f.create.execute(input(" VIP "))).ok).toBe(true);
    const duplicate = await f.create.execute(input("vip"));
    expect(fail(duplicate).code).toBe("CONFLICT");
    expect((await f.create.execute(input("vip", "b"))).ok).toBe(true);
  });
  it("rejects invalid create input before touching the repository or unit of work", async () => {
    const g = guarded();
    const error = fail(await g.create.execute({ ...input(" "), conditions: [{ field: "bad" }] }));
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.code).toBe("VALIDATION");
    expect((error as ValidationError).fields.map((x) => x.field)).toEqual([
      "name",
      "conditions.0.field",
    ]);
    expect(g.calls).toEqual([]);
    expect(g.uow.runs).toBe(0);
    expect(await g.base.count("a")).toBe(0);
  });
  it("rejects invalid update name plus conditions as one validation error before persistence", async () => {
    const g = guarded();
    const segmentId = await seed(g);
    const error = fail(
      await g.update.execute({
        tenantId: "a",
        segmentId,
        expectedVersion: 1,
        name: " ",
        conditions: [{ field: "bad" }],
      }),
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.code).toBe("VALIDATION");
    expect((error as ValidationError).fields.map((x) => x.field)).toEqual([
      "name",
      "conditions.0.field",
    ]);
    expect(g.calls).toEqual([]);
    expect(g.uow.runs).toBe(0);
    expect((await g.base.findById(segmentId, "a"))?.version).toBe(1);
  });
  it("rejects an update with neither name nor conditions as VALIDATION on body before persistence", async () => {
    const g = guarded();
    const segmentId = await seed(g);
    const error = fail(await g.update.execute({ tenantId: "a", segmentId, expectedVersion: 1 }));
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.code).toBe("VALIDATION");
    expect((error as ValidationError).fields.map((x) => x.field)).toEqual(["body"]);
    expect(g.calls).toEqual([]);
    expect(g.uow.runs).toBe(0);
  });
  it("rejects default segment update and delete as BUSINESS_RULE without persistence access", async () => {
    const g = guarded();
    for (const id of [DEFAULT_SEGMENTS[0]!.id, "default:any"]) {
      const del = fail(await g.del.execute({ tenantId: "a", segmentId: id, expectedVersion: 1 }));
      expect(del).toBeInstanceOf(BusinessRuleError);
      expect(del.code).toBe("BUSINESS_RULE");
      expect(del.message).toBe("Default segments can't be changed");
      const upd = fail(
        await g.update.execute({ tenantId: "a", segmentId: id, expectedVersion: 1, name: "x" }),
      );
      expect(upd).toBeInstanceOf(BusinessRuleError);
      expect(upd.code).toBe("BUSINESS_RULE");
      expect(upd.message).toBe("Default segments can't be changed");
    }
    expect(g.calls).toEqual([]);
    expect(g.uow.runs).toBe(0);
    const f = fixture();
    const got = await f.get.execute({ tenantId: "a", segmentId: DEFAULT_SEGMENTS[0]!.id });
    if (!got.ok) throw got.error;
    expect(got.value.kind).toBe("default");
  });
  it("returns exact NOT_FOUND for unknown and foreign-tenant delete and get", async () => {
    const f = fixture();
    const created = await f.create.execute(input("Owned"));
    if (!created.ok) throw created.error;
    const segmentId = created.value.segmentId;
    const foreignDelete = fail(
      await f.del.execute({ tenantId: "b", segmentId, expectedVersion: 1 }),
    );
    expect(foreignDelete).toBeInstanceOf(NotFoundError);
    expect(foreignDelete.code).toBe("NOT_FOUND");
    const foreignGet = fail(await f.get.execute({ tenantId: "b", segmentId }));
    expect(foreignGet).toBeInstanceOf(NotFoundError);
    expect(foreignGet.code).toBe("NOT_FOUND");
    const owner = await f.get.execute({ tenantId: "a", segmentId });
    expect(owner.ok).toBe(true);
    expect((await f.del.execute({ tenantId: "a", segmentId, expectedVersion: 1 })).ok).toBe(true);
    const again = fail(await f.del.execute({ tenantId: "a", segmentId, expectedVersion: 1 }));
    expect(again).toBeInstanceOf(NotFoundError);
    expect(again.code).toBe("NOT_FOUND");
    expect(again.message).toBe("Segment not found");
  });
  it("lists defaults and sorted custom segments and updates versions with stale protection", async () => {
    const f = fixture();
    const z = await f.create.execute(input("Zulu"));
    const a = await f.create.execute(input("Alpha"));
    if (!z.ok || !a.ok) throw new Error("create failed");
    const list = await f.list.execute({ tenantId: "a" });
    if (!list.ok) throw list.error;
    expect(list.value.items.map((x) => x.name)).toEqual([null, null, null, null, "Alpha", "Zulu"]);
    const upd = (expectedVersion: number, name: string) =>
      f.update.execute({ tenantId: "a", segmentId: z.value.segmentId, expectedVersion, name });
    expect(await upd(1, "First")).toEqual({
      ok: true,
      value: { segmentId: z.value.segmentId, version: 2 },
    });
    const stale = fail(await upd(1, "Lost"));
    expect(stale).toBeInstanceOf(ConflictError);
    expect(stale.code).toBe("CONFLICT");
    expect(stale.message).toBe("This segment was changed by someone else");
    expect(await upd(2, "Third")).toEqual({
      ok: true,
      value: { segmentId: z.value.segmentId, version: 3 },
    });
    const row = await f.get.execute({ tenantId: "a", segmentId: z.value.segmentId });
    if (!row.ok) throw row.error;
    expect(row.value.name).toBe("Third");
    expect(row.value.version).toBe(3);
    const isolated = fail(await f.get.execute({ tenantId: "b", segmentId: z.value.segmentId }));
    expect(isolated.code).toBe("NOT_FOUND");
    const delStale = fail(
      await f.del.execute({ tenantId: "a", segmentId: z.value.segmentId, expectedVersion: 1 }),
    );
    expect(delStale).toBeInstanceOf(ConflictError);
    expect(delStale.code).toBe("CONFLICT");
    expect(
      (await f.del.execute({ tenantId: "a", segmentId: z.value.segmentId, expectedVersion: 3 })).ok,
    ).toBe(true);
  });
  it("translates a save-time ConcurrencyError after a matching-version load into CONFLICT", async () => {
    const g = guarded(() => ({
      save: async () => {
        throw new ConcurrencyError("Segment was modified concurrently");
      },
    }));
    const segmentId = await seedDirect(g);
    const result = await g.update.execute({
      tenantId: "a",
      segmentId,
      expectedVersion: 1,
      name: "Renamed",
    });
    const error = fail(result);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("This segment was changed by someone else");
    const stored = await g.base.findById(segmentId, "a");
    expect(stored?.name).toBe("Seed");
    expect(stored?.version).toBe(1);
  });
  it("returns CONFLICT for the loser of two interleaved updates and keeps the winner's state", async () => {
    let loaded = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const g = guarded((base) => ({
      findById: async (id, tenantId) => {
        const segment = await base.findById(id, tenantId);
        if (++loaded === 2) release();
        await gate;
        return segment;
      },
    }));
    const segmentId = await seedDirect(g);
    const [winner, loser] = await Promise.all([
      g.update.execute({
        tenantId: "a",
        segmentId,
        expectedVersion: 1,
        name: "Winner",
        conditions: [{ field: "email_subscribed", value: true }],
      }),
      g.update.execute({
        tenantId: "a",
        segmentId,
        expectedVersion: 1,
        name: "Loser",
        conditions: [{ field: "orders_count", op: "eq", value: 0 }],
      }),
    ]);
    expect(winner).toEqual({ ok: true, value: { segmentId, version: 2 } });
    const error = fail(loser);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("This segment was changed by someone else");
    const stored = await g.base.findById(segmentId, "a");
    expect(stored?.name).toBe("Winner");
    expect(stored?.version).toBe(2);
    expect(stored?.conditions).toEqual([{ field: "email_subscribed", value: true }]);
  });
  it("serializes concurrent creates at 99 and leaves other tenants independent", async () => {
    const f = fixture();
    for (let i = 0; i < 99; i++) expect((await f.create.execute(input(`n${i}`))).ok).toBe(true);
    const results = await Promise.all([
      f.create.execute(input("last1")),
      f.create.execute(input("last2")),
    ]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    const failed = results.find((x) => !x.ok);
    if (failed && !failed.ok) expect(failed.error.code).toBe("BUSINESS_RULE");
    expect(await f.segments.count("a")).toBe(100);
    expect((await f.create.execute(input("other", "b"))).ok).toBe(true);
  });
  it("presents success statuses", async () => {
    const f = fixture();
    const created = await f.controller.create(input("abc"));
    expect(created.status).toBe(201);
    const list = await f.controller.list({ tenantId: "a" });
    expect(list.status).toBe(200);
    const row = await f.list.execute({ tenantId: "a" });
    if (!row.ok) throw row.error;
    const segmentId = row.value.items[4]!.id;
    expect((await f.controller.get({ tenantId: "a", segmentId })).status).toBe(200);
    expect(
      (await f.controller.update({ tenantId: "a", segmentId, expectedVersion: 1, name: "xyz" }))
        .status,
    ).toBe(200);
    expect(
      (await f.controller.delete({ tenantId: "a", segmentId, expectedVersion: 2 })).status,
    ).toBe(200);
  });
});
