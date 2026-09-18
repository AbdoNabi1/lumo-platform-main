import { describe, expect, it } from "vitest";
import { ConcurrencyError } from "@platform/utils";
import { INITIAL_SEGMENT_VERSION } from "../domain/segment-version";
import { applyMembershipUpdate } from "../domain/segment-membership";
import { InMemorySegmentStore } from "./in-memory-segment-store";
import { runSegmentStoreContractTests } from "./segment-store.contract";
import { TENANT_A } from "../test-support/tenants";

runSegmentStoreContractTests("in-memory", () => new InMemorySegmentStore());

/** Mirrors `in-memory-attribute-store.test.ts`'s adapter-specific create-branch CAS conflict test —
 * the in-memory adapter can cheaply detect an `expectedVersion=INITIAL_SEGMENT_VERSION` create
 * conflict and throws a typed `ConcurrencyError`; `PrismaSegmentStore` deliberately does not (see
 * ADR-0060 §Decision 5), so this assertion belongs here, adapter-specifically. */
describe("InMemorySegmentStore — create-branch CAS conflict (adapter-specific, ADR-0060)", () => {
  it("saveCurrent with expectedVersion=INITIAL_SEGMENT_VERSION rejects when a row already exists", async () => {
    const store = new InMemorySegmentStore();
    const identifier = { type: "customer_id" as const, value: "cust-create-race" };
    const segmentId = "high_value";

    const first = applyMembershipUpdate(null, identifier.type, identifier.value, segmentId, {
      isMember: true,
      definitionId: segmentId,
      definitionVersion: 1,
      matchedRuleIds: [],
      inputs: new Map(),
      evaluatedAt: "t0",
    }).membership!;
    await store.saveCurrent(first, TENANT_A, INITIAL_SEGMENT_VERSION);

    // A second create attempt for the same (identifier, segmentId) pair, expecting no row to exist
    // yet — must lose the race against the row `first` already occupies.
    const fabricated = { ...first, status: "exited" as const, version: 1 };
    await expect(
      store.saveCurrent(fabricated, TENANT_A, INITIAL_SEGMENT_VERSION),
    ).rejects.toBeInstanceOf(ConcurrencyError);

    const loaded = await store.getCurrent(identifier, segmentId, TENANT_A);
    expect(loaded?.status).toBe("entered");
  });
});
