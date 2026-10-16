import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { applyFieldUpdate, createEmptyProfile } from "../domain/customer-profile";
import { toSnapshot } from "../domain/profile-snapshot";
import { ProfileCreated } from "../events/profile-created.event";
import { IdentityEventTranslator } from "./identity-event-translator";
import { PrismaProfileHistoryStore } from "./prisma-profile-history-store";
import { PrismaProfileStore } from "./prisma-profile-store";
import { runProfileStoreContractTests } from "./profile-store.contract";

/**
 * Integration suite for the Phase 6.2 Profile Engine Prisma adapters. Same honest gating as
 * `prisma-identity-stores.integration.test.ts` (same package, same convention): skipped, never
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

function wire() {
  const prisma = createTestPrismaClient(databaseUrl);
  const outbox = new OutboxWriter({
    store: new PrismaOutboxStore(prisma),
    translator: new IdentityEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "customer360",
  });
  const context = rootEventContext(ids);
  const store = new PrismaProfileStore({ prisma, idGenerator: ids });
  const history = new PrismaProfileHistoryStore({
    prisma,
    outbox,
    context,
    idGenerator: ids,
  });
  const unitOfWork = new PrismaUnitOfWork(prisma);
  return { store, history, unitOfWork };
}

describe.runIf(Boolean(databaseUrl))("Prisma Customer Profile stores (integration)", () => {
  runProfileStoreContractTests("prisma", () => {
    return wire().store;
  });

  it("appends a snapshot inside a transaction and rehydrates it via listFor/latestFor", async () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    const { history, unitOfWork } = wire();
    const identifier = { type: "customer_id" as const, value: `cust-${crypto.randomUUID()}` };

    const profile = applyFieldUpdate(
      createEmptyProfile(identifier.type, identifier.value, T0),
      "email",
      {
        value: "a@example.com",
        source: "orders",
        confidence: "verified",
        occurredAt: clock.now().toISOString(),
      },
    ).profile;
    const snapshot = toSnapshot(profile, "created", clock.now().toISOString());
    const event = new ProfileCreated(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from(identifier.value),
        occurredAt: clock.now(),
      },
      {
        identifierType: identifier.type,
        identifierValue: identifier.value,
        field: "email",
        source: "orders",
        confidence: "verified",
        version: 1,
      },
    );

    await unitOfWork.run(async (tx) => {
      await history.append(snapshot, event, tenantId, tx);
    });

    const listed = await history.listFor(identifier, tenantId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.fields.get("email")?.value).toBe("a@example.com");

    const latest = await history.latestFor(identifier, tenantId);
    expect(latest?.reason).toBe("created");

    // ADR-0014: a second tenant sees none of it.
    const otherTenant = `${tenantId}-other`;
    expect(await history.listFor(identifier, otherTenant)).toEqual([]);
    expect(await history.latestFor(identifier, otherTenant)).toBeNull();
  });

  it("append rejects a call without a transaction client (ADR-0003)", async () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    const { history } = wire();
    const identifier = { type: "customer_id" as const, value: `cust-${crypto.randomUUID()}` };
    const profile = createEmptyProfile(identifier.type, identifier.value, T0);
    const snapshot = toSnapshot(profile, "created", clock.now().toISOString());
    const event = new ProfileCreated(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from(identifier.value),
        occurredAt: clock.now(),
      },
      {
        identifierType: identifier.type,
        identifierValue: identifier.value,
        field: "email",
        source: "orders",
        confidence: "verified",
        version: 1,
      },
    );

    await expect(history.append(snapshot, event, tenantId)).rejects.toThrow(/transaction client/);
  });
});
