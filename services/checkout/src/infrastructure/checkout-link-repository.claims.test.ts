import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import { CheckoutLink, RECOVERY_LINK_TTL_MS } from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";
import { InMemoryCheckoutLinkRepository } from "./in-memory-checkout-link-repository";
import { PrismaCheckoutLinkRepository } from "./prisma-checkout-link-repository";

const TENANT = "tenant-a";
const LINK_ID = "01920000-0000-7000-8000-0000000000a1";
const SESSION = "01920000-0000-7000-8000-000000000001";
const T0 = new Date("2026-10-18T09:00:00.000Z");

/** Both adapters, the Prisma one over the fake that applies every statement literally. */
function layers(): readonly [string, CheckoutLinkRepository, unknown][] {
  const fake = createFakePrisma();
  return [
    [
      "prisma over fake-prisma",
      new PrismaCheckoutLinkRepository({ prisma: fake.database }),
      fake.database,
    ],
    ["in-memory", new InMemoryCheckoutLinkRepository(), undefined],
  ];
}

async function seeded(links: CheckoutLinkRepository, tx: unknown): Promise<CheckoutLink> {
  const { link } = CheckoutLink.issue({
    id: LINK_ID,
    purpose: "recovery",
    target: { checkoutSessionId: SESSION },
    createdBy: "staff-op",
    now: T0,
    ttlMs: RECOVERY_LINK_TTL_MS,
  });
  await links.save(link, TENANT, tx);
  return link;
}

describe("CheckoutLinkRepository.recordClaim (atomic claim count)", () => {
  it("counts a claim on a usable link and answers the new count", async () => {
    for (const [layer, links, tx] of layers()) {
      await seeded(links, tx);
      expect(
        await links.recordClaim(LINK_ID, TENANT, new Date(T0.getTime() + 1000), "cs-1", tx),
        layer,
      ).toBe(1);
      expect(
        await links.recordClaim(LINK_ID, TENANT, new Date(T0.getTime() + 2000), "cs-2", tx),
        layer,
      ).toBe(2);
      const stored = await links.findById(LINK_ID, TENANT, tx);
      expect(stored?.claimCount, layer).toBe(2);
      expect(stored?.lastClaimedAt, layer).toEqual(new Date(T0.getTime() + 2000));
      expect(stored?.resultCheckoutRef, layer).toBe("cs-2");
    }
  });

  it("concurrent claims all count", async () => {
    for (const [layer, links, tx] of layers()) {
      await seeded(links, tx);
      await Promise.all(
        ["cs-1", "cs-2", "cs-3"].map((ref) => links.recordClaim(LINK_ID, TENANT, T0, ref, tx)),
      );
      expect((await links.findById(LINK_ID, TENANT, tx))?.claimCount, layer).toBe(3);
    }
  });

  it("does not count on an expired (at the instant itself) or revoked link", async () => {
    for (const [layer, links, tx] of layers()) {
      const link = await seeded(links, tx);
      expect(
        await links.recordClaim(LINK_ID, TENANT, link.expiresAt, "cs-1", tx),
        layer,
      ).toBeNull();
      const loaded = await links.findById(LINK_ID, TENANT, tx);
      if (loaded === null) throw new Error("setup failed");
      loaded.revoke(T0);
      await links.save(loaded, TENANT, tx);
      expect(await links.recordClaim(LINK_ID, TENANT, T0, "cs-1", tx), layer).toBeNull();
      const stored = await links.findById(LINK_ID, TENANT, tx);
      expect(stored?.claimCount, layer).toBe(0);
      expect(stored?.lastClaimedAt, layer).toBeNull();
      expect(stored?.resultCheckoutRef, layer).toBeNull();
    }
  });

  it("is unknown for another shop's link and for a non-UUID id", async () => {
    for (const [layer, links, tx] of layers()) {
      await seeded(links, tx);
      expect(await links.recordClaim(LINK_ID, "tenant-b", T0, "cs-1", tx), layer).toBeNull();
      expect(await links.recordClaim("abc", TENANT, T0, "cs-1", tx), layer).toBeNull();
      expect((await links.findById(LINK_ID, TENANT, tx))?.claimCount, layer).toBe(0);
    }
  });

  it("refuses to write outside the unit of work (Prisma)", async () => {
    const fake = createFakePrisma();
    const links = new PrismaCheckoutLinkRepository({ prisma: fake.database });
    await expect(links.recordClaim(LINK_ID, TENANT, T0, "cs-1")).rejects.toThrow(/unit of work/);
  });
});
