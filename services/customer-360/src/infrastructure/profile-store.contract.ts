import { beforeEach, describe, expect, it } from "vitest";
import { applyFieldUpdate, createEmptyProfile } from "../domain/customer-profile";
import type { ProfileStore } from "../ports/profile-store";

/**
 * Repository parity contract: the same behavioral assertions run against every `ProfileStore`
 * adapter, proving the in-memory and Prisma implementations honor the identical port contract
 * rather than each adapter's tests silently drifting into checking different things. Call once per
 * adapter with a fresh store factory (a function, not an instance, so each `it` gets isolated state).
 */
/**
 * Phase A.20 (Task 7): a real ISO timestamp standing in for the placeholder string `"t0"`. Harmless
 * against the in-memory adapter (never parsed as a `Date`), but this suite is also run against the
 * Prisma-backed adapter, which writes it into a real PostgreSQL `DateTime` column — `new
 * Date("t0")` is Invalid Date there. See PHASE_A19_REAL_POSTGRESQL_VALIDATION_REPORT.md §10.
 */
const T0 = "2026-07-20T23:59:59.000Z";
const T1 = "2026-07-21T00:00:01.000Z";
export function runProfileStoreContractTests(
  adapterName: string,
  makeStore: () => ProfileStore,
): void {
  describe(`ProfileStore contract — ${adapterName}`, () => {
    // A fresh tenant per test keeps the Prisma run isolated from rows earlier tests left behind.
    let tenantId: string;
    beforeEach(() => {
      tenantId = `tenant-contract-${crypto.randomUUID()}`;
    });

    const identifier = { type: "customer_id" as const, value: `contract-${adapterName}` };

    it("getCurrent returns null for an identifier that was never saved", async () => {
      const store = makeStore();
      expect(await store.getCurrent(identifier, tenantId)).toBeNull();
    });

    it("saveCurrent then getCurrent round-trips the same fields/version/updatedAt", async () => {
      const store = makeStore();
      const profile = applyFieldUpdate(
        createEmptyProfile(identifier.type, identifier.value, "2026-07-21T00:00:00.000Z"),
        "email",
        {
          value: "a@example.com",
          source: "orders",
          confidence: "verified",
          occurredAt: "2026-07-21T00:00:01.000Z",
        },
      ).profile;

      await store.saveCurrent(profile, tenantId);
      const loaded = await store.getCurrent(identifier, tenantId);

      expect(loaded).not.toBeNull();
      expect(loaded?.version).toBe(profile.version);
      expect(loaded?.updatedAt).toBe(profile.updatedAt);
      expect(loaded?.fields.get("email")).toEqual(profile.fields.get("email"));
    });

    it("saveCurrent upserts — a second save replaces rather than duplicates", async () => {
      const store = makeStore();
      const first = applyFieldUpdate(
        createEmptyProfile(identifier.type, identifier.value, T0),
        "email",
        {
          value: "old@example.com",
          source: "orders",
          confidence: "inferred",
          occurredAt: "2026-07-21T00:00:01.000Z",
        },
      ).profile;
      const second = applyFieldUpdate(first, "email", {
        value: "new@example.com",
        source: "loyalty",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:02.000Z",
      }).profile;

      await store.saveCurrent(first, tenantId);
      await store.saveCurrent(second, tenantId);
      const loaded = await store.getCurrent(identifier, tenantId);

      expect(loaded?.fields.get("email")?.value).toBe("new@example.com");
      expect(loaded?.version).toBe(2);
    });

    it("listIdentifiers reports every saved identifier exactly once", async () => {
      const store = makeStore();
      const other = { type: "customer_id" as const, value: `contract-${adapterName}-2` };
      await store.saveCurrent(createEmptyProfile(identifier.type, identifier.value, T0), tenantId);
      await store.saveCurrent(createEmptyProfile(other.type, other.value, T0), tenantId);
      // Re-saving the first identifier must not duplicate it in the listing.
      await store.saveCurrent(createEmptyProfile(identifier.type, identifier.value, T1), tenantId);

      const ids = await store.listIdentifiers(tenantId);
      const values = ids.map((id) => id.value).sort();
      expect(values).toEqual([identifier.value, other.value].sort());
    });

    it("isolates tenants — a profile saved under one tenant is invisible to another (ADR-0014)", async () => {
      const store = makeStore();
      const otherTenant = `${tenantId}-other`;
      const profile = applyFieldUpdate(
        createEmptyProfile(identifier.type, identifier.value, "2026-07-21T00:00:00.000Z"),
        "email",
        {
          value: "a@example.com",
          source: "orders",
          confidence: "verified",
          occurredAt: "2026-07-21T00:00:01.000Z",
        },
      ).profile;

      await store.saveCurrent(profile, tenantId);

      expect(await store.getCurrent(identifier, otherTenant)).toBeNull();
      expect(await store.listIdentifiers(otherTenant)).toEqual([]);
      expect(await store.listIdentifiers(tenantId)).toEqual([identifier]);

      // A write for the same identifier under the other tenant must not touch the first tenant's row.
      await store.saveCurrent({ ...profile, version: profile.version + 5 }, otherTenant);
      expect((await store.getCurrent(identifier, tenantId))?.version).toBe(profile.version);
    });
  });
}
