import type {
  AccessControl,
  AuditEvent,
  AuditTrail,
  Permission,
  Principal,
} from "@platform/contracts";
import type { CustomerSegmentController } from "@platform/identity";
import { AppError } from "@platform/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerSegmentQuery } from "../infrastructure/cross-context/customer-segment-query";
import { AdminGuard } from "./admin-guard";
import { CustomerSegmentsAdminController } from "./customer-segments.admin-controller";
import type { TenancyAdminController } from "./tenancy.admin-controller";

const staff: Principal = { id: "staff-7", kind: "staff", roles: [], tenantId: "t-1" };
const NOW = new Date("2026-07-05T00:00:00Z");
const NOT_PURCHASED = [{ field: "orders_count", op: "eq", value: 0 }];

function build(
  options: {
    allow?: (permission: Permission) => boolean;
    region?: { status: number; body: unknown };
    members?: CustomerSegmentQuery["members"];
  } = {},
) {
  const asked: Permission[] = [];
  const accessControl: AccessControl = {
    authorize: async (_principal, permission) => {
      asked.push(permission);
      return options.allow?.(permission) ?? true;
    },
  };
  const auditTrail: AuditTrail = { record: async (_entry: AuditEvent) => undefined };
  const guard = new AdminGuard({ accessControl, auditTrail, clock: { now: () => NOW } });
  const segments = {
    list: vi.fn().mockResolvedValue({ status: 200, body: { items: [] } }),
    get: vi.fn().mockResolvedValue({ status: 200, body: { conditions: NOT_PURCHASED } }),
    create: vi.fn().mockResolvedValue({ status: 201, body: { segmentId: "s-1" } }),
    update: vi.fn().mockResolvedValue({ status: 200, body: { segmentId: "s-1", version: 2 } }),
    delete: vi.fn().mockResolvedValue({ status: 200, body: { segmentId: "s-1" } }),
  };
  const members = vi.fn(
    options.members ??
      (async () => ({
        items: [],
        pageInfo: { hasNextPage: false, endCursor: null },
        total: 0,
        currency: "EGP",
      })),
  );
  const getStoreRegion = vi
    .fn()
    .mockResolvedValue(
      options.region ?? { status: 200, body: { currency: "KWD", timezone: "Asia/Kuwait" } },
    );
  const controller = new CustomerSegmentsAdminController({
    segments: segments as unknown as CustomerSegmentController,
    query: { members },
    tenancy: { getStoreRegion } as unknown as TenancyAdminController,
    guard,
    clock: { now: () => NOW },
  });
  return { controller, segments, members, getStoreRegion, asked };
}

beforeEach(() => {
  expect.hasAssertions();
});

