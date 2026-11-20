import { describe, expect, it, vi } from "vitest";
import { PrismaUsageQuota } from "./prisma-usage-quota.adapter";

function quotaWith(row: { amount: unknown } | null) {
  const findFirst = vi.fn(async () => row);
  return {
    quota: new PrismaUsageQuota({ prisma: { usageCounter: { findFirst } } as never }),
    findFirst,
  };
}

describe("PrismaUsageQuota", () => {
  it("reads the tenant's running total for the resource and adds the requested amount", async () => {
    const { quota, findFirst } = quotaWith({ amount: 40 });
    const verdict = await quota.check({
      tenant: "tenant-a",
      resource: "orders",
      amount: 2,
    } as never);

    expect(findFirst).toHaveBeenCalledWith({
      where: { resource: "orders", tenantRef: "tenant-a" },
    });
    expect(verdict).toEqual({ resource: "orders", state: "ok", used: 42, limit: -1, ratio: 0 });
  });

  it("converts a Prisma Decimal amount to a number", async () => {
    const decimal = { valueOf: () => 7.5, toString: () => "7.5" };
    const { quota } = quotaWith({ amount: decimal });
    const verdict = await quota.check({ tenant: "t", resource: "api_calls", amount: 0 } as never);
    expect(verdict.used).toBe(7.5);
  });

  it("counts a request with no amount as one unit against an empty counter", async () => {
    const { quota } = quotaWith(null);
    const verdict = await quota.check({ tenant: "t", resource: "orders" } as never);
    expect(verdict.used).toBe(1);
  });

  it("stays unmetered (fail-open) because Licensing exposes no per-tenant limit yet", async () => {
    const { quota } = quotaWith({ amount: 1_000_000 });
    const verdict = await quota.check({ tenant: "t", resource: "orders" } as never);
    expect(verdict).toMatchObject({ state: "ok", limit: -1, ratio: 0 });
  });
});
