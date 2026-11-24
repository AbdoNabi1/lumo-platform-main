import { describe, expect, it } from "vitest";
import { ValidationError } from "@platform/utils";
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
describe("customer segment use cases", () => {
  it("validates all fields together and enforces tenant-scoped uniqueness", async () => {
    const f = fixture();
    const invalid = await f.create.execute({ ...input(" "), conditions: [{ field: "bad" }] });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok && invalid.error instanceof ValidationError)
      expect(invalid.error.fields.map((x) => x.field)).toEqual(["name", "conditions.0.field"]);
    expect((await f.create.execute(input(" VIP "))).ok).toBe(true);
    const duplicate = await f.create.execute(input("vip"));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.code).toBe("CONFLICT");
    expect((await f.create.execute(input("vip", "b"))).ok).toBe(true);
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
    const stale = await upd(1, "Lost");
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("CONFLICT");
    expect(await upd(2, "Third")).toEqual({
      ok: true,
      value: { segmentId: z.value.segmentId, version: 3 },
    });
    const row = await f.get.execute({ tenantId: "a", segmentId: z.value.segmentId });
    if (!row.ok) throw row.error;
    expect(row.value.name).toBe("Third");
    expect(row.value.version).toBe(3);
    const isolated = await f.get.execute({ tenantId: "b", segmentId: z.value.segmentId });
    expect(isolated.ok).toBe(false);
    const noChanges = await f.update.execute({
      tenantId: "a",
      segmentId: z.value.segmentId,
      expectedVersion: 3,
    });
    expect(noChanges.ok).toBe(false);
    const def = await f.update.execute({
      tenantId: "a",
      segmentId: "default:any",
      expectedVersion: 1,
      name: "x",
    });
    expect(def.ok).toBe(false);
    const delStale = await f.del.execute({
      tenantId: "a",
      segmentId: z.value.segmentId,
      expectedVersion: 1,
    });
    expect(delStale.ok).toBe(false);
    expect(
      (await f.del.execute({ tenantId: "a", segmentId: z.value.segmentId, expectedVersion: 3 })).ok,
    ).toBe(true);
    expect(
      (await f.del.execute({ tenantId: "a", segmentId: z.value.segmentId, expectedVersion: 3 })).ok,
    ).toBe(false);
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
