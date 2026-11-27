import type { IdGenerator } from "@platform/contracts";
import type { Database } from "@platform/db";
import { describe, expect, it } from "vitest";
import { PrismaDeliveryRetryQueue } from "./prisma-delivery-retry-queue";

/**
 * Statement-level guard for the Postgres adapter, runnable without a database: the claim is ONE short
 * transaction per tenant that sets the tenant scope first, takes rows with `FOR UPDATE SKIP LOCKED` and
 * writes the lease, and nothing in the adapter needs a session (`LISTEN`, advisory locks) that the
 * Supabase transaction pooler cannot keep. The behaviour against real rows — including two claimers at
 * once — is `prisma-delivery-retry-queue.integration.test.ts` (needs `DATABASE_URL_TEST`).
 */
const T0 = new Date("2026-11-27T10:00:00.000Z");

interface Captured {
  readonly kind: "queryRaw" | "executeRaw" | "tx-start";
  readonly sql: string;
  readonly values: readonly unknown[];
}

function stubDb(options: { dueTenants?: string[]; claimed?: Record<string, unknown>[] } = {}) {
  const log: Captured[] = [];
  const sqlOf = (strings: TemplateStringsArray): string =>
    strings.join("?").replace(/\s+/g, " ").trim();
  const tx = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      log.push({ kind: "executeRaw", sql: sqlOf(strings), values });
      return Promise.resolve(1);
    },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      log.push({ kind: "queryRaw", sql: sqlOf(strings), values });
      return Promise.resolve(options.claimed ?? []);
    },
    trackingDeliveryRetry: {
      createMany: (args: unknown) => {
        log.push({ kind: "queryRaw", sql: `createMany ${JSON.stringify(args)}`, values: [] });
        return Promise.resolve({ count: 1 });
      },
      updateMany: (args: unknown) => {
        log.push({ kind: "queryRaw", sql: `updateMany ${JSON.stringify(args)}`, values: [] });
        return Promise.resolve({ count: 1 });
      },
    },
  };
  const db = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      log.push({ kind: "queryRaw", sql: sqlOf(strings), values });
      return Promise.resolve((options.dueTenants ?? []).map((tenant_id) => ({ tenant_id })));
    },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      log.push({ kind: "tx-start", sql: "BEGIN", values: [] });
      return fn(tx);
    },
  } as unknown as Database;
  return { db, log };
}

const ids: IdGenerator = { generate: () => "00000000-0000-4000-8000-000000000001" };

