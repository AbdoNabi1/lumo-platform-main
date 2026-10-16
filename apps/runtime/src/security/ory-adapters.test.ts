import { describe, expect, it } from "vitest";
import type { KetoRelationCheck, KetoRelationshipClient } from "@platform/auth";
import { KetoRelationshipCheck } from "./ory-adapters";

/**
 * G-70 — Security's ReBAC check reads the tuples `RelationWrittenConsumer` writes, so it must ask Keto
 * for the tenant-qualified object. Otherwise deleting the bare tuples (the contract step) would deny
 * every ReBAC check, and until then it would answer from a tuple that belongs to no tenant.
 */
describe("KetoRelationshipCheck (G-70)", () => {
  function recording() {
    const seen: KetoRelationCheck[] = [];
    const keto = {
      check: async (query: KetoRelationCheck) => {
        seen.push(query);
        return true;
      },
    } as unknown as KetoRelationshipClient;
    return { seen, adapter: new KetoRelationshipCheck(keto) };
  }

  it("checks the tenant-qualified object, with the subject unchanged", async () => {
    const { seen, adapter } = recording();
    await adapter.check(
      { namespace: "permissions", object: "doc:1", relation: "viewer", subjectId: "principal:a" },
      "tenant-a",
    );
    expect(seen).toEqual([
      {
        namespace: "permissions",
        object: "tenant/tenant-a/doc:1",
        relation: "viewer",
        subjectId: "principal:a",
      },
    ]);
  });

  it("asks for a different object for a different tenant", async () => {
    const { seen, adapter } = recording();
    const query = {
      namespace: "permissions",
      object: "doc:1",
      relation: "viewer",
      subjectId: "principal:a",
    };
    await adapter.check(query, "tenant-a");
    await adapter.check(query, "tenant-b");
    expect(seen.map((q) => q.object)).toEqual(["tenant/tenant-a/doc:1", "tenant/tenant-b/doc:1"]);
  });
});
