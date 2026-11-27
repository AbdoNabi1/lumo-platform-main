import { beforeEach, describe, expect, it } from "vitest";

import { createProfile } from "./profile-merge";
import { InMemoryTrackingProfileStore } from "./profile-store";
import type { TrackingProfile } from "./tracking-profile";

/**
 * The behaviour every `TrackingProfileStore` must have. The in-memory twin is held to it here; the Postgres
 * adapter's gated integration test (`prisma-tracking-profile-store.integration.test.ts`) replays the same
 * scenarios against a real database.
 */
beforeEach(() => {
  expect.hasAssertions();
});

const T0 = "2026-01-10T10:00:00.000Z";
const NOW = new Date("2026-11-27T10:00:00.000Z");

function profile(
  tenantId: string,
  visitorId: string,
  extra: Partial<TrackingProfile> = {},
): TrackingProfile {
  return {
    ...createProfile({ tenantId, visitorId, at: T0, now: T0 }),
    ...extra,
  };
}

describe("InMemoryTrackingProfileStore", () => {
  it("creates a profile at version 0 and reads it back by every key", async () => {
    const store = new InMemoryTrackingProfileStore();
    const created = profile("t-1", "v-1", {
      customerId: "c-1",
      hashes: { emailStd: "e-1", phoneE164: "p-1" },
    });
    expect(await store.persist({ profile: created, aliases: [], absorbed: [] })).toBe(true);

    const byVisitor = await store.findByVisitorId("t-1", "v-1");
    expect(byVisitor?.version).toBe(1);
    expect((await store.findByCustomerId("t-1", "c-1"))?.visitorId).toBe("v-1");
    expect((await store.findByEmailHash("t-1", "e-1"))?.visitorId).toBe("v-1");
    expect((await store.findByPhoneHash("t-1", "p-1"))?.visitorId).toBe("v-1");
  });

  it("is a separate keyspace per tenant for every lookup", async () => {
    const store = new InMemoryTrackingProfileStore();
    await store.persist({
      profile: profile("t-1", "v-1", {
        customerId: "c-1",
        hashes: { emailStd: "e-1", phoneE164: "p-1" },
      }),
      aliases: [],
      absorbed: [],
    });

    expect(await store.findByVisitorId("t-2", "v-1")).toBeNull();
    expect(await store.findByCustomerId("t-2", "c-1")).toBeNull();
    expect(await store.findByEmailHash("t-2", "e-1")).toBeNull();
    expect(await store.findByPhoneHash("t-2", "p-1")).toBeNull();

    // the same cookie id in two tenants is two profiles
    await store.persist({ profile: profile("t-2", "v-1"), aliases: [], absorbed: [] });
    expect(store.all("t-1")).toHaveLength(1);
    expect(store.all("t-2")).toHaveLength(1);
  });

  it("an optimistic write conflicts when the version moved, and changes nothing", async () => {
    const store = new InMemoryTrackingProfileStore();
    await store.persist({ profile: profile("t-1", "v-1"), aliases: [], absorbed: [] });
    const read = await store.findByVisitorId("t-1", "v-1");
    if (read === null) throw new Error("expected a profile");

    expect(
      await store.persist({
        profile: { ...read, lastIp: "203.0.113.1" },
        aliases: [],
        absorbed: [],
      }),
    ).toBe(true);
    // a second writer that read the same version loses
    expect(
      await store.persist({
        profile: { ...read, lastIp: "198.51.100.1" },
        aliases: [],
        absorbed: [],
      }),
    ).toBe(false);
    expect((await store.findByVisitorId("t-1", "v-1"))?.lastIp).toBe("203.0.113.1");

    // creating what already exists conflicts too
    expect(await store.persist({ profile: profile("t-1", "v-1"), aliases: [], absorbed: [] })).toBe(
      false,
    );
  });

  it("an absorbed profile becomes a data-free tombstone that resolves to the survivor", async () => {
    const store = new InMemoryTrackingProfileStore();
    await store.persist({
      profile: profile("t-1", "v-old", { hashes: { phoneE164: "p-1" } }),
      aliases: [],
      absorbed: [],
    });
    await store.persist({
      profile: profile("t-1", "v-new", { hashes: { phoneE164: "p-1" }, lastIp: "203.0.113.1" }),
      aliases: [],
      absorbed: [],
    });
    const survivor = await store.findByVisitorId("t-1", "v-old");
    const loser = await store.findByVisitorId("t-1", "v-new");
    if (survivor === null || loser === null) throw new Error("expected two profiles");

    // a stale version for the absorbed row refuses the whole change
    expect(
      await store.persist({
        profile: survivor,
        aliases: ["v-brand-new"],
        absorbed: [{ visitorId: "v-new", version: loser.version + 5 }],
      }),
    ).toBe(false);
    expect(store.aliases("t-1").size).toBe(0);

    expect(
      await store.persist({
        profile: survivor,
        aliases: ["v-brand-new"],
        absorbed: [{ visitorId: "v-new", version: loser.version }],
      }),
    ).toBe(true);

    expect(store.all("t-1")).toHaveLength(1);
    expect((await store.findByVisitorId("t-1", "v-new"))?.visitorId).toBe("v-old");
    expect((await store.findByVisitorId("t-1", "v-brand-new"))?.visitorId).toBe("v-old");
    // the tombstone is not a candidate for the hash lookups
    expect((await store.findByPhoneHash("t-1", "p-1"))?.visitorId).toBe("v-old");
    expect(store.aliases("t-1").get("v-new")).toBe("v-old");
  });

  it("erasing a customer deletes their profiles and every cookie that resolved to them, and only theirs", async () => {
    const store = new InMemoryTrackingProfileStore();
    await store.persist({
      profile: profile("t-1", "v-c1", { customerId: "c-1" }),
      aliases: ["v-c1-phone"],
      absorbed: [],
    });
    await store.persist({
      profile: profile("t-1", "v-c2", { customerId: "c-2" }),
      aliases: [],
      absorbed: [],
    });
    await store.persist({
      profile: profile("t-2", "v-c1", { customerId: "c-1" }),
      aliases: [],
      absorbed: [],
    });

    expect(await store.eraseCustomer("t-1", "c-1")).toBe(2);
    expect(await store.findByVisitorId("t-1", "v-c1")).toBeNull();
    expect(await store.findByVisitorId("t-1", "v-c1-phone")).toBeNull();
    expect(await store.findByCustomerId("t-1", "c-2")).not.toBeNull();
    // the same customer id in another tenant is another person
    expect(await store.findByCustomerId("t-2", "c-1")).not.toBeNull();
  });

  it("deletes expired ANONYMOUS profiles only; a customer's profile survives its expiry date", async () => {
    const store = new InMemoryTrackingProfileStore();
    const expired = { expiresAt: "2026-11-01T00:00:00.000Z" };
    await store.persist({
      profile: profile("t-1", "v-anon-old", expired),
      aliases: [],
      absorbed: [],
    });
    await store.persist({
      profile: profile("t-1", "v-anon-new", { expiresAt: "2027-06-01T00:00:00.000Z" }),
      aliases: [],
      absorbed: [],
    });
    await store.persist({
      profile: profile("t-1", "v-customer", { ...expired, customerId: "c-1" }),
      aliases: [],
      absorbed: [],
    });
    await store.persist({
      profile: profile("t-2", "v-other-tenant", expired),
      aliases: [],
      absorbed: [],
    });

    expect(await store.tenantsWithExpiredProfiles(NOW)).toEqual(["t-1", "t-2"]);
    expect(await store.deleteExpiredAnonymous("t-1", NOW)).toBe(1);

    expect(
      store
        .all("t-1")
        .map((p) => p.visitorId)
        .sort(),
    ).toEqual(["v-anon-new", "v-customer"]);
    expect(store.all("t-2")).toHaveLength(1); // another tenant's expired row is not this call's business
    // the customer's expired profile is not the job's business, so only t-2 still has work
    expect(await store.tenantsWithExpiredProfiles(NOW)).toEqual(["t-2"]);
  });
});
