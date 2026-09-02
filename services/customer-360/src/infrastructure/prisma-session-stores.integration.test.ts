import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { openSession } from "../domain/customer-session";
import { toSnapshot } from "../domain/session-snapshot";
import { SessionStarted } from "../events/session-started.event";
import { IdentityEventTranslator } from "./identity-event-translator";
import { PrismaJourneyStore } from "./prisma-journey-store";
import { PrismaSessionHistoryStore } from "./prisma-session-history-store";
import { PrismaSessionStore } from "./prisma-session-store";
import { runSessionStoreContractTests } from "./session-store.contract";

/**
 * Integration suite for the Phase 6.3 Session Stitching Engine Prisma adapters. Same honest gating
 * as `prisma-profile-stores.integration.test.ts` (same package, same convention): skipped, never
 * faked, without `DATABASE_URL_TEST`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/customer-360 test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];
const clock: Clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
const ids: IdGenerator = { generate: () => crypto.randomUUID() };
/**
 * Phase A.20 (Task 7): a real ISO timestamp strictly before `clock.now()`, standing in for the
 * placeholder string `"t0"` used elsewhere in this package's in-memory/unit tests. Those never
 * parse the value as a `Date` (harmless there), but this suite writes it into a real PostgreSQL
 * `DateTime` column via Prisma, which rejects `new Date("t0")` (Invalid Date) — see
 * PHASE_A19_REAL_POSTGRESQL_VALIDATION_REPORT.md §10.
 */
const T0 = "2026-07-20T23:59:59.000Z";

function wire(tenantId: string) {
  const prisma = createTestPrismaClient(databaseUrl);
  const outbox = new OutboxWriter({
    store: new PrismaOutboxStore(prisma),
    translator: new IdentityEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "customer360",
  });
  const context = rootEventContext(ids);
  const store = new PrismaSessionStore({ prisma, idGenerator: ids, tenantId });
  const history = new PrismaSessionHistoryStore({
    prisma,
    outbox,
    context,
    idGenerator: ids,
    tenantId,
  });
  const journey = new PrismaJourneyStore({ prisma, outbox, context, idGenerator: ids, tenantId });
  const unitOfWork = new PrismaUnitOfWork(prisma);
  return { store, history, journey, unitOfWork };
}

describe.runIf(Boolean(databaseUrl))("Prisma Session Stitching stores (integration)", () => {
  runSessionStoreContractTests("prisma", () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    return wire(tenantId).store;
  });

  it("appends a snapshot inside a transaction and rehydrates it via listFor/latestFor", async () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    const { history, unitOfWork } = wire(tenantId);
    const session = openSession({
      sessionId: `sess-${crypto.randomUUID()}`,
      visitorId: "v1",
      startedAt: T0,
    });
    const snapshot = toSnapshot(session, "started", clock.now().toISOString());
    const event = new SessionStarted(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from(session.sessionId),
        occurredAt: clock.now(),
      },
      { sessionId: session.sessionId, visitorId: session.visitorId },
    );

    await unitOfWork.run(async (tx) => {
      await history.append(snapshot, event, tx);
    });

    const listed = await history.listFor(session.sessionId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("open");

    const latest = await history.latestFor(session.sessionId);
    expect(latest?.reason).toBe("started");
  });

  it("append rejects a call without a transaction client (ADR-0003)", async () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    const { history } = wire(tenantId);
    const session = openSession({
      sessionId: `sess-${crypto.randomUUID()}`,
      visitorId: "v1",
      startedAt: T0,
    });
    const snapshot = toSnapshot(session, "started", clock.now().toISOString());

    await expect(history.append(snapshot, undefined)).rejects.toThrow(/transaction client/);
  });

  it("journey.record persists a transition and rejects a call without a transaction client", async () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    const { journey, unitOfWork } = wire(tenantId);
    const visitorId = `v-${crypto.randomUUID()}`;

    await unitOfWork.run(async (tx) => {
      await journey.record(
        {
          id: ids.generate(),
          kind: "timed_out",
          visitorId,
          fromSessionId: "a",
          toSessionId: "b",
          occurredAt: clock.now().toISOString(),
        },
        undefined,
        tx,
      );
    });

    const listed = await journey.listForVisitor(visitorId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.kind).toBe("timed_out");

    await expect(
      journey.record({
        id: ids.generate(),
        kind: "timed_out",
        visitorId,
        occurredAt: clock.now().toISOString(),
      }),
    ).rejects.toThrow(/transaction client/);
  });
});
