import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { Expr } from "@platform/expression";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import type { RuleSet } from "@platform/rules";
import { applyAttributeUpdate, createEmptyComputedAttribute } from "../domain/computed-attribute";
import { toSnapshot } from "../domain/attribute-snapshot";
import type { AttributeValue } from "../domain/attribute-value";
import { AttributeCreated } from "../events/attribute-created.event";
import { IdentityEventTranslator } from "./identity-event-translator";
import { PrismaAttributeHistoryStore } from "./prisma-attribute-history-store";
import { PrismaAttributeStore } from "./prisma-attribute-store";
import {
  PrismaAttributeDefinitionRegistry,
  toDefinitionRow,
} from "./prisma-attribute-definition-registry";
import { runAttributeStoreContractTests } from "./attribute-store.contract";

/**
 * Integration suite for the Phase 6.4 Computed Attributes Prisma adapters. Same honest gating as
 * `prisma-profile-stores.integration.test.ts`/`prisma-session-stores.integration.test.ts` (same
 * package, same convention): skipped, never faked, without `DATABASE_URL_TEST`.
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
  const store = new PrismaAttributeStore({ prisma, idGenerator: ids, tenantId });
  const history = new PrismaAttributeHistoryStore({
    prisma,
    outbox,
    context,
    idGenerator: ids,
    tenantId,
  });
  const definitions = new PrismaAttributeDefinitionRegistry({ prisma, tenantId });
  const unitOfWork = new PrismaUnitOfWork(prisma);
  return { prisma, store, history, definitions, unitOfWork };
}

describe.runIf(Boolean(databaseUrl))("Prisma Computed Attributes stores (integration)", () => {
  runAttributeStoreContractTests("prisma", () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    return wire(tenantId).store;
  });

  it("appends a snapshot inside a transaction and rehydrates it via listFor/latestFor", async () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    const { history, unitOfWork } = wire(tenantId);
    const identifier = { type: "customer_id" as const, value: `cust-${crypto.randomUUID()}` };

    const attribute = applyAttributeUpdate(
      createEmptyComputedAttribute(identifier.type, identifier.value, T0),
      "is_vip",
      {
        value: true,
        definitionId: "is_vip",
        definitionVersion: 1,
        matchedRuleIds: ["rule-1"],
        inputs: new Map([["profile.lifetime_value", 5000]]),
        evaluatedAt: clock.now().toISOString(),
      },
    ).attribute;
    const snapshot = toSnapshot(attribute, "created", clock.now().toISOString());
    const event = new AttributeCreated(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from(identifier.value),
        occurredAt: clock.now(),
      },
      {
        identifierType: identifier.type,
        identifierValue: identifier.value,
        attribute: "is_vip",
        definitionId: "is_vip",
        definitionVersion: 1,
        version: 1,
      },
    );

    await unitOfWork.run(async (tx) => {
      await history.append(snapshot, event, tx);
    });

    const listed = await history.listFor(identifier);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.attributes.get("is_vip")?.value).toBe(true);

    const latest = await history.latestFor(identifier);
    expect(latest?.reason).toBe("created");
  });

  it("append rejects a call without a transaction client (ADR-0003)", async () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    const { history } = wire(tenantId);
    const identifier = { type: "customer_id" as const, value: `cust-${crypto.randomUUID()}` };
    const snapshot = toSnapshot(
      createEmptyComputedAttribute(identifier.type, identifier.value, T0),
      "created",
      clock.now().toISOString(),
    );
    const event = new AttributeCreated(
      {
        eventId: ids.generate(),
        aggregateId: UniqueEntityId.from(identifier.value),
        occurredAt: clock.now(),
      },
      {
        identifierType: identifier.type,
        identifierValue: identifier.value,
        attribute: "is_vip",
        definitionId: "is_vip",
        definitionVersion: 1,
        version: 1,
      },
    );

    await expect(history.append(snapshot, event)).rejects.toThrow(/transaction client/);
  });

  it("stores and lists a computed attribute definition's rule set/dependencies losslessly", async () => {
    const tenantId = `tenant-itest-${crypto.randomUUID()}`;
    const { prisma, definitions } = wire(tenantId);

    const ruleSet: RuleSet<AttributeValue> = {
      id: "is_vip",
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

    await prisma.computedAttributeDefinition.create({
      data: toDefinitionRow(
        { id: "is_vip", version: 1, ruleSet, dependencies: [] },
        tenantId,
        ids.generate(),
      ),
    });

    const all = await definitions.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.ruleSet).toEqual(ruleSet);

    const byId = await definitions.getById("is_vip");
    expect(byId?.dependencies).toEqual([]);
  });
});
