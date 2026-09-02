import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { DomainEvent } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { IdentifierType } from "@platform/tracking";
import { createEmptyProfile, applyFieldUpdate } from "../domain/customer-profile";
import { toSnapshot, type ProfileSnapshot } from "../domain/profile-snapshot";
import type { CustomerProfile } from "../domain/customer-profile";
import type { ProfileHistoryStore } from "../ports/profile-history-store";
import type { ProfileStore } from "../ports/profile-store";
import { RebuildProfileProjection } from "./rebuild-profile-projection.use-case";

const identifier = { type: "customer_id" as const, value: "cust-1" };

function fakeDeps(seedSnapshots: readonly ProfileSnapshot[] = []) {
  const current = new Map<string, CustomerProfile>();
  const snapshots: ProfileSnapshot[] = [...seedSnapshots];
  const events: DomainEvent[] = [];

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
      events.push(event);
    },
    listFor: async (id) => snapshots.filter((s) => s.identifierValue === id.value),
    latestFor: async (id) => {
      const rows = snapshots.filter((s) => s.identifierValue === id.value);
      return rows.length === 0 ? null : rows[rows.length - 1]!;
    },
  };
  const unitOfWork: TransactionalUnitOfWork<unknown> = { run: (work) => work(undefined) };
  const idGenerator: IdGenerator = { generate: () => "id-1" };
  const clock: Clock = { now: () => new Date("2026-07-21T01:00:00.000Z") };

  return { profiles, history, unitOfWork, idGenerator, clock, current, snapshots, events };
}

describe("RebuildProfileProjection", () => {
  it("returns profile: null for an identifier with no history, without erroring", async () => {
    const deps = fakeDeps();
    const useCase = new RebuildProfileProjection(deps);
    const result = await useCase.execute({ identifier });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ profile: null, fieldCount: 0 });
    expect(deps.snapshots).toHaveLength(0);
  });

  it("reconstructs the current profile from the latest snapshot and republishes it to the store", async () => {
    const profile = applyFieldUpdate(
      applyFieldUpdate(createEmptyProfile(identifier.type, identifier.value, "t0"), "email", {
        value: "a@example.com",
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:01.000Z",
      }).profile,
      "phone",
      {
        value: "555-0100",
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:02.000Z",
      },
    ).profile;
    const seed = toSnapshot(profile, "updated", "2026-07-21T00:00:02.000Z");

    const deps = fakeDeps([seed]);
    const useCase = new RebuildProfileProjection(deps);
    const result = await useCase.execute({ identifier });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.fieldCount).toBe(2);
    expect(result.value.profile?.fields.get("email")?.value).toBe("a@example.com");
    expect(deps.current.get(identifier.value)?.fields.get("phone")?.value).toBe("555-0100");
  });

  it("does not inflate the profile version — a rebuild is a cache refresh, not a new fact", async () => {
    const profile = applyFieldUpdate(
      createEmptyProfile(identifier.type, identifier.value, "t0"),
      "email",
      {
        value: "a@example.com",
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:01.000Z",
      },
    ).profile;
    const seed = toSnapshot(profile, "created", "2026-07-21T00:00:01.000Z");

    const deps = fakeDeps([seed]);
    const useCase = new RebuildProfileProjection(deps);
    const result = await useCase.execute({ identifier });

    if (!result.ok) throw new Error("unreachable");
    expect(result.value.profile?.version).toBe(profile.version);
  });

  it("appends a 'rebuilt' snapshot and publishes ProfileRebuilt for audit purposes", async () => {
    const profile = applyFieldUpdate(
      createEmptyProfile(identifier.type, identifier.value, "t0"),
      "email",
      {
        value: "a@example.com",
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:01.000Z",
      },
    ).profile;
    const seed = toSnapshot(profile, "created", "2026-07-21T00:00:01.000Z");

    const deps = fakeDeps([seed]);
    const useCase = new RebuildProfileProjection(deps);
    await useCase.execute({ identifier });

    expect(deps.snapshots).toHaveLength(2);
    expect(deps.snapshots[1]?.reason).toBe("rebuilt");
    expect(deps.events).toHaveLength(1);
    expect(deps.events[0]?.eventName).toBe("profile.rebuilt");
  });
});
