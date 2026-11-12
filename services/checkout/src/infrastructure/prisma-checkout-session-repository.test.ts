import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CheckoutSession } from "../domain/checkout-session";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { CheckoutEventTranslator } from "./checkout-event-translator";
import { CheckoutSessionMapper } from "./checkout-session.mapper";
import { escapeLike, PrismaCheckoutSessionRepository } from "./prisma-checkout-session-repository";

const ID = "01920000-0000-7000-8000-000000000001";
const CREATED = new Date("2026-10-18T09:00:00.000Z");
const UPDATED = new Date("2026-10-18T10:00:00.000Z");

async function setup() {
  const fake = createFakePrisma();
  const repository = new PrismaCheckoutSessionRepository({
    prisma: fake.database,
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CheckoutEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "checkout",
    }) as never,
    context: rootEventContext({ generate: () => "evt-x" }),
  });
  const session = CheckoutSession.start(
    UniqueEntityId.from(ID),
    "cart-1",
    undefined,
    "ref-1",
    "EGP",
    {
      recoveredFromRef: "01920000-0000-7000-8000-0000000000ff",
    },
  );
  // fake-prisma has no column defaults: seed the timestamps explicitly.
  await fake.database.checkoutSession.create({
    data: {
      ...CheckoutSessionMapper.toRow(session, "tenant-a"),
      createdAt: CREATED,
      updatedAt: UPDATED,
    } as never,
  });
  return { fake, repository };
}

describe("PrismaCheckoutSessionRepository — Part 3 reads (over fake-prisma)", () => {
  it("findRecord answers the session with its row's timestamps and recovery mark", async () => {
    const { repository } = await setup();
    const record = await repository.findRecord(ID, "tenant-a");
    expect(record?.createdAt).toEqual(CREATED);
    expect(record?.updatedAt).toEqual(UPDATED);
    expect(record?.session.recoveredFromRef).toBe("01920000-0000-7000-8000-0000000000ff");
    expect(await repository.findRecord(ID, "tenant-b")).toBeNull();
  });

  it("a non-UUID id or cursor answers nothing without querying (UUID column; Review Focus 5)", async () => {
    const { repository } = await setup();
    expect(await repository.findRecord("abc", "tenant-a")).toBeNull();
    // fake-prisma has no $queryRaw: reaching the query would throw here.
    expect(
      await repository.listAbandoned({ olderThan: new Date(), after: "xyz" }, "tenant-a"),
    ).toEqual({ items: [], pageInfo: { hasNextPage: false, endCursor: null } });
  });
});

describe("escapeLike", () => {
  it("escapes %, _ and backslash so a typed search matches literally", () => {
    expect(escapeLike("100%_\\x")).toBe("100\\%\\_\\\\x");
    expect(escapeLike("mona")).toBe("mona");
  });
});

describe("PrismaCheckoutSessionRepository — draft terms and ownership (over fake-prisma)", () => {
  it("saves a draft session, then persists the new owner and the terms on update", async () => {
    const { fake, repository } = await setup();
    const draftId = "01920000-0000-7000-8000-0000000000d1";
    const draft = CheckoutSession.start(
      UniqueEntityId.from(draftId),
      "draft:d-1",
      undefined,
      "server-minted-ref",
      "EGP",
    );
    const line = CheckoutItem.create("p-1", 1, 1000, "EGP");
    if (!line.ok) throw new Error("invalid fixture");
    draft.loadItems([line.value]);
    draft.applyDraftTerms({
      draftOrderRef: "d-1",
      draftNumber: "D1",
      shipping: { title: "Courier", amountMinor: 500 },
    });
    await repository.save(draft, "tenant-a", fake.database);

    const loaded = await repository.findById(draftId, "tenant-a", fake.database);
    expect(loaded?.draftTerms?.draftNumber).toBe("D1");
    if (loaded === null) throw new Error("expected the saved draft session");
    loaded.transferOwnership("guest-2");
    await repository.save(loaded, "tenant-a", fake.database);

    const stored = fake.rowsOf("checkoutSession").find((row) => row.id === draftId);
    expect(stored?.sessionRef).toBe("guest-2");
    expect((stored?.draftTerms as { draftNumber: string }).draftNumber).toBe("D1");
  });
});
