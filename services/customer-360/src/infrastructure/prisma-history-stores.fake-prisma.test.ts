import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { Expr } from "@platform/expression";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import type { RuleSet } from "@platform/rules";
import { toSnapshot as toAttributeSnapshot } from "../domain/attribute-snapshot";
import type { AttributeValue } from "../domain/attribute-value";
import { applyAttributeUpdate, createEmptyComputedAttribute } from "../domain/computed-attribute";
import { toSnapshot as toSegmentSnapshot } from "../domain/segment-history";
import { applyMembershipUpdate } from "../domain/segment-membership";
import { AttributeCreated } from "../events/attribute-created.event";
import { CustomerEnteredSegment } from "../events/customer-entered-segment.event";
import { createCustomerFakePrisma } from "../test-support/fake-prisma";
import { IdentityEventTranslator } from "./identity-event-translator";
import {
  PrismaAttributeDefinitionRegistry,
  toDefinitionRow,
} from "./prisma-attribute-definition-registry";
import { PrismaAttributeHistoryStore } from "./prisma-attribute-history-store";
import { PrismaSegmentHistoryStore } from "./prisma-segment-history-store";

/**
 * The history adapters and the attribute-definition registry over `createCustomerFakePrisma` —
 * the same behaviours `prisma-attribute-stores.integration.test.ts` and
 * `prisma-segment-stores.integration.test.ts` check against Postgres, plus what only an inspectable
 * fake shows: the outbox row lands through the same transaction client as the history row.
 */
const T0 = "2026-07-20T23:59:59.000Z";
const T1 = "2026-07-21T00:00:01.000Z";
const T2 = "2026-07-21T00:00:02.000Z";
const clock: Clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
const ids: IdGenerator = { generate: () => crypto.randomUUID() };
const identifier = { type: "customer_id" as const, value: "cust-1" };

function wire() {
  const fake = createCustomerFakePrisma();
  const prisma = fake.database;
  const outbox = new OutboxWriter({
    store: new PrismaOutboxStore(prisma),
    translator: new IdentityEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "customer360",
  });
  const deps = { prisma, outbox, context: rootEventContext(ids), idGenerator: ids };
  return {
    fake,
    unitOfWork: new PrismaUnitOfWork(prisma),
    segments: new PrismaSegmentHistoryStore(deps),
    attributes: new PrismaAttributeHistoryStore(deps),
    definitions: new PrismaAttributeDefinitionRegistry({ prisma }),
  };
}

function segmentEntry(evaluatedAt: string, reason: "entered" | "refreshed") {
  const membership = applyMembershipUpdate(null, identifier.type, identifier.value, "high_value", {
    isMember: true,
    definitionId: "high_value",
    definitionVersion: 1,
    matchedRuleIds: ["rule-1"],
    inputs: new Map([["profile.lifetime_value", 5000]]),
    evaluatedAt,
  }).membership!;
  return toSegmentSnapshot(membership, reason, evaluatedAt);
}

function enteredEvent() {
  return new CustomerEnteredSegment(
    {
      eventId: ids.generate(),
      aggregateId: UniqueEntityId.from(identifier.value),
      occurredAt: clock.now(),
    },
    {
      identifierType: identifier.type,
      identifierValue: identifier.value,
      segmentId: "high_value",
      definitionId: "high_value",
      definitionVersion: 1,
      version: 1,
    },
  );
}

function attributeEntry(capturedAt: string, reason: "created" | "updated") {
  const attribute = applyAttributeUpdate(
    createEmptyComputedAttribute(identifier.type, identifier.value, T0),
    "is_vip",
    {
      value: reason === "created",
      definitionId: "is_vip",
      definitionVersion: 1,
      matchedRuleIds: ["rule-1"],
      inputs: new Map([["profile.lifetime_value", 5000]]),
      evaluatedAt: capturedAt,
    },
  ).attribute;
  return toAttributeSnapshot(attribute, reason, capturedAt);
}

