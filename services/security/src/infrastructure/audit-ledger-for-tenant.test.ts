import { describe, expect, it } from "vitest";
import { AuditChain } from "../domain/audit-chain";
import type { AuditRecord } from "../domain/audit-record";
import { InMemoryAuditLedgerRepository } from "./in-memory-repositories";
import * as M from "./prisma-mappers";
import { PrismaAuditLedgerRepository } from "./prisma-repositories";

const chain = new AuditChain();
const ACTIONS = ["a.one", "a.two"];

/** Appends the given rows into one chain scope of a tenant. */
async function fill(
  ledger: InMemoryAuditLedgerRepository,
  tenantId: string,
  scope: string | null,
  rows: Array<{ id: string; at: string; action?: string; principalRef?: string }>,
): Promise<void> {
  for (const row of rows) {
    const tail = await ledger.tail(scope, tenantId);
    await ledger.append(
      chain.append(tail, {
        id: row.id,
        principalRef: row.principalRef ?? "p-1",
        action: row.action ?? "a.one",
        decision: "allow",
        tenantRef: scope,
        occurredAt: row.at,
      }),
      tenantId,
    );
  }
}
const at = (n: number): string => new Date(Date.UTC(2026, 10, 27, 10, 0, n)).toISOString();
const ids = (rows: readonly AuditRecord[]): string[] => rows.map((r) => r.id);

describe("InMemoryAuditLedgerRepository.listForTenant", () => {
  it("returns every scope of the tenant newest first (occurredAt desc, id desc), never another tenant's", async () => {
    const ledger = new InMemoryAuditLedgerRepository();
    await fill(ledger, "t1", null, [
      { id: "00000000-0000-4000-8000-000000000001", at: at(1) },
      { id: "00000000-0000-4000-8000-000000000004", at: at(5) },
    ]);
    await fill(ledger, "t1", "t1", [{ id: "00000000-0000-4000-8000-000000000002", at: at(3) }]);
    await fill(ledger, "t1", "elsewhere", [
      { id: "00000000-0000-4000-8000-000000000003", at: at(5) },
    ]);
    await fill(ledger, "t2", "t2", [{ id: "00000000-0000-4000-8000-000000000009", at: at(9) }]);
    const rows = await ledger.listForTenant({ tenantId: "t1", actions: ACTIONS, limit: 50 });
    expect(ids(rows)).toEqual([
      "00000000-0000-4000-8000-000000000004",
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000001",
    ]);
    expect(await ledger.listForTenant({ tenantId: "t3", actions: ACTIONS, limit: 50 })).toEqual([]);
  });

  it("filters by action and principalRef (empty lists match nothing) and honours limit", async () => {
    const ledger = new InMemoryAuditLedgerRepository();
    await fill(ledger, "t1", null, [
      { id: "i-1", at: at(1), action: "a.one", principalRef: "p-1" },
      { id: "i-2", at: at(2), action: "a.two", principalRef: "p-2" },
      { id: "i-3", at: at(3), action: "a.other", principalRef: "p-1" },
      { id: "i-4", at: at(4), action: "a.one", principalRef: "p-2" },
    ]);
    const only = (input: { actions: string[]; principalRefs?: string[]; limit?: number }) =>
      ledger.listForTenant({ tenantId: "t1", limit: 50, ...input });
    expect(ids(await only({ actions: ACTIONS }))).toEqual(["i-4", "i-2", "i-1"]);
    expect(ids(await only({ actions: ACTIONS, principalRefs: ["p-2"] }))).toEqual(["i-4", "i-2"]);
    expect(await only({ actions: ACTIONS, principalRefs: [] })).toEqual([]);
    expect(await only({ actions: [] })).toEqual([]);
    expect(ids(await only({ actions: ACTIONS, limit: 2 }))).toEqual(["i-4", "i-2"]);
  });

  it("the cursor is exclusive and breaks ties on id", async () => {
    const ledger = new InMemoryAuditLedgerRepository();
    await fill(ledger, "t1", null, [
      { id: "i-1", at: at(1) },
      { id: "i-2", at: at(2) },
      { id: "i-3", at: at(2) },
      { id: "i-4", at: at(2) },
      { id: "i-5", at: at(3) },
    ]);
    const first = await ledger.listForTenant({ tenantId: "t1", actions: ACTIONS, limit: 2 });
    expect(ids(first)).toEqual(["i-5", "i-4"]);
    const second = await ledger.listForTenant({
      tenantId: "t1",
      actions: ACTIONS,
      limit: 2,
      before: { occurredAt: at(2), id: "i-4" },
    });
    expect(ids(second)).toEqual(["i-3", "i-2"]);
    const third = await ledger.listForTenant({
      tenantId: "t1",
      actions: ACTIONS,
      limit: 2,
      before: { occurredAt: at(2), id: "i-2" },
    });
    expect(ids(third)).toEqual(["i-1"]);
  });

  it("leaves the per-scope chains intact (list() still reads in sequence order and verifies)", async () => {
    const ledger = new InMemoryAuditLedgerRepository();
    await fill(ledger, "t1", "s", [
      { id: "i-1", at: at(1) },
      { id: "i-2", at: at(2) },
    ]);
    await ledger.listForTenant({ tenantId: "t1", actions: ACTIONS, limit: 5 });
    expect(chain.verify(await ledger.list("s", "t1")).valid).toBe(true);
  });
});

