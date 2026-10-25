import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { ConcurrencyError, ConflictError } from "@platform/utils";
import { DraftOrder, type DraftOrderContent } from "../domain/draft-order";
import type { DraftOrderRepository } from "../domain/draft-order-repository";
import { InMemoryDraftOrderRepository } from "./in-memory-draft-order-repository";
import { PrismaDraftOrderRepository } from "./prisma-draft-order-repository";

const T = "tenant-a";
const ID = "33333333-3333-7333-8333-333333333333";
const NOW = new Date("2026-10-25T10:00:00.000Z");
const ADDRESS = {
  name: "Sara",
  phone: null,
  line1: "1 St",
  line2: null,
  city: "Cairo",
  province: "EG-C",
  postalCode: "",
  country: "EG",
};
const CONTENT: DraftOrderContent = {
  customerRef: null,
  contactEmail: "sara@example.com",
  contactPhone: null,
  shippingAddress: ADDRESS,
  billingAddress: null,
  lines: [
    {
      productRef: "p-1",
      variantRef: "v-1",
      sku: "S",
      title: "Tee",
      variantTitle: null,
      quantity: 1,
      unitPriceMinor: 1000,
    },
  ],
  discount: null,
  shipping: { kind: "free", title: "Free shipping", amountMinor: 0 },
  note: "hello",
  tags: ["vip"],
};

function draft(id = ID, number = "D1", content: DraftOrderContent = CONTENT): DraftOrder {
  const created = DraftOrder.create({
    id,
    draftNumber: number,
    currency: "EGP",
    createdBy: "staff",
    now: NOW,
    content,
  });
  if (!created.ok) throw created.error;
  return created.value;
}

type Layer = () => { readonly repo: DraftOrderRepository; readonly tx: unknown };
const layers: readonly [string, Layer][] = [
  ["in-memory", () => ({ repo: new InMemoryDraftOrderRepository(), tx: {} })],
  [
    "prisma over fake-prisma",
    () => {
      const fake = createFakePrisma();
      return { repo: new PrismaDraftOrderRepository({ prisma: fake.database }), tx: fake.database };
    },
  ],
];

describe.each(layers)("DraftOrderRepository (%s)", (_name, make) => {
  it("inserts and reads back the content, JSON columns included", async () => {
    const { repo, tx } = make();
    await repo.save(draft(), T, tx);
    const found = await repo.findById(ID, T);
    expect(found?.content()).toEqual(CONTENT);
    expect(found?.isNew).toBe(false);
    expect(found?.version).toBe(0);
  });

  it("a content save bumps the version; a stale one throws VERSION_CONFLICT", async () => {
    const { repo, tx } = make();
    await repo.save(draft(), T, tx);
    const a = await repo.findById(ID, T);
    const b = await repo.findById(ID, T);
    a?.revise({ ...CONTENT, note: "a" }, NOW);
    await repo.save(a as DraftOrder, T, tx);
    b?.revise({ ...CONTENT, note: "b" }, NOW);
    await expect(repo.save(b as DraftOrder, T, tx)).rejects.toBeInstanceOf(ConcurrencyError);
    const stored = await repo.findById(ID, T);
    expect(stored?.note).toBe("a");
    expect(stored?.version).toBe(1);
  });

  it("a stale content save never re-opens a completed draft (Ruling 2)", async () => {
    const { repo, tx } = make();
    await repo.save(draft(), T, tx);
    const stale = await repo.findById(ID, T);
    expect(await repo.markCompleted(ID, { orderRef: "o-1", at: NOW }, T, tx)).toBe(true);
    // The stale instance still believes it is open, so `revise` succeeds in memory …
    stale?.revise({ ...CONTENT, note: "late" }, NOW);
    // … but the guarded update refuses it.
    await expect(repo.save(stale as DraftOrder, T, tx)).rejects.toBeInstanceOf(ConcurrencyError);
    const done = await repo.findById(ID, T);
    expect(done?.status).toBe("completed");
    expect(done?.orderRef).toBe("o-1");
    expect(done?.note).toBe("hello");
  });

  it("guarded status writes leave the version alone and refuse the wrong state", async () => {
    const { repo, tx } = make();
    await repo.save(draft(), T, tx);
    expect(await repo.markInvoiceSent(ID, NOW, T, tx)).toBe(true);
    expect(await repo.markInvoiceSent(ID, NOW, T, tx)).toBe(true);
    expect((await repo.findById(ID, T))?.version).toBe(0);
    expect(await repo.markCompleted(ID, { orderRef: "o-1", at: NOW }, T, tx)).toBe(true);
    expect((await repo.findById(ID, T))?.version).toBe(0);
    expect(await repo.markCompleted(ID, { orderRef: "o-2", at: NOW }, T, tx)).toBe(false);
    expect(await repo.softDelete(ID, NOW, T, tx)).toBe(false);
    expect(await repo.markInvoiceSent(ID, NOW, T, tx)).toBe(false);
    expect((await repo.findById(ID, T))?.orderRef).toBe("o-1");
  });

  it("soft delete keeps the row; a deleted draft whose checkout became an order completes (Ruling 17)", async () => {
    const { repo, tx } = make();
    await repo.save(draft(), T, tx);
    expect(await repo.softDelete(ID, NOW, T, tx)).toBe(true);
    expect(await repo.softDelete(ID, NOW, T, tx)).toBe(false);
    expect((await repo.findById(ID, T))?.deletedAt).toEqual(NOW);
    expect((await repo.findById(ID, T))?.version).toBe(0);
    expect(await repo.markCompleted(ID, { orderRef: "o-1", at: NOW }, T, tx)).toBe(true);
    expect((await repo.findById(ID, T))?.deletedAt).toBeNull();
    expect((await repo.findById(ID, T))?.version).toBe(0);
  });

  it("an inserted draft is no longer new, so saving it again updates instead of re-inserting", async () => {
    const { repo, tx } = make();
    const created = draft();
    expect(created.isNew).toBe(true);
    await repo.save(created, T, tx);
    expect(created.isNew).toBe(false);
    created.revise({ ...CONTENT, note: "second" }, NOW);
    await repo.save(created, T, tx);
    const stored = await repo.findById(ID, T);
    expect(stored?.note).toBe("second");
    expect(stored?.version).toBe(1);
  });

  it("setCheckout is compare-and-set on checkout_ref and keeps the version (Ruling 3)", async () => {
    const { repo, tx } = make();
    await repo.save(draft(), T, tx);
    const next = (ref: string) => ({ checkoutRef: ref, checkoutVersion: 0 });
    expect(await repo.setCheckout(ID, next("s-1"), null, T, tx)).toBe(true);
    expect(await repo.setCheckout(ID, next("s-2"), null, T, tx)).toBe(false);
    expect(await repo.setCheckout(ID, next("s-2"), "s-1", T, tx)).toBe(true);
    const found = await repo.findById(ID, T);
    expect(found?.checkoutRef).toBe("s-2");
    expect(found?.checkoutVersion).toBe(0);
    expect(found?.version).toBe(0);
  });
});