function attributeCreatedEvent() {
  return new AttributeCreated(
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
}

describe("PrismaSegmentHistoryStore over a fake client", () => {
  it("appends inside the unit of work, writing the outbox row in the same transaction", async () => {
    const { fake, unitOfWork, segments } = wire();

    await unitOfWork.run((tx) =>
      segments.append(segmentEntry(T1, "entered"), "t-a", enteredEvent(), tx),
    );

    const [stored] = fake.rowsOf("segmentHistory");
    expect(stored).toMatchObject({ tenantId: "t-a", segmentId: "high_value", reason: "entered" });
    expect(stored?.["capturedAt"]).toEqual(new Date(T1));
    expect(fake.rowsOf("outboxEntry")).toHaveLength(1);
  });

  it("appends without an outbox row when no event is given (a rebuild has nothing to publish)", async () => {
    const { fake, unitOfWork, segments } = wire();

    await unitOfWork.run((tx) =>
      segments.append(segmentEntry(T1, "entered"), "t-a", undefined, tx),
    );

    expect(fake.rowsOf("segmentHistory")).toHaveLength(1);
    expect(fake.rowsOf("outboxEntry")).toHaveLength(0);
  });

  it("lists oldest first, returns the newest as latest, and round-trips the evaluation inputs", async () => {
    const { unitOfWork, segments } = wire();
    await unitOfWork.run(async (tx) => {
      await segments.append(segmentEntry(T2, "refreshed"), "t-a", undefined, tx);
      await segments.append(segmentEntry(T1, "entered"), "t-a", undefined, tx);
    });

    const listed = await segments.listFor(identifier, "high_value", "t-a");
    expect(listed.map((entry) => entry.reason)).toEqual(["entered", "refreshed"]);
    expect(listed[0]?.inputs.get("profile.lifetime_value")).toBe(5000);
    expect(listed[0]?.matchedRuleIds).toEqual(["rule-1"]);
    expect((await segments.latestFor(identifier, "high_value", "t-a"))?.capturedAt).toBe(T2);
  });

  it("never shows one tenant's history to another (ADR-0014)", async () => {
    const { unitOfWork, segments } = wire();
    await unitOfWork.run((tx) =>
      segments.append(segmentEntry(T1, "entered"), "t-a", undefined, tx),
    );

    expect(await segments.listFor(identifier, "high_value", "t-b")).toEqual([]);
    expect(await segments.latestFor(identifier, "high_value", "t-b")).toBeNull();
  });

  it("rejects an append outside a transaction (ADR-0003)", async () => {
    const { fake, segments } = wire();

    await expect(segments.append(segmentEntry(T1, "entered"), "t-a")).rejects.toThrow(
      /transaction client/,
    );
    expect(fake.rowsOf("segmentHistory")).toHaveLength(0);
  });
});

describe("PrismaAttributeHistoryStore over a fake client", () => {
  it("appends inside the unit of work, writing the outbox row in the same transaction", async () => {
    const { fake, unitOfWork, attributes } = wire();

    await unitOfWork.run((tx) =>
      attributes.append(attributeEntry(T1, "created"), "t-a", attributeCreatedEvent(), tx),
    );

    expect(fake.rowsOf("computedAttributeSnapshot")).toHaveLength(1);
    expect(fake.rowsOf("outboxEntry")).toHaveLength(1);
  });

  it("lists oldest first and returns the newest as latest, with the attribute values intact", async () => {
    const { unitOfWork, attributes } = wire();
    await unitOfWork.run(async (tx) => {
      await attributes.append(attributeEntry(T2, "updated"), "t-a", undefined, tx);
      await attributes.append(attributeEntry(T1, "created"), "t-a", undefined, tx);
    });

    const listed = await attributes.listFor(identifier, "t-a");
    expect(listed.map((entry) => entry.reason)).toEqual(["created", "updated"]);
    expect(listed[0]?.attributes.get("is_vip")?.value).toBe(true);
    expect(listed[1]?.attributes.get("is_vip")?.value).toBe(false);

    const latest = await attributes.latestFor(identifier, "t-a");
    expect(latest?.reason).toBe("updated");
    expect(await attributes.latestFor(identifier, "t-b")).toBeNull();
    expect(await attributes.listFor(identifier, "t-b")).toEqual([]);
  });

  it("rejects an append outside a transaction (ADR-0003)", async () => {
    const { attributes } = wire();

    await expect(
      attributes.append(attributeEntry(T1, "created"), "t-a", attributeCreatedEvent()),
    ).rejects.toThrow(/transaction client/);
  });
});

describe("PrismaAttributeDefinitionRegistry over a fake client", () => {
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

  it("reads a stored definition's rule set and dependencies back losslessly, per tenant", async () => {
    const { fake, definitions } = wire();
    await fake.database.computedAttributeDefinition.create({
      data: toDefinitionRow(
        { id: "is_vip", version: 1, ruleSet, dependencies: ["lifetime_value"] },
        "t-a",
        ids.generate(),
      ),
    });

    const all = await definitions.list("t-a");
    expect(all).toHaveLength(1);
    expect(all[0]?.ruleSet).toEqual(ruleSet);
    expect((await definitions.getById("is_vip", "t-a"))?.dependencies).toEqual(["lifetime_value"]);

    expect(await definitions.list("t-b")).toEqual([]);
    expect(await definitions.getById("is_vip", "t-b")).toBeNull();
  });
});
