import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";
import { ClickHouseAnalyticsReadStore } from "./clickhouse-analytics-read-store";

/** Captures the exact `query`/`query_params` sent to ClickHouse — no live instance in this environment (no tables exist yet, WP-3). */
function fakeClient() {
  const query = vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) });
  return { client: { query } as unknown as ClickHouseClient, query };
}

describe("ClickHouseAnalyticsReadStore", () => {
  it("always includes a tenant_id predicate bound to the per-call tenantId, never string-interpolated", async () => {
    const { client, query } = fakeClient();
    const store = new ClickHouseAnalyticsReadStore({ client });

    await store.fetch("finance.revenue", "tenant-a", { fields: ["grossMinor"] });

    expect(query).toHaveBeenCalledTimes(1);
    const call = query.mock.calls[0]![0] as {
      query: string;
      query_params: Record<string, unknown>;
    };
    expect(call.query).toContain("WHERE tenant_id = {tenantId:String}");
    expect(call.query_params["tenantId"]).toBe("tenant-a");
  });

  it("scopes different tenants to different query_params — no code path can omit it", async () => {
    const { client, query } = fakeClient();
    const store = new ClickHouseAnalyticsReadStore({ client });

    await store.fetch("finance.revenue", "tenant-a", { fields: ["grossMinor"] });
    await store.fetch("finance.revenue", "tenant-b", { fields: ["grossMinor"] });

    const tenantIds = query.mock.calls.map(
      (call) => (call[0] as { query_params: Record<string, unknown> }).query_params["tenantId"],
    );
    expect(tenantIds).toEqual(["tenant-a", "tenant-b"]);
  });

  it("the tenant predicate is ANDed with every additional filter, not a separate/optional clause", async () => {
    const { client, query } = fakeClient();
    const store = new ClickHouseAnalyticsReadStore({ client });

    await store.fetch("finance.revenue", "tenant-a", {
      fields: ["grossMinor"],
      filters: { period: "2026-07" },
    });

    const call = query.mock.calls[0]![0] as { query: string };
    expect(call.query).toMatch(
      /WHERE tenant_id = \{tenantId:String\}\s*AND period = \{filterValue0:String\}/,
    );
  });

  it("fails closed on a missing tenantId rather than querying unscoped", async () => {
    const { client, query } = fakeClient();
    const store = new ClickHouseAnalyticsReadStore({ client });

    await expect(store.fetch("finance.revenue", "", { fields: ["grossMinor"] })).rejects.toThrow(
      /tenantId is required/,
    );
    expect(query).not.toHaveBeenCalled();
  });
});
