import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { CheckoutLink, INVOICE_LINK_TTL_MS } from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";
import { InMemoryCheckoutLinkRepository } from "./in-memory-checkout-link-repository";
import { PrismaCheckoutLinkRepository } from "./prisma-checkout-link-repository";

const T = "tenant-a";
const NOW = new Date("2026-10-25T10:00:00.000Z");
const LATER = new Date(NOW.getTime() + 60_000);
let n = 0;
const nextId = () => `01920000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`;

function invoice(draftOrderRef: string, now = NOW): CheckoutLink {
  return CheckoutLink.issue({
    id: nextId(),
    purpose: "invoice",
    target: { draftOrderRef },
    createdBy: "staff",
    now,
    ttlMs: INVOICE_LINK_TTL_MS,
  }).link;
}

const layers: readonly [string, () => { repo: CheckoutLinkRepository; tx: unknown }][] = [
  ["in-memory", () => ({ repo: new InMemoryCheckoutLinkRepository(), tx: {} })],
  [
    "prisma over fake-prisma",
    () => {
      const fake = createFakePrisma();
      return {
        repo: new PrismaCheckoutLinkRepository({ prisma: fake.database }),
        tx: fake.database,
      };
    },
  ],
];

describe.each(layers)("invoice links (%s)", (_name, make) => {
  it("invoice links last 30 days", () => {
    expect(INVOICE_LINK_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(invoice("d-1").expiresAt.getTime() - NOW.getTime()).toBe(INVOICE_LINK_TTL_MS);
  });

  it("revokeForDraft revokes only that draft's live invoice links, writing only revokedAt", async () => {
    const { repo, tx } = make();
    const a = invoice("d-1");
    const b = invoice("d-1");
    const other = invoice("d-2");
    for (const link of [a, b, other]) await repo.save(link, T, tx);
    expect(await repo.recordClaim(a.id, T, NOW, "s-1", tx)).toBe(1);
    expect(await repo.revokeForDraft("d-1", T, LATER, tx)).toBe(2);
    expect(await repo.revokeForDraft("d-1", T, new Date(LATER.getTime() + 1), tx)).toBe(0);
    const revokedA = await repo.findById(a.id, T);
    expect(revokedA?.revokedAt).toEqual(LATER);
    // The claim fields written by recordClaim are untouched (binding carry 1).
    expect(revokedA?.claimCount).toBe(1);
    expect(revokedA?.resultCheckoutRef).toBe("s-1");
    expect((await repo.findById(other.id, T))?.revokedAt).toBeNull();
    expect(await repo.revokeForDraft("d-1", "tenant-b", LATER, tx)).toBe(0);
  });

  it("save of a loaded link never re-writes the claim fields and never moves a first revocation", async () => {
    const { repo, tx } = make();
    const link = invoice("d-1");
    await repo.save(link, T, tx);
    const stale = await repo.findById(link.id, T);
    await repo.recordClaim(link.id, T, NOW, "s-1", tx);
    stale?.revoke(LATER);
    await repo.save(stale as CheckoutLink, T, tx);
    const again = await repo.findById(link.id, T);
    again?.revoke(new Date(LATER.getTime() + 5));
    // `revoke` keeps the first timestamp in the aggregate; the guarded update would refuse anyway.
    await repo.save(again as CheckoutLink, T, tx);
    const stored = await repo.findById(link.id, T);
    expect(stored?.claimCount).toBe(1);
    expect(stored?.resultCheckoutRef).toBe("s-1");
    expect(stored?.revokedAt).toEqual(LATER);
  });

  it("listForDraft answers the draft's invoice links, newest first, in this shop only", async () => {
    const { repo, tx } = make();
    const older = invoice("d-1", NOW);
    const newer = invoice("d-1", LATER);
    await repo.save(older, T, tx);
    await repo.save(newer, T, tx);
    await repo.save(invoice("d-2"), T, tx);
    expect((await repo.listForDraft("d-1", T)).map((l) => l.id)).toEqual([newer.id, older.id]);
    expect(await repo.listForDraft("d-1", "tenant-b")).toEqual([]);
  });
});
