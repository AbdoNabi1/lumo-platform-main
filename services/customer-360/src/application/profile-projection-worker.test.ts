import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { IdentifierType } from "@platform/tracking";
import {
  applyFieldUpdate,
  createEmptyProfile,
  type CustomerProfile,
} from "../domain/customer-profile";
import { toSnapshot, type ProfileSnapshot } from "../domain/profile-snapshot";
import type { ProfileHistoryStore } from "../ports/profile-history-store";
import type { ProfileStore } from "../ports/profile-store";
import { RebuildProfileProjection } from "./rebuild-profile-projection.use-case";
import { ProfileProjectionWorker } from "./profile-projection-worker";

function wire(seedProfiles: readonly CustomerProfile[]) {
  const current = new Map<string, CustomerProfile>();
  const snapshots: ProfileSnapshot[] = [];
  for (const profile of seedProfiles) {
    current.set(profile.identifierValue, profile);
    snapshots.push(toSnapshot(profile, "created", profile.updatedAt));
  }

  const profiles: ProfileStore = {
    getCurrent: async (id) => current.get(id.value) ?? null,
    saveCurrent: async (profile) => {
      current.set(profile.identifierValue, profile);
    },
    listIdentifiers: async () =>
      [...current.values()].map((p) => ({
        type: p.identifierType as IdentifierType,
        value: p.identifierValue,
      })),
  };
  const history: ProfileHistoryStore = {
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

  const rebuild = new RebuildProfileProjection({
    profiles,
    history,
    unitOfWork,
    idGenerator,
    clock,
  });
  const worker = new ProfileProjectionWorker({ profiles, rebuild });
  return { worker, profiles, current };
}

describe("ProfileProjectionWorker", () => {
  it("rebuilds every known identifier and reports a zero-failure summary", async () => {
    const a = applyFieldUpdate(createEmptyProfile("customer_id", "cust-a", "t0"), "email", {
      value: "a@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:01.000Z",
    }).profile;
    const b = applyFieldUpdate(createEmptyProfile("customer_id", "cust-b", "t0"), "email", {
      value: "b@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:01.000Z",
    }).profile;

    const { worker } = wire([a, b]);
    const result = await worker.execute({});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ rebuilt: 2, failed: 0 });
  });

  it("isolates one identifier's failure — the rest of the batch still rebuilds", async () => {
    const a = applyFieldUpdate(createEmptyProfile("customer_id", "cust-a", "t0"), "email", {
      value: "a@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:01.000Z",
    }).profile;

    const { profiles } = wire([a]);
    // `RebuildProfileProjection` is a class with private fields, so a plain `{ execute }` object
    // has no structural overlap with it (comparability fails) — needs the `unknown` hop.
    const failingRebuild: RebuildProfileProjection = {
      execute: async () => {
        throw new Error("boom");
      },
    } as unknown as RebuildProfileProjection;
    const workerWithOneBadDep = new ProfileProjectionWorker({ profiles, rebuild: failingRebuild });

    const result = await workerWithOneBadDep.execute({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ rebuilt: 0, failed: 1 });
  });

  it("reports rebuilt: 0, failed: 0 when there is nothing to rebuild yet", async () => {
    const { worker } = wire([]);
    const result = await worker.execute({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ rebuilt: 0, failed: 0 });
  });
});
