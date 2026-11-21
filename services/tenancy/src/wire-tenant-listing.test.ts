import type { Database } from "@platform/db";
import { JsonEventSerializer } from "@platform/domain-events";
import { describe, expect, it, vi } from "vitest";
import { wireTenantListing } from "./composition";

const clock = { now: () => new Date("2026-11-20T10:00:00.000Z") };
const row = (id: string) => ({
  id,
  tenantId: "platform",
  slug: `shop-${id}`,
  name: `Shop ${id}`,
  status: "active",
  isolationTier: "pooled",
  branding: {},
  subscriptionRef: null,
  version: 1,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

describe("wireTenantListing", () => {
  it("lists tenants cursor-paginated inside the platform scope, with no write", async () => {
    expect.hasAssertions();
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([row("a"), row("b"), row("c")])
      .mockResolvedValueOnce([row("c")]);
    const prisma = { tenant: { findMany } } as unknown as Database;
    const list = wireTenantListing({
      prisma,
      tenantId: "platform",
      serializer: new JsonEventSerializer(),
      clock,
      idGenerator: { generate: () => "id-1" },
    });

    const first = await list.execute({ first: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.items.map((t) => t.id.toString())).toEqual(["a", "b"]);
    expect(first.value.pageInfo.hasNextPage).toBe(true);
    const cursor = first.value.pageInfo.endCursor;
    expect(cursor).not.toBeNull();

    const second = await list.execute({ first: 2, after: cursor as string });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.items.map((t) => t.id.toString())).toEqual(["c"]);
    expect(second.value.pageInfo.hasNextPage).toBe(false);

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { tenantId: "platform" } });
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      where: { tenantId: "platform", id: { gt: "b" } },
    });
  });
});
