import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import {
  ABANDONED_FIXTURE_CASES,
  expectedIds,
  FIXTURE_LISTED,
  FIXTURE_OLDER_THAN,
  seedAbandonedFixture,
} from "./abandoned-checkout-fixture";
import { CheckoutEventTranslator } from "./checkout-event-translator";
import { InMemoryCheckoutSessionRepository } from "./in-memory-checkout-session-repository";

async function seeded() {
  let now = new Date(0);
  const repository = new InMemoryCheckoutSessionRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "checkout",
    }),
    context: rootEventContext({ generate: () => "evt-x" }),
    clock: { now: () => now },
  });
  let n = 0;
  const ids = await seedAbandonedFixture(
    {
      save: async (session, tenantId, updatedAt) => {
        now = updatedAt;
        await repository.save(session, tenantId);
      },
    },
    { tenantId: "tenant-a", otherTenantId: "tenant-b" },
    () => `01920000-0000-7000-8000-${(n += 1).toString(16).padStart(12, "0")}`,
  );
  return { repository, ids };
}

describe("InMemoryCheckoutSessionRepository.listAbandoned (shared fixture)", () => {
  for (const c of ABANDONED_FIXTURE_CASES) {
    it(c.name, async () => {
      const { repository, ids } = await seeded();
      const page = await repository.listAbandoned(
        { ...c.query, olderThan: FIXTURE_OLDER_THAN },
        "tenant-a",
      );
      expect(page.items.map((r) => r.session.id.toString())).toEqual(expectedIds(ids, c.expected));
    });
  }

  it("pages by id, newest first", async () => {
    const { repository, ids } = await seeded();
    const all = expectedIds(ids, FIXTURE_LISTED);
    const first = await repository.listAbandoned(
      { olderThan: FIXTURE_OLDER_THAN, first: 2 },
      "tenant-a",
    );
    expect(first.items.map((r) => r.session.id.toString())).toEqual(all.slice(0, 2));
    expect(first.pageInfo).toEqual({ hasNextPage: true, endCursor: all[1] });
    const second = await repository.listAbandoned(
      { olderThan: FIXTURE_OLDER_THAN, first: 2, after: all[1] },
      "tenant-a",
    );
    expect(second.items.map((r) => r.session.id.toString())).toEqual(all.slice(2));
    expect(second.pageInfo.hasNextPage).toBe(false);
  });

  it("records when a session was created and last changed", async () => {
    const { repository, ids } = await seeded();
    const record = await repository.findRecord(ids.emailOnly, "tenant-a");
    expect(record?.createdAt).toEqual(new Date("2026-10-18T10:00:00.000Z"));
    expect(record?.updatedAt).toEqual(new Date("2026-10-18T10:00:00.000Z"));
    expect(await repository.findRecord(ids.emailOnly, "tenant-b")).toBeNull();
  });
});
