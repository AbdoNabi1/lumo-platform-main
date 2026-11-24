import { beforeEach, describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { ConflictError } from "@platform/utils";
import { wireTenancy } from "../composition";

const clock: Clock = { now: () => new Date("2026-11-24T00:00:00.000Z") };

function wire() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireTenancy({ serializer: new InMemoryEventSerializer(), idGenerator, clock }).tenancy;
}

type Tenancy = ReturnType<typeof wire>;
let tenancy: Tenancy;
beforeEach(() => {
  expect.hasAssertions();
  tenancy = wire();
});

describe("ReserveStaffEmail", () => {
  it("inserts an ACTIVE row (not pending) for an unknown email, normalised", async () => {
    const res = await tenancy.reserveStaffEmail({
      email: "  Sam@Shop.Test ",
      shopId: "shop-a",
      ownerExternalId: "ext-1",
    });
    expect(res.ok && res.value).toEqual({
      email: "sam@shop.test",
      shopId: "shop-a",
      ownerExternalId: "ext-1",
      status: "active",
    });
    expect(await tenancy.findStaffDirectoryEntry("sam@shop.test")).toMatchObject({
      status: "active",
      shopId: "shop-a",
    });
  });

  it("is a no-op success when the same shop already holds it for the same owner", async () => {
    await tenancy.reserveStaffEmail({ email: "a@b.test", shopId: "shop-a", ownerExternalId: "x" });
    const again = await tenancy.reserveStaffEmail({
      email: "A@b.test",
      shopId: "shop-a",
      ownerExternalId: "x",
    });
    expect(again.ok).toBe(true);
    expect((await tenancy.findStaffDirectoryEntry("a@b.test"))?.ownerExternalId).toBe("x");
  });

  it("refuses another owner in the same shop without replaceSameShop, and keeps the row", async () => {
    await tenancy.reserveStaffEmail({ email: "a@b.test", shopId: "shop-a", ownerExternalId: "x" });
    const res = await tenancy.reserveStaffEmail({
      email: "a@b.test",
      shopId: "shop-a",
      ownerExternalId: "y",
    });
    expect(!res.ok && res.error).toBeInstanceOf(ConflictError);
    expect((await tenancy.findStaffDirectoryEntry("a@b.test"))?.ownerExternalId).toBe("x");
  });

  it("replaces the owner of a same-shop leftover only when replaceSameShop is set", async () => {
    await tenancy.reserveStaffEmail({ email: "a@b.test", shopId: "shop-a", ownerExternalId: "x" });
    const res = await tenancy.reserveStaffEmail({
      email: "a@b.test",
      shopId: "shop-a",
      ownerExternalId: "y",
      replaceSameShop: true,
    });
    expect(res.ok && res.value.ownerExternalId).toBe("y");
    expect(await tenancy.findStaffDirectoryEntry("a@b.test")).toMatchObject({
      shopId: "shop-a",
      ownerExternalId: "y",
      status: "active",
    });
  });

  it("never touches another shop's row, even with replaceSameShop", async () => {
    await tenancy.reserveStaffEmail({ email: "a@b.test", shopId: "shop-a", ownerExternalId: "x" });
    for (const replaceSameShop of [false, true]) {
      const res = await tenancy.reserveStaffEmail({
        email: "a@b.test",
        shopId: "shop-b",
        ownerExternalId: "y",
        replaceSameShop,
      });
      expect(!res.ok && res.error).toBeInstanceOf(ConflictError);
    }
    expect(await tenancy.findStaffDirectoryEntry("a@b.test")).toMatchObject({
      shopId: "shop-a",
      ownerExternalId: "x",
    });
  });

  it("answers a validation error for a malformed email and writes nothing", async () => {
    const res = await tenancy.reserveStaffEmail({
      email: "nope",
      shopId: "shop-a",
      ownerExternalId: "x",
    });
    expect(res.ok).toBe(false);
    expect(await tenancy.findStaffDirectoryEntry("nope")).toBeNull();
  });

  it("lets exactly one of two parallel reservations for different shops through", async () => {
    const [first, second] = await Promise.all([
      tenancy.reserveStaffEmail({ email: "a@b.test", shopId: "shop-a", ownerExternalId: "x" }),
      tenancy.reserveStaffEmail({
        email: "A@b.test",
        shopId: "shop-b",
        ownerExternalId: "y",
        replaceSameShop: true,
      }),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const loser = first.ok ? second : first;
    expect(!loser.ok && loser.error).toBeInstanceOf(ConflictError);
  });
});

describe("ReleaseStaffEmail", () => {
  it("deletes the row only when email, shop and owner all match", async () => {
    await tenancy.reserveStaffEmail({ email: "a@b.test", shopId: "shop-a", ownerExternalId: "x" });
    const res = await tenancy.releaseStaffEmail({
      email: " A@b.test",
      shopId: "shop-a",
      ownerExternalId: "x",
    });
    expect(res.ok).toBe(true);
    expect(await tenancy.findStaffDirectoryEntry("a@b.test")).toBeNull();
  });

  it("keeps the row when the owner differs", async () => {
    await tenancy.reserveStaffEmail({ email: "a@b.test", shopId: "shop-a", ownerExternalId: "x" });
    const res = await tenancy.releaseStaffEmail({
      email: "a@b.test",
      shopId: "shop-a",
      ownerExternalId: "other",
    });
    expect(res.ok).toBe(true);
    expect((await tenancy.findStaffDirectoryEntry("a@b.test"))?.ownerExternalId).toBe("x");
  });

  it("keeps another shop's row", async () => {
    await tenancy.reserveStaffEmail({ email: "a@b.test", shopId: "shop-a", ownerExternalId: "x" });
    const res = await tenancy.releaseStaffEmail({
      email: "a@b.test",
      shopId: "shop-b",
      ownerExternalId: "x",
    });
    expect(res.ok).toBe(true);
    expect((await tenancy.findStaffDirectoryEntry("a@b.test"))?.shopId).toBe("shop-a");
  });

  it("is a no-op success when no row exists", async () => {
    const res = await tenancy.releaseStaffEmail({
      email: "ghost@b.test",
      shopId: "shop-a",
      ownerExternalId: "x",
    });
    expect(res.ok).toBe(true);
  });

  it("also removes a row that was activated or pending (owner and shop match)", async () => {
    await tenancy.recordPendingOwner({ email: "p@b.test", shopId: "shop-a", ownerExternalId: "x" });
    const res = await tenancy.releaseStaffEmail({
      email: "p@b.test",
      shopId: "shop-a",
      ownerExternalId: "x",
    });
    expect(res.ok).toBe(true);
    expect(await tenancy.findStaffDirectoryEntry("p@b.test")).toBeNull();
  });
});