describe("PrismaAuditLedgerRepository.listForTenant (no database)", () => {
  const repo = new PrismaAuditLedgerRepository({} as never);

  function fakeTx(rows: unknown[] = []) {
    const calls: Array<Record<string, unknown>> = [];
    const tx = {
      securityAuditRecord: {
        findMany: (args: Record<string, unknown>) => {
          calls.push(args);
          return Promise.resolve(rows);
        },
      },
    };
    return { tx, calls };
  }

  it("filters by tenantId and actions only — never tenantScope — newest first with a take", async () => {
    const { tx, calls } = fakeTx();
    await repo.listForTenant({ tenantId: "t1", actions: ACTIONS, limit: 26 }, tx);
    expect(calls).toHaveLength(1);
    const args = calls[0]!;
    expect(args["where"]).toEqual({ tenantId: "t1", action: { in: ACTIONS } });
    expect(Object.keys(args["where"] as object)).not.toContain("tenantScope");
    expect(args["orderBy"]).toEqual([{ occurredAt: "desc" }, { id: "desc" }]);
    expect(args["take"]).toBe(26);
  });

  it("adds the principalRef filter and the keyset cursor", async () => {
    const { tx, calls } = fakeTx();
    await repo.listForTenant(
      {
        tenantId: "t1",
        actions: ACTIONS,
        principalRefs: ["p-1", "staff:a@x.com"],
        before: { occurredAt: "2026-11-27T10:00:05.000Z", id: "i-9" },
        limit: 10,
      },
      tx,
    );
    expect(calls[0]!["where"]).toEqual({
      tenantId: "t1",
      action: { in: ACTIONS },
      principalRef: { in: ["p-1", "staff:a@x.com"] },
      OR: [
        { occurredAt: { lt: "2026-11-27T10:00:05.000Z" } },
        { occurredAt: "2026-11-27T10:00:05.000Z", id: { lt: "i-9" } },
      ],
    });
  });

  it("maps rows to audit records and does not query for empty action / ref lists", async () => {
    const record = chain.append(null, {
      id: "00000000-0000-4000-8000-000000000001",
      principalRef: "p-1",
      action: "a.one",
      decision: "allow",
      tenantRef: "scope-x",
      occurredAt: at(1),
      metadata: { k: "v" },
    });
    const { tx, calls } = fakeTx([
      { ...M.AuditRecordMapper.toRow(record, "t1"), createdAt: new Date() },
    ]);
    const rows = await repo.listForTenant({ tenantId: "t1", actions: ACTIONS, limit: 5 }, tx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: record.id,
      content: { action: "a.one", metadata: { k: "v" } },
    });
    await repo.listForTenant({ tenantId: "t1", actions: [], limit: 5 }, tx);
    await repo.listForTenant({ tenantId: "t1", actions: ACTIONS, principalRefs: [], limit: 5 }, tx);
    expect(calls).toHaveLength(1);
  });
});