describe("CustomerSegmentsAdminController", () => {
  it("guards reads as customers:read and writes as customers:manage_segments, before anything else", async () => {
    const { controller, segments, asked } = build({ allow: () => false });
    const results = await Promise.all([
      controller.list(staff, { tenantId: "t-1" }),
      controller.get(staff, { tenantId: "t-1", segmentId: "s" }),
      controller.storeCurrency(staff, "t-1"),
      controller.members(staff, { tenantId: "t-1", segmentId: "s", first: 5 }),
      controller.preview(staff, { tenantId: "t-1", conditions: [] }),
      controller.create(staff, { tenantId: "t-1", name: "n", conditions: [] }),
      controller.update(staff, { tenantId: "t-1", segmentId: "s", expectedVersion: 1 }),
      controller.delete(staff, { tenantId: "t-1", segmentId: "s", expectedVersion: 1 }),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      403, 403, 403, 403, 403, 403, 403, 403,
    ]);
    expect(asked.sort()).toEqual(
      [
        "customers:manage_segments",
        "customers:manage_segments",
        "customers:manage_segments",
        "customers:read",
        "customers:read",
        "customers:read",
        "customers:read",
        "customers:read",
      ].sort(),
    );
    for (const method of Object.values(segments)) expect(method).not.toHaveBeenCalled();
  });

  it("stamps createdBy with the acting principal, never an input field", async () => {
    const { controller, segments } = build();
    await controller.create(staff, {
      tenantId: "t-1",
      name: "VIPs",
      conditions: NOT_PURCHASED,
      ...({ createdBy: "someone-else" } as object),
    });
    expect(segments.create).toHaveBeenCalledWith(expect.objectContaining({ createdBy: "staff-7" }));
  });

  it("members: resolves the segment, then reads the shop's currency and zone and calls the query", async () => {
    const { controller, segments, members, getStoreRegion } = build();
    const response = await controller.members(staff, {
      tenantId: "t-1",
      segmentId: "default:not_purchased",
      first: 20,
      after: "cursor",
      search: "nour",
    });
    expect(response.status).toBe(200);
    expect(segments.get).toHaveBeenCalledWith({
      tenantId: "t-1",
      segmentId: "default:not_purchased",
    });
    expect(getStoreRegion).toHaveBeenCalledWith(staff, "t-1");
    expect(members).toHaveBeenCalledWith({
      tenantId: "t-1",
      conditions: NOT_PURCHASED,
      currency: "KWD",
      timezone: "Asia/Kuwait",
      now: NOW,
      first: 20,
      after: "cursor",
      search: "nour",
    });
  });

  it("returns a non-200 segment or region response as it is, without calling the query", async () => {
    const missing = build();
    missing.segments.get.mockResolvedValue({ status: 404, body: { code: "NOT_FOUND" } });
    expect(
      await missing.controller.members(staff, { tenantId: "t-1", segmentId: "x", first: 5 }),
    ).toEqual({ status: 404, body: { code: "NOT_FOUND" } });
    expect(missing.getStoreRegion).not.toHaveBeenCalled();

    const failedRegion = build({ region: { status: 500, body: { code: "UNEXPECTED" } } });
    expect(
      await failedRegion.controller.members(staff, { tenantId: "t-1", segmentId: "x", first: 5 }),
    ).toEqual({ status: 500, body: { code: "UNEXPECTED" } });
    expect(
      await failedRegion.controller.preview(staff, { tenantId: "t-1", conditions: NOT_PURCHASED }),
    ).toEqual({ status: 500, body: { code: "UNEXPECTED" } });
    expect(await failedRegion.controller.storeCurrency(staff, "t-1")).toEqual({
      status: 500,
      body: { code: "UNEXPECTED" },
    });
    expect(failedRegion.members).not.toHaveBeenCalled();
  });

  it("storeCurrency answers only the currency", async () => {
    const { controller } = build();
    expect(await controller.storeCurrency(staff, "t-1")).toEqual({
      status: 200,
      body: { currency: "KWD" },
    });
  });

  it("preview: invalid conditions are a 422 before the region or the query is touched", async () => {
    const { controller, getStoreRegion, members } = build();
    const response = await controller.preview(staff, {
      tenantId: "t-1",
      conditions: [{ field: "orders_count", op: "gte", value: -1 }],
    });
    expect(response.status).toBe(422);
    expect((response.body as { fields: { field: string }[] }).fields.map((f) => f.field)).toEqual([
      "conditions.0.value",
    ]);
    expect(getStoreRegion).not.toHaveBeenCalled();
    expect(members).not.toHaveBeenCalled();
  });

  it("an UNAVAILABLE query becomes a 503 envelope; any other failure is rethrown", async () => {
    const unavailable = build({
      members: async () => {
        throw new AppError("Segments need the database", { code: "UNAVAILABLE" });
      },
    });
    const response = await unavailable.controller.members(staff, {
      tenantId: "t-1",
      segmentId: "s",
      first: 5,
    });
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: "UNAVAILABLE",
      message: "Segments need the database",
    });

    const broken = build({
      members: async () => {
        throw new Error("connection reset");
      },
    });
    await expect(
      broken.controller.members(staff, { tenantId: "t-1", segmentId: "s", first: 5 }),
    ).rejects.toThrow("connection reset");
  });
});