describe("PrismaDeliveryRetryQueue statements (P1-D2)", () => {
  it("claims per tenant in one short transaction: tenant scope first, SKIP LOCKED, lease written", async () => {
    const claimedRow = {
      tenant_id: "t-1",
      event_id: "evt-1",
      destination: "ga4.mp.shop",
      platform: "ga4",
      attempts: 2,
      event_timestamp: new Date("2026-11-27T09:00:00.000Z"),
      window_expires_at: new Date("2026-11-30T09:00:00.000Z"),
      next_retry_at: new Date("2026-11-27T10:10:00.000Z"),
      last_error: "status 503",
    };
    const { db, log } = stubDb({ dueTenants: ["t-1"], claimed: [claimedRow] });
    const queue = new PrismaDeliveryRetryQueue(db, ids);

    const claimed = await queue.claimDue({ limit: 10, now: T0, leaseMs: 600_000 });

    expect(claimed).toEqual([
      {
        tenantId: "t-1",
        eventId: "evt-1",
        destination: "ga4.mp.shop",
        platform: "ga4",
        attempts: 2,
        eventTimestamp: claimedRow.event_timestamp,
        windowExpiresAt: claimedRow.window_expires_at,
        nextRetryAt: claimedRow.next_retry_at,
        lastError: "status 503",
      },
    ]);

    const kinds = log.map((entry) => entry.kind);
    // due-tenant scan (no transaction) → BEGIN → set_config → claim
    expect(kinds).toEqual(["queryRaw", "tx-start", "executeRaw", "queryRaw"]);
    expect(log[2]?.sql).toContain("set_config('app.tenant_id'");
    expect(log[2]?.values).toEqual(["t-1"]);
    const claim = log[3]?.sql ?? "";
    expect(claim).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim).toContain("SET next_retry_at =");
    expect(claim).toContain("d.tenant_id = ?");
    expect(claim).toContain("d.status = 'pending'");
    expect(claim).toContain("RETURNING");
    // the lease is the claim time + leaseMs, the due test is the claim time
    expect(log[3]?.values).toContain("2026-11-27T10:10:00.000Z");
    expect(log[3]?.values).toContain("2026-11-27T10:00:00.000Z");
    expect(log[3]?.values).toContain("t-1");
    expect(log[3]?.values).toContain(10);
  });

  it("never reaches for session state the transaction pooler cannot keep", async () => {
    const { db, log } = stubDb({ dueTenants: ["t-1", "t-2"] });
    const queue = new PrismaDeliveryRetryQueue(db, ids);
    await queue.claimDue({ limit: 10, now: T0, leaseMs: 1_000 });
    await queue.schedule(
      {
        tenantId: "t-1",
        eventId: "e",
        destination: "d",
        platform: "ga4",
        attempts: 1,
        eventTimestamp: T0,
        windowExpiresAt: T0,
        nextRetryAt: T0,
        lastError: null,
      },
      T0,
    );
    const all = log.map((entry) => entry.sql).join("\n");
    expect(all).not.toMatch(/LISTEN|NOTIFY|advisory|pg_try|DECLARE|CURSOR|SET SESSION/i);
  });

  it("stops claiming tenants once the limit is met", async () => {
    const row = (tenant: string, event: string) => ({
      tenant_id: tenant,
      event_id: event,
      destination: "d",
      platform: "ga4",
      attempts: 1,
      event_timestamp: T0,
      window_expires_at: T0,
      next_retry_at: T0,
      last_error: null,
    });
    const { db, log } = stubDb({
      dueTenants: ["t-1", "t-2", "t-3"],
      claimed: [row("t-1", "a"), row("t-1", "b")],
    });
    const queue = new PrismaDeliveryRetryQueue(db, ids);
    const claimed = await queue.claimDue({ limit: 2, now: T0, leaseMs: 1_000 });
    expect(claimed).toHaveLength(2);
    expect(log.filter((entry) => entry.kind === "tx-start")).toHaveLength(1);
  });

  it("parks idempotently: skipDuplicates, in the tenant's own scope, no payload columns", async () => {
    const { db, log } = stubDb();
    const queue = new PrismaDeliveryRetryQueue(db, ids);
    await queue.schedule(
      {
        tenantId: "t-1",
        eventId: "evt-1",
        destination: "meta.capi.shop",
        platform: "meta",
        attempts: 1,
        eventTimestamp: T0,
        windowExpiresAt: new Date(T0.getTime() + 1_000),
        nextRetryAt: new Date(T0.getTime() + 60_000),
        lastError: "status 503",
      },
      T0,
    );
    expect(log[1]?.sql).toContain("set_config('app.tenant_id'");
    const create = log[2]?.sql ?? "";
    expect(create).toContain('"skipDuplicates":true');
    expect(create).toContain('"status":"pending"');
    expect(create).not.toMatch(/payload|identity|email|phone/i);
  });

  it("settles only a row that is still pending, scoped by tenant, event and destination", async () => {
    const { db, log } = stubDb();
    const queue = new PrismaDeliveryRetryQueue(db, ids);
    const key = { tenantId: "t-1", eventId: "evt-1", destination: "meta.capi.shop" };
    await queue.markDelivered(key, T0);
    await queue.markDeadLettered(key, "window_expired", T0);
    await queue.reschedule(key, { attempts: 3, nextRetryAt: T0, lastError: "status 503" }, T0);
    const updates = log
      .filter((entry) => entry.sql.startsWith("updateMany"))
      .map((entry) => entry.sql);
    expect(updates).toHaveLength(3);
    for (const update of updates) {
      expect(update).toContain('"tenantId":"t-1"');
      expect(update).toContain('"eventId":"evt-1"');
      expect(update).toContain('"destination":"meta.capi.shop"');
      expect(update).toContain('"status":"pending"');
    }
    expect(updates[1]).toContain('"deadLetterReason":"window_expired"');
  });
});
