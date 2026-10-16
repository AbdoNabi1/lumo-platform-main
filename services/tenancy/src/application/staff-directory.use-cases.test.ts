import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { ConflictError, NotFoundError } from "@platform/utils";
import { wireTenancy } from "../composition";

const clock: Clock = { now: () => new Date("2026-10-16T00:00:00.000Z") };

function wire() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireTenancy({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

describe("staff directory", () => {
  it("records a pending owner, finds it by any casing, then activates it", async () => {
    const { tenancy } = wire();
    const recorded = await tenancy.recordPendingOwner({
      email: "  Owner@Shop.Test ",
      shopId: "shop-a",
      ownerExternalId: "ext-1",
    });
    expect(recorded.ok && recorded.value).toEqual({
      email: "owner@shop.test",
      shopId: "shop-a",
      ownerExternalId: "ext-1",
      status: "pending",
    });
    expect((await tenancy.findStaffDirectoryEntry("OWNER@shop.test"))?.shopId).toBe("shop-a");
    const active = await tenancy.activateDirectoryEntry("owner@shop.test");
    expect(active.ok && active.value.status).toBe("active");
    expect((await tenancy.findStaffDirectoryEntry("owner@shop.test"))?.status).toBe("active");
  });

  it("refuses a second store for the same email", async () => {
    const { tenancy } = wire();
    await tenancy.recordPendingOwner({ email: "a@b.test", shopId: "shop-a", ownerExternalId: "x" });
    const again = await tenancy.recordPendingOwner({
      email: "A@b.test",
      shopId: "shop-b",
      ownerExternalId: "y",
    });
    expect(again.ok).toBe(false);
    expect(!again.ok && again.error).toBeInstanceOf(ConflictError);
    expect(!again.ok && again.error.name).toBe("ConflictError");
    expect((await tenancy.findStaffDirectoryEntry("a@b.test"))?.shopId).toBe("shop-a");
  });

  it("activating an unknown email is not found", async () => {
    const { tenancy } = wire();
    const res = await tenancy.activateDirectoryEntry("nobody@b.test");
    expect(!res.ok && res.error).toBeInstanceOf(NotFoundError);
    expect(!res.ok && res.error.name).toBe("NotFoundError");
  });

  it("activating an already active entry returns it unchanged", async () => {
    const { tenancy } = wire();
    await tenancy.recordPendingOwner({ email: "a@b.test", shopId: "shop-a", ownerExternalId: "x" });
    await tenancy.activateDirectoryEntry("a@b.test");
    const again = await tenancy.activateDirectoryEntry("A@b.test");
    expect(again.ok && again.value).toEqual({
      email: "a@b.test",
      shopId: "shop-a",
      ownerExternalId: "x",
      status: "active",
    });
  });

  it("finds nothing for an unknown email", async () => {
    const { tenancy } = wire();
    expect(await tenancy.findStaffDirectoryEntry("nobody@b.test")).toBeNull();
  });

  it("rejects an email without @ and empty fields", async () => {
    const { tenancy } = wire();
    for (const input of [
      { email: "not-an-email", shopId: "s", ownerExternalId: "x" },
      { email: "a@b.test", shopId: " ", ownerExternalId: "x" },
      { email: "a@b.test", shopId: "s", ownerExternalId: "" },
    ]) {
      const res = await tenancy.recordPendingOwner(input);
      expect(!res.ok && res.error.name).toBe("ValidationError");
    }
    expect(await tenancy.findStaffDirectoryEntry("a@b.test")).toBeNull();
  });
});
