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
    // Reads run on a scoped transaction client (the next test pins that); here the pagination is the subject.
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1), tenant: { findMany } };
    const prisma = {
      $transaction: (run: (client: unknown) => Promise<unknown>) => run(tx),
    } as unknown as Database;
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

  it("reads EACH page on a scoped transaction (app.tenant_id set first), never on the bare client", async () => {
    expect.hasAssertions();
    // Under enforced RLS a bare read sees no rows: every page must run inside `set_config('app.tenant_id', …)`.
    const events: string[] = [];
    const findMany = vi
      .fn()
      .mockImplementationOnce(() => {
        events.push("findMany:page1");
        return Promise.resolve([row("a"), row("b"), row("c")]);
      })
      .mockImplementationOnce(() => {
        events.push("findMany:page2");
        return Promise.resolve([row("c")]);
      });
    const tx = {
      $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        events.push(`set:${strings.join("?")}:${String(values[0])}`);
        return Promise.resolve(1);
      }),
      tenant: { findMany },
    };
    const bareFindMany = vi.fn().mockRejectedValue(new Error("bare client read"));
    const $transaction = vi.fn((run: (client: unknown) => Promise<unknown>) => run(tx));
    const prisma = { $transaction, tenant: { findMany: bareFindMany } } as unknown as Database;
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
    const second = await list.execute({
      first: 2,
      after: first.value.pageInfo.endCursor as string,
    });
    expect(second.ok).toBe(true);

    expect($transaction).toHaveBeenCalledTimes(2);
    expect(bareFindMany).not.toHaveBeenCalled();
    expect(events).toEqual([
      "set:SELECT set_config('app.tenant_id', ?, true):platform",
      "findMany:page1",
      "set:SELECT set_config('app.tenant_id', ?, true):platform",
      "findMany:page2",
    ]);
    // the predicate and the cursor survive the wrapping
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      where: { tenantId: "platform", id: { gt: "b" } },
      orderBy: { id: "asc" },
    });
  });
});
