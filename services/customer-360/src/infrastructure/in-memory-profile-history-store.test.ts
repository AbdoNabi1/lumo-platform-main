import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { applyFieldUpdate, createEmptyProfile } from "../domain/customer-profile";
import { toSnapshot } from "../domain/profile-snapshot";
import { ProfileCreated } from "../events/profile-created.event";
import { IdentityEventTranslator } from "./identity-event-translator";
import { InMemoryProfileHistoryStore } from "./in-memory-profile-history-store";
import { TENANT_A, TENANT_B } from "../test-support/tenants";

const identifier = { type: "customer_id" as const, value: "cust-1" };
const clock: Clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
const idGenerator: IdGenerator = { generate: () => `id-${Math.random()}` };

function wire() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new IdentityEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "customer360",
  });
  const context = rootEventContext(idGenerator);
  const store = new InMemoryProfileHistoryStore({ outbox, context });
  return { store, outboxStore };
}

describe("InMemoryProfileHistoryStore", () => {
  it("append writes the snapshot to history and the event to the outbox", async () => {
    const { store, outboxStore } = wire();
    const profile = applyFieldUpdate(
      createEmptyProfile(identifier.type, identifier.value, "t0"),
      "email",
      {
        value: "a@example.com",
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:01.000Z",
      },
    ).profile;
    const snapshot = toSnapshot(profile, "created", "2026-07-21T00:00:02.000Z");
    const event = new ProfileCreated(
      {
        eventId: idGenerator.generate(),
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

    await store.append(snapshot, event, TENANT_A);

    const listed = await store.listFor(identifier, TENANT_A);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.reason).toBe("created");

    const pending = await outboxStore.fetchPending(10);
    expect(pending.length).toBeGreaterThan(0);
  });

  it("listFor returns entries oldest-first and latestFor returns only the newest", async () => {
    const { store } = wire();
    const profile1 = applyFieldUpdate(
      createEmptyProfile(identifier.type, identifier.value, "t0"),
      "email",
      {
        value: "a@example.com",
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:01.000Z",
      },
    ).profile;
    const profile2 = applyFieldUpdate(profile1, "phone", {
      value: "555-0100",
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:02.000Z",
    }).profile;

    const snap1 = toSnapshot(profile1, "created", "2026-07-21T00:00:01.500Z");
    const snap2 = toSnapshot(profile2, "updated", "2026-07-21T00:00:02.500Z");
    const event = new ProfileCreated(
      {
        eventId: idGenerator.generate(),
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

    await store.append(snap1, event, TENANT_A);
    await store.append(snap2, event, TENANT_A);

    const listed = await store.listFor(identifier, TENANT_A);
    expect(listed.map((s) => s.reason)).toEqual(["created", "updated"]);

    const latest = await store.latestFor(identifier, TENANT_A);
    expect(latest?.reason).toBe("updated");
    expect(latest?.fields.size).toBe(2);
  });

  it("latestFor returns null for an identifier with no history", async () => {
    const { store } = wire();
    expect(await store.latestFor({ type: "customer_id", value: "unknown" }, TENANT_A)).toBeNull();
  });

  it("isolates tenants — a snapshot appended under one tenant is invisible to another (ADR-0014)", async () => {
    const { store } = wire();
    const profile = applyFieldUpdate(
      createEmptyProfile(identifier.type, identifier.value, "t0"),
      "email",
      {
        value: "a@example.com",
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:01.000Z",
      },
    ).profile;
    const event = new ProfileCreated(
      {
        eventId: idGenerator.generate(),
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
    await store.append(toSnapshot(profile, "created", "2026-07-21T00:00:02.000Z"), event, TENANT_A);

    expect(await store.listFor(identifier, TENANT_B)).toEqual([]);
    expect(await store.latestFor(identifier, TENANT_B)).toBeNull();
    expect(await store.listFor(identifier, TENANT_A)).toHaveLength(1);
  });
});
