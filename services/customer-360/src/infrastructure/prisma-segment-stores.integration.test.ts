import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { Expr } from "@platform/expression";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import type { RuleSet } from "@platform/rules";
import { applyMembershipUpdate } from "../domain/segment-membership";
import { toSnapshot } from "../domain/segment-history";
import { CustomerEnteredSegment } from "../events/customer-entered-segment.event";
import { SegmentCreated } from "../events/segment-created.event";
import { INITIAL_SEGMENT_DEFINITION_VERSION } from "../ports/segment-definition";
import { IdentityEventTranslator } from "./identity-event-translator";
import { PrismaSegmentHistoryStore } from "./prisma-segment-history-store";
import { PrismaSegmentStore } from "./prisma-segment-store";
import { PrismaSegmentDefinitionRegistry } from "./prisma-segment-definition-registry";
import { runSegmentStoreContractTests } from "./segment-store.contract";
import { runSegmentDefinitionRegistryContractTests } from "./segment-definition-registry.contract";

/**
 * Integration suite for the Phase 6.5 Segmentation Prisma adapters. Same honest gating as
 * `prisma-attribute-stores.integration.test.ts`: skipped, never faked, without `DATABASE_URL_TEST`.
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
  const store = new PrismaSegmentStore({ prisma, idGenerator: ids, tenantId });
  const history = new PrismaSegmentHistoryStore({
    prisma,
    outbox,
    context,
    idGenerator: ids,
    tenantId,
  });
  const definitions = new PrismaSegmentDefinitionRegistry({
    prisma,
    outbox,
    context,
    idGenerator: ids,
    tenantId,
  });
  const unitOfWork = new PrismaUnitOfWork(prisma);
  return { prisma, store, history, definitions, unitOfWork };
}

describe.runIf(Boolean(databaseUrl))("Prisma Segmentation stores (integration)", () => {
  runSegmentStoreContractTests("prisma", () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    return wire(tenantId).store;
  });

  runSegmentDefinitionRegistryContractTests("prisma", () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    return wire(tenantId).definitions;
  });

  it("appends a history entry inside a transaction and rehydrates it via listFor/latestFor", async () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    const { history, unitOfWork } = wire(tenantId);
    const identifier = { type: "customer_id" as const, value: `cust-${crypto.randomUUID()}` };
    const segmentId = "high_value";

    const membership = applyMembershipUpdate(null, identifier.type, identifier.value, segmentId, {
      isMember: true,
      definitionId: segmentId,
      definitionVersion: 1,
      matchedRuleIds: ["rule-1"],
      inputs: new Map([["profile.lifetime_value", 5000]]),
      evaluatedAt: clock.now().toISOString(),
    }).membership!;
    const snapshot = toSnapshot(membership, "entered", clock.now().toISOString());
    const event = new CustomerEnteredSegment(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from(identifier.value),
        occurredAt: clock.now(),
      },
      {
        identifierType: identifier.type,
        identifierValue: identifier.value,
        segmentId,
        definitionId: segmentId,
        definitionVersion: 1,
        version: 1,
      },
    );

    await unitOfWork.run(async (tx) => {
      await history.append(snapshot, event, tx);
    });

    const listed = await history.listFor(identifier, segmentId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("entered");

    const latest = await history.latestFor(identifier, segmentId);
    expect(latest?.reason).toBe("entered");
  });

  it("history append rejects a call without a transaction client (ADR-0003)", async () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    const { history } = wire(tenantId);
    const identifier = { type: "customer_id" as const, value: `cust-${crypto.randomUUID()}` };
    const segmentId = "high_value";
    const membership = applyMembershipUpdate(null, identifier.type, identifier.value, segmentId, {
      isMember: true,
      definitionId: segmentId,
      definitionVersion: 1,
      matchedRuleIds: [],
      inputs: new Map(),
      evaluatedAt: clock.now().toISOString(),
    }).membership!;
    const snapshot = toSnapshot(membership, "entered", clock.now().toISOString());

    await expect(history.append(snapshot, undefined)).rejects.toThrow(/transaction client/);
  });

  it("registry save with an event rejects a call without a transaction client, but succeeds without one when no event is given", async () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    const { definitions } = wire(tenantId);
    const ruleSet: RuleSet<boolean> = {
      id: "high_value",
      version: 1,
      mode: "first_match",
      rules: [{ id: "r1", priority: 1, when: Expr.where("profile.ltv", "gte", 1000), then: true }],
      fallback: false,
    };
    const definition = {
      id: "high_value",
      name: "High value",
      version: 1,
      ruleSet,
      createdAt: T0,
      updatedAt: T0,
    };
    const event = new SegmentCreated(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from("high_value"),
        occurredAt: clock.now(),
      },
      { segmentId: "high_value", name: "High value", version: 1 },
    );

    await expect(
      definitions.save(definition, INITIAL_SEGMENT_DEFINITION_VERSION, event, undefined),
    ).rejects.toThrow(/transaction client/);

    await definitions.save(definition, INITIAL_SEGMENT_DEFINITION_VERSION, undefined, undefined);
    expect(await definitions.getById("high_value")).not.toBeNull();
  });

  it("stores and lists a segment definition's rule set losslessly", async () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    const { definitions } = wire(tenantId);

    const ruleSet: RuleSet<boolean> = {
      id: "high_value",
      version: 1,
      mode: "first_match",
      rules: [
        {
          id: "vip-rule",
          priority: 1,
          when: Expr.where("profile.lifetime_value", "gte", 1000),
          then: true,
        },
      ],
      fallback: false,
    };

    await definitions.save(
      {
        id: "high_value",
        name: "High value",
        version: 1,
        ruleSet,
        createdAt: T0,
        updatedAt: T0,
      },
      INITIAL_SEGMENT_DEFINITION_VERSION,
    );

    const all = await definitions.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.ruleSet).toEqual(ruleSet);

    const byId = await definitions.getById("high_value");
    expect(byId?.name).toBe("High value");
  });
});
