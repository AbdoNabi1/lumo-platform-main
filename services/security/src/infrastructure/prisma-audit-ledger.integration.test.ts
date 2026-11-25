import { afterEach, describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork, type TransactionClient } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { AuditChain } from "../domain/audit-chain";
import { PrismaAuditLedgerRepository } from "./prisma-repositories";
import { SecurityEventTranslator } from "./security-event-translator";

/**
 * Integration suite for `PrismaAuditLedgerRepository.listForTenant` (the Wave 1e staff activity
 * reader) against a real PostgreSQL. HONESTLY GATED on `DATABASE_URL_TEST` (CI's disposable
 * Postgres job); never point it at a shared database. Clients are created lazily inside `wire`.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("Prisma audit ledger — listForTenant (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-11-27T10:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };
  const clients: ReturnType<typeof createTestPrismaClient>[] = [];
  const chain = new AuditChain();
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.$disconnect()));
  });

  function wire() {
    const prisma = createTestPrismaClient(databaseUrl);
    clients.push(prisma);
    const outbox = new OutboxWriter<TransactionClient>({
      store: new PrismaOutboxStore(prisma),
      translator: new SecurityEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "security",
    });
    const deps = { prisma, outbox, context: rootEventContext(ids) };
    return { uow: new PrismaUnitOfWork(prisma), audit: new PrismaAuditLedgerRepository(deps) };
  }

  const at = (n: number): string => new Date(Date.UTC(2026, 10, 27, 10, 0, n)).toISOString();

  /** Appends one record into the chain scope `scope` of `tenantId` (links to that scope's tail). */
  async function append(
    w: ReturnType<typeof wire>,
    tenantId: string,
    scope: string | null,
    input: { id?: string; at: string; action?: string; principalRef?: string },
  ): Promise<string> {
    const id = input.id ?? ids.generate();
    await w.uow.run(async (tx) => {
      const tail = await w.audit.tail(scope, tenantId, tx);
      await w.audit.append(
        chain.append(tail, {
          id,
          principalRef: input.principalRef ?? "p-1",
          action: input.action ?? "security.mfa.enabled",
          decision: "allow",
          tenantRef: scope,
          occurredAt: input.at,
        }),
        tenantId,
        tx,
      );
    });
    return id;
  }

  it("returns rows of every tenant_scope newest first, never another tenant's, and pages with a cursor", async () => {
    const w = wire();
    const tenantId = `audit-list-${ids.generate()}`;
    const otherTenant = `audit-list-${ids.generate()}`;
    const actions = ["security.mfa.enabled", "security.staff.role_changed"];
    // five rows spread over three scopes (null, the tenant's own, a foreign scope name) …
    const scopes: Array<string | null> = [null, tenantId, "some-other-scope", null, tenantId];
    const written: string[] = [];
    for (const [i, scope] of scopes.entries())
      written.push(await append(w, tenantId, scope, { at: at(i + 1) }));
    // … a row of another tenant that is newer than all of them …
    await append(w, otherTenant, null, { at: at(50) });
    // … and a row of an action outside the allow-list
    await append(w, tenantId, null, { at: at(60), action: "security.session.established" });

    const all = await w.audit.listForTenant({ tenantId, actions, limit: 50 });
    expect(all.map((r) => r.id)).toEqual([...written].reverse());
    expect(new Set(all.map((r) => r.content.tenantRef))).toEqual(new Set(scopes));

    const page1 = await w.audit.listForTenant({ tenantId, actions, limit: 2 });
    expect(page1.map((r) => r.id)).toEqual([written[4], written[3]]);
    const last = page1[1]!;
    const page2 = await w.audit.listForTenant({
      tenantId,
      actions,
      limit: 2,
      before: { occurredAt: last.content.occurredAt, id: last.id },
    });
    expect(page2.map((r) => r.id)).toEqual([written[2], written[1]]);
    const page3 = await w.audit.listForTenant({
      tenantId,
      actions,
      limit: 2,
      before: { occurredAt: page2[1]!.content.occurredAt, id: page2[1]!.id },
    });
    expect(page3.map((r) => r.id)).toEqual([written[0]]);

    // tenant B's rows are only ever visible to tenant B
    const other = await w.audit.listForTenant({ tenantId: otherTenant, actions, limit: 50 });
    expect(other).toHaveLength(1);
    expect(other.some((r) => written.includes(r.id))).toBe(false);
  });

  it("ties on occurred_at break on id descending; the principalRef filter applies", async () => {
    const w = wire();
    const tenantId = `audit-list-${ids.generate()}`;
    const actions = ["security.mfa.enabled"];
    const sameTime = at(7);
    const rowIds = [
      "00000000-0000-4000-8000-0000000000a1",
      "00000000-0000-4000-8000-0000000000a2",
      "00000000-0000-4000-8000-0000000000a3",
    ];
    await append(w, tenantId, null, { id: rowIds[0]!, at: sameTime, principalRef: "p-a" });
    await append(w, tenantId, tenantId, { id: rowIds[2]!, at: sameTime, principalRef: "p-b" });
    await append(w, tenantId, "x", { id: rowIds[1]!, at: sameTime, principalRef: "p-a" });

    const all = await w.audit.listForTenant({ tenantId, actions, limit: 10 });
    expect(all.map((r) => r.id)).toEqual([rowIds[2], rowIds[1], rowIds[0]]);
    const afterFirst = await w.audit.listForTenant({
      tenantId,
      actions,
      limit: 10,
      before: { occurredAt: sameTime, id: rowIds[2]! },
    });
    expect(afterFirst.map((r) => r.id)).toEqual([rowIds[1], rowIds[0]]);
    const onlyA = await w.audit.listForTenant({
      tenantId,
      actions,
      principalRefs: ["p-a"],
      limit: 10,
    });
    expect(onlyA.map((r) => r.id)).toEqual([rowIds[1], rowIds[0]]);
    expect(
      await w.audit.listForTenant({ tenantId, actions, principalRefs: [], limit: 10 }),
    ).toEqual([]);
  });
});
