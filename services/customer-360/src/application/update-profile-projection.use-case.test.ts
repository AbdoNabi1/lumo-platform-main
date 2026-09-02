import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { DomainEvent } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { IdentifierType } from "@platform/tracking";
import type { CustomerProfile } from "../domain/customer-profile";
import type { ProfileSnapshot } from "../domain/profile-snapshot";
import type { ProfileHistoryStore } from "../ports/profile-history-store";
import type { ProfileStore } from "../ports/profile-store";
import { UpdateProfileProjection } from "./update-profile-projection.use-case";

const identifier = { type: "customer_id" as const, value: "cust-1" };

function fakeDeps() {
  const current = new Map<string, CustomerProfile>();
  const snapshots: ProfileSnapshot[] = [];
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
  const clock: Clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };

  return { profiles, history, unitOfWork, idGenerator, clock, current, snapshots, events };
}

describe("UpdateProfileProjection", () => {
  it("rejects a blank field name", async () => {
    const deps = fakeDeps();
    const useCase = new UpdateProfileProjection(deps);
    const result = await useCase.execute({
      identifier,
      field: "  ",
      value: "x",
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    expect(deps.snapshots).toHaveLength(0);
  });

  it("rejects a blank source", async () => {
    const deps = fakeDeps();
    const useCase = new UpdateProfileProjection(deps);
    const result = await useCase.execute({
      identifier,
      field: "email",
      value: "x",
      source: " ",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
  });

  it("creates a new profile and publishes ProfileCreated on the first field", async () => {
    const deps = fakeDeps();
    const useCase = new UpdateProfileProjection(deps);
    const result = await useCase.execute({
      identifier,
      field: "email",
      value: "a@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:01.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ applied: true, version: 1 });
    expect(deps.events).toHaveLength(1);
    expect(deps.events[0]?.eventName).toBe("profile.created");
    expect(deps.snapshots[0]?.reason).toBe("created");
  });

  it("publishes ProfileUpdated (not ProfileCreated) for a second field on an existing profile", async () => {
    const deps = fakeDeps();
    const useCase = new UpdateProfileProjection(deps);
    await useCase.execute({
      identifier,
      field: "email",
      value: "a@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:01.000Z",
    });
    const second = await useCase.execute({
      identifier,
      field: "phone",
      value: "555-0100",
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:02.000Z",
    });

    expect(second.ok).toBe(true);
    expect(deps.events).toHaveLength(2);
    expect(deps.events[1]?.eventName).toBe("profile.updated");
    expect(deps.snapshots[1]?.reason).toBe("updated");
  });

  it("returns applied:false and writes nothing for a stale update, without erroring", async () => {
    const deps = fakeDeps();
    const useCase = new UpdateProfileProjection(deps);
    await useCase.execute({
      identifier,
      field: "email",
      value: "current@example.com",
      source: "orders",
      confidence: "verified",
      occurredAt: "2026-07-21T00:00:05.000Z",
    });

    const stale = await useCase.execute({
      identifier,
      field: "email",
      value: "late@example.com",
      source: "loyalty",
      confidence: "inferred",
      occurredAt: "2026-07-21T00:00:02.000Z",
    });

    expect(stale.ok).toBe(true);
    if (!stale.ok) throw new Error("unreachable");
    expect(stale.value.applied).toBe(false);
    expect(deps.snapshots).toHaveLength(1); // only the first write, nothing from the stale attempt
    expect(deps.events).toHaveLength(1);
    expect(deps.current.get(identifier.value)?.fields.get("email")?.value).toBe(
      "current@example.com",
    );
  });
});