describe("duplicate inserts (the table's primary key and per-shop number key)", () => {
  it("in memory: a repeated id or a repeated number in a shop is a ConflictError", async () => {
    const repo = new InMemoryDraftOrderRepository();
    await repo.save(draft(ID, "D1"), T);
    const otherId = "33333333-3333-7333-8333-333333333334";
    await expect(repo.save(draft(ID, "D2"), T)).rejects.toBeInstanceOf(ConflictError);
    await expect(repo.save(draft(ID, "D2"), "tenant-b")).rejects.toBeInstanceOf(ConflictError);
    await expect(repo.save(draft(otherId, "D1"), T)).rejects.toBeInstanceOf(ConflictError);
    // The same number in ANOTHER shop is fine.
    await repo.save(draft(otherId, "D1"), "tenant-b");
    expect((await repo.findById(ID, T))?.draftNumber).toBe("D1");
  });

  it("prisma: a unique violation (P2002) surfaces as the same ConflictError; others pass through", async () => {
    const failing = (error: unknown) =>
      ({ draftOrder: { create: () => Promise.reject(error) } }) as unknown;
    const repo = new PrismaDraftOrderRepository({ prisma: createFakePrisma().database });
    const unique = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const created = draft();
    await expect(repo.save(created, T, failing(unique))).rejects.toBeInstanceOf(ConflictError);
    expect(created.isNew).toBe(true);
    const other = new Error("connection reset");
    await expect(repo.save(draft(), T, failing(other))).rejects.toBe(other);
  });
});

describe("PrismaDraftOrderRepository ids", () => {
  it("a non-UUID id is unknown, never a query error", async () => {
    const repo = new PrismaDraftOrderRepository({ prisma: createFakePrisma().database });
    expect(await repo.findById("abc", T)).toBeNull();
    expect(await repo.markInvoiceSent("abc", NOW, T, {})).toBe(false);
  });
});

describe("InMemoryDraftOrderRepository.list", () => {
  const idOf = (n: number) => `33333333-3333-7333-8333-00000000000${n}`;
  async function seeded(): Promise<InMemoryDraftOrderRepository> {
    const repo = new InMemoryDraftOrderRepository();
    const people = [
      [1, "sara@example.com", "Sara"],
      [2, "omar@example.com", "Omar"],
      [3, null, "Mona Ali"],
    ] as const;
    for (const [n, email, name] of people) {
      const content = { ...CONTENT, contactEmail: email, shippingAddress: { ...ADDRESS, name } };
      await repo.save(draft(idOf(n), `D${n}`, content), T);
    }
    return repo;
  }

  it("is newest first, pages by id, filters by status and hides deleted drafts", async () => {
    const repo = await seeded();
    const first = await repo.list({ first: 2 }, T);
    expect(first.items.map((d) => d.draftNumber)).toEqual(["D3", "D2"]);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const second = await repo.list({ first: 2, after: first.pageInfo.endCursor ?? "" }, T);
    expect(second.items.map((d) => d.draftNumber)).toEqual(["D1"]);
    await repo.markInvoiceSent(idOf(2), NOW, T);
    const sent = await repo.list({ status: "invoice_sent" }, T);
    expect(sent.items.map((d) => d.draftNumber)).toEqual(["D2"]);
    await repo.softDelete(idOf(1), NOW, T);
    expect((await repo.list({}, T)).items.map((d) => d.draftNumber)).toEqual(["D3", "D2"]);
  });

  it("searches the number, the email and the recipient, case-insensitively, in one shop", async () => {
    const repo = await seeded();
    const numbers = async (search: string) =>
      (await repo.list({ search }, T)).items.map((d) => d.draftNumber);
    expect(await numbers("d2")).toEqual(["D2"]);
    expect(await numbers("SARA@")).toEqual(["D1"]);
    expect(await numbers("mona")).toEqual(["D3"]);
    expect((await repo.list({}, "tenant-b")).items).toEqual([]);
  });
});
