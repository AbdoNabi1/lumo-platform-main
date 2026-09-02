import { describe, expect, it } from "vitest";
import { ConcurrencyError } from "@platform/utils";
import { INITIAL_ATTRIBUTE_VERSION } from "../domain/attribute-version";
import { applyAttributeUpdate, createEmptyComputedAttribute } from "../domain/computed-attribute";
import type { AttributeStore } from "../ports/attribute-store";

/**
 * Repository parity contract: the same behavioral assertions run against every `AttributeStore`
 * adapter — exactly `profile-store.contract.ts`'s shape, mirrored for Computed Attributes. Call once
 * per adapter with a fresh store factory (a function, not an instance, so each `it` gets isolated
 * state).
 */
/**
 * Phase A.20 (Task 7): a real ISO timestamp standing in for the placeholder string `"t0"`. Harmless
 * against the in-memory adapter (never parsed as a `Date`), but this suite is also run against the
 * Prisma-backed adapter, which writes it into a real PostgreSQL `DateTime` column — `new
 * Date("t0")` is Invalid Date there. See PHASE_A19_REAL_POSTGRESQL_VALIDATION_REPORT.md §10.
 */
const T0 = "2026-07-20T23:59:59.000Z";
const T1 = "2026-07-21T00:00:01.000Z";
export function runAttributeStoreContractTests(
  adapterName: string,
  makeStore: () => AttributeStore,
): void {
  describe(`AttributeStore contract — ${adapterName}`, () => {
    const identifier = { type: "customer_id" as const, value: `contract-${adapterName}` };

    /** Fixture shared by the ADR-0060 CAS tests below: a fresh identifier's first-ever attribute
     * ("tier" = "bronze"), the common starting point each of them then diverges from. */
    function bronzeTier() {
      return applyAttributeUpdate(
        createEmptyComputedAttribute(identifier.type, identifier.value, T0),
        "tier",
        {
          value: "bronze",
          definitionId: "tier",
          definitionVersion: 1,
          matchedRuleIds: ["bronze-rule"],
          inputs: new Map(),
          evaluatedAt: "2026-07-21T00:00:01.000Z",
        },
      ).attribute;
    }

    it("getCurrent returns null for an identifier that was never saved", async () => {
      const store = makeStore();
      expect(await store.getCurrent(identifier)).toBeNull();
    });

    it("saveCurrent then getCurrent round-trips the same attributes/version/updatedAt", async () => {
      const store = makeStore();
      const attribute = applyAttributeUpdate(
        createEmptyComputedAttribute(identifier.type, identifier.value, "2026-07-21T00:00:00.000Z"),
        "is_vip",
        {
          value: true,
          definitionId: "is_vip",
          definitionVersion: 1,
          matchedRuleIds: ["rule-1"],
          inputs: new Map([["profile.lifetime_value", 1000]]),
          evaluatedAt: "2026-07-21T00:00:01.000Z",
        },
      ).attribute;

      await store.saveCurrent(attribute);
      const loaded = await store.getCurrent(identifier);

      expect(loaded).not.toBeNull();
      expect(loaded?.version).toBe(attribute.version);
      expect(loaded?.updatedAt).toBe(attribute.updatedAt);
      expect(loaded?.attributes.get("is_vip")).toEqual(attribute.attributes.get("is_vip"));
    });

    it("saveCurrent upserts — a second save replaces rather than duplicates", async () => {
      const store = makeStore();
      const first = applyAttributeUpdate(
        createEmptyComputedAttribute(identifier.type, identifier.value, T0),
        "tier",
        {
          value: "bronze",
          definitionId: "tier",
          definitionVersion: 1,
          matchedRuleIds: ["bronze-rule"],
          inputs: new Map(),
          evaluatedAt: "2026-07-21T00:00:01.000Z",
        },
      ).attribute;
      const second = applyAttributeUpdate(first, "tier", {
        value: "gold",
        definitionId: "tier",
        definitionVersion: 1,
        matchedRuleIds: ["gold-rule"],
        inputs: new Map(),
        evaluatedAt: "2026-07-21T00:00:02.000Z",
      }).attribute;

      await store.saveCurrent(first);
      await store.saveCurrent(second);
      const loaded = await store.getCurrent(identifier);

      expect(loaded?.attributes.get("tier")?.value).toBe("gold");
      expect(loaded?.version).toBe(2);
    });

    // --- ADR-0060: optimistic concurrency (expectedVersion) — same behavior required of every
    // adapter (the create-vs-update-branch error-type asymmetry documented in ADR-0060 §Decision 5
    // is NOT part of this shared contract; it is covered adapter-specifically in
    // `in-memory-attribute-store.test.ts`). ---

    it("saveCurrent with a matching expectedVersion succeeds and chains create -> update", async () => {
      const store = makeStore();
      const created = bronzeTier();

      await store.saveCurrent(created, INITIAL_ATTRIBUTE_VERSION);
      expect((await store.getCurrent(identifier))?.version).toBe(created.version);

      const updated = applyAttributeUpdate(created, "tier", {
        value: "gold",
        definitionId: "tier",
        definitionVersion: 1,
        matchedRuleIds: ["gold-rule"],
        inputs: new Map(),
        evaluatedAt: "2026-07-21T00:00:02.000Z",
      }).attribute;

      await store.saveCurrent(updated, created.version);
      const loaded = await store.getCurrent(identifier);
      expect(loaded?.attributes.get("tier")?.value).toBe("gold");
      expect(loaded?.version).toBe(updated.version);
    });

    it("saveCurrent with a stale expectedVersion (update branch) rejects with ConcurrencyError and never applies the write", async () => {
      const store = makeStore();
      const created = bronzeTier();
      await store.saveCurrent(created, INITIAL_ATTRIBUTE_VERSION);

      const staleAttempt = applyAttributeUpdate(created, "tier", {
        value: "gold",
        definitionId: "tier",
        definitionVersion: 1,
        matchedRuleIds: ["gold-rule"],
        inputs: new Map(),
        evaluatedAt: "2026-07-21T00:00:02.000Z",
      }).attribute;

      // Deliberately wrong: `created.version` is already stale by the time of this second call in a
      // real race; here we just assert the guard directly by passing an expected version one higher
      // than what's actually stored.
      await expect(store.saveCurrent(staleAttempt, created.version + 1)).rejects.toBeInstanceOf(
        ConcurrencyError,
      );

      const loaded = await store.getCurrent(identifier);
      expect(loaded?.attributes.get("tier")?.value).toBe("bronze");
      expect(loaded?.version).toBe(created.version);
    });

    it("saveCurrent with expectedVersion omitted still blindly overwrites regardless of current version — RebuildComputedAttributes' recovery semantics, preserved", async () => {
      const store = makeStore();
      const created = bronzeTier();
      await store.saveCurrent(created, INITIAL_ATTRIBUTE_VERSION);

      const overwrite = createEmptyComputedAttribute(identifier.type, identifier.value, T1);
      await store.saveCurrent(overwrite); // no expectedVersion -- unconditional, exactly like today
      const loaded = await store.getCurrent(identifier);
      expect(loaded?.attributes.size).toBe(0);
    });

    it("listIdentifiers reports every saved identifier exactly once", async () => {
      const store = makeStore();
      const other = { type: "customer_id" as const, value: `contract-${adapterName}-2` };
      await store.saveCurrent(createEmptyComputedAttribute(identifier.type, identifier.value, T0));
      await store.saveCurrent(createEmptyComputedAttribute(other.type, other.value, T0));
      // Re-saving the first identifier must not duplicate it in the listing.
      await store.saveCurrent(createEmptyComputedAttribute(identifier.type, identifier.value, T1));

      const ids = await store.listIdentifiers();
      const values = ids.map((id) => id.value).sort();
      expect(values).toEqual([identifier.value, other.value].sort());
    });
  });
}
