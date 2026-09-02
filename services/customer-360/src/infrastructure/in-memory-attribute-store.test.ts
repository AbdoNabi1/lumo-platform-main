import { describe, expect, it } from "vitest";
import { ConcurrencyError } from "@platform/utils";
import { INITIAL_ATTRIBUTE_VERSION } from "../domain/attribute-version";
import { applyAttributeUpdate, createEmptyComputedAttribute } from "../domain/computed-attribute";
import { InMemoryAttributeStore } from "./in-memory-attribute-store";
import { runAttributeStoreContractTests } from "./attribute-store.contract";

runAttributeStoreContractTests("in-memory", () => new InMemoryAttributeStore());

/**
 * ADR-0060 §Decision 5 / §Alternatives: the create-branch conflict (`expectedVersion ===
 * INITIAL_ATTRIBUTE_VERSION` but a row already exists) is asymmetric across adapters by design — the
 * in-memory adapter can cheaply detect it and throw a typed `ConcurrencyError`, while
 * `PrismaAttributeStore` deliberately does not catch `P2002` (matching every other D-042 adapter's
 * own create branch on this platform) and lets a raw Prisma error propagate instead. This assertion
 * therefore belongs here, adapter-specifically, not in the shared `attribute-store.contract.ts`.
 */
describe("InMemoryAttributeStore — create-branch CAS conflict (adapter-specific, ADR-0060)", () => {
  it("saveCurrent with expectedVersion=INITIAL_ATTRIBUTE_VERSION rejects with ConcurrencyError when a row already exists", async () => {
    const store = new InMemoryAttributeStore();
    const identifier = { type: "customer_id" as const, value: "cust-create-race" };

    const first = applyAttributeUpdate(
      createEmptyComputedAttribute(identifier.type, identifier.value, "t0"),
      "is_vip",
      {
        value: true,
        definitionId: "is_vip",
        definitionVersion: 1,
        matchedRuleIds: ["rule-1"],
        inputs: new Map(),
        evaluatedAt: "t0",
      },
    ).attribute;
    await store.saveCurrent(first, INITIAL_ATTRIBUTE_VERSION);

    const second = applyAttributeUpdate(
      createEmptyComputedAttribute(identifier.type, identifier.value, "t0"),
      "is_churn_risk",
      {
        value: true,
        definitionId: "is_churn_risk",
        definitionVersion: 1,
        matchedRuleIds: ["rule-2"],
        inputs: new Map(),
        evaluatedAt: "t0",
      },
    ).attribute;

    await expect(store.saveCurrent(second, INITIAL_ATTRIBUTE_VERSION)).rejects.toBeInstanceOf(
      ConcurrencyError,
    );

    // The loser's write never applied -- only the first attribute is present.
    const loaded = await store.getCurrent(identifier);
    expect(loaded?.attributes.has("is_vip")).toBe(true);
    expect(loaded?.attributes.has("is_churn_risk")).toBe(false);
  });
});
