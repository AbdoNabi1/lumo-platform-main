import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { IdentifierType } from "@platform/tracking";
import {
  applyAttributeUpdate,
  createEmptyComputedAttribute,
  type ComputedAttribute,
} from "../domain/computed-attribute";
import { toSnapshot, type AttributeSnapshot } from "../domain/attribute-snapshot";
import type { AttributeHistoryStore } from "../ports/attribute-history-store";
import type { AttributeStore } from "../ports/attribute-store";
import { RebuildComputedAttributes } from "./rebuild-computed-attributes.use-case";
import { ComputedAttributeProjectionWorker } from "./computed-attribute-projection-worker";
import { TENANT_A } from "../test-support/tenants";

function wire(seedAttributes: readonly ComputedAttribute[]) {
  const current = new Map<string, ComputedAttribute>();
  const snapshots: AttributeSnapshot[] = [];
  for (const attribute of seedAttributes) {
    current.set(attribute.identifierValue, attribute);
    snapshots.push(toSnapshot(attribute, "created", attribute.updatedAt));
  }

  const attributes: AttributeStore = {
    getCurrent: async (id) => current.get(id.value) ?? null,
    saveCurrent: async (attribute) => {
      current.set(attribute.identifierValue, attribute);
    },
    listIdentifiers: async () =>
      [...current.values()].map((a) => ({
        type: a.identifierType as IdentifierType,
        value: a.identifierValue,
      })),
  };
  const history: AttributeHistoryStore = {
    append: async (snapshot, event) => {
      snapshots.push(snapshot);
      void event;
    },
    listFor: async (id) => snapshots.filter((s) => s.identifierValue === id.value),
    latestFor: async (id) => {
      const rows = snapshots.filter((s) => s.identifierValue === id.value);
      return rows.length === 0 ? null : rows[rows.length - 1]!;
    },
  };
  const unitOfWork: TransactionalUnitOfWork<unknown> = { run: (work) => work(undefined) };
  const idGenerator: IdGenerator = { generate: () => "id-1" };
  const clock: Clock = { now: () => new Date("2026-07-21T02:00:00.000Z") };

  const rebuild = new RebuildComputedAttributes({
    attributes,
    history,
    unitOfWork,
    idGenerator,
    clock,
  });
  const worker = new ComputedAttributeProjectionWorker({ attributes, rebuild });
  return { worker, attributes };
}

function attr(identifierValue: string): ComputedAttribute {
  return applyAttributeUpdate(
    createEmptyComputedAttribute("customer_id", identifierValue, "t0"),
    "is_vip",
    {
      value: true,
      definitionId: "is_vip",
      definitionVersion: 1,
      matchedRuleIds: [],
      inputs: new Map(),
      evaluatedAt: "2026-07-21T00:00:01.000Z",
    },
  ).attribute;
}

describe("ComputedAttributeProjectionWorker", () => {
  it("rebuilds every known identifier and reports a zero-failure summary", async () => {
    const { worker } = wire([attr("cust-a"), attr("cust-b")]);
    const result = await worker.execute({ tenantId: TENANT_A });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ rebuilt: 2, failed: 0 });
  });

  it("isolates one identifier's failure — the rest of the batch still rebuilds", async () => {
    const { attributes } = wire([attr("cust-a")]);
    // `RebuildComputedAttributes` is a class with private fields, so a plain `{ execute }` object
    // has no structural overlap with it (comparability fails) — needs the `unknown` hop.
    const failingRebuild: RebuildComputedAttributes = {
      execute: async () => {
        throw new Error("boom");
      },
    } as unknown as RebuildComputedAttributes;
    const worker = new ComputedAttributeProjectionWorker({ attributes, rebuild: failingRebuild });

    const result = await worker.execute({ tenantId: TENANT_A });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ rebuilt: 0, failed: 1 });
  });

  it("reports rebuilt: 0, failed: 0 when there is nothing to rebuild yet", async () => {
    const { worker } = wire([]);
    const result = await worker.execute({ tenantId: TENANT_A });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ rebuilt: 0, failed: 0 });
  });
});
