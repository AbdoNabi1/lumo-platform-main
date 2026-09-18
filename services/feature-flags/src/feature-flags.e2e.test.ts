import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireFeatureFlags } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wireFeatureFlags({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("feature-flags (end to end)", () => {
  it("runs the full lifecycle: create -> rollout -> evaluate via the FeatureFlags contract, publishing canonical events", async () => {
    const app = wire();
    const created = await app.featureFlags.create({
      key: "new-checkout",
      name: "New checkout flow",
      tenantId: "tenant-local",
    });
    expect(created.status).toBe(201);
    const flagId = (created.body as { flagId: string }).flagId;

    const rolled = await app.featureFlags.setRollout({
      flagId,
      percentage: 100,
      changedBy: "admin-1",
      tenantId: "tenant-local",
    });
    expect(rolled.status).toBe(200);

    const enabled = await app.evaluator.isEnabled("new-checkout", "tenant-local", {
      subjectId: "customer-1",
    });
    expect(enabled).toBe(true);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("feature_flags.flag.rollout_changed");
  });

  it("a kill switch disables the flag via the contract too", async () => {
    const app = wire();
    const created = await app.featureFlags.create({
      key: "risky-feature",
      name: "Risky",
      tenantId: "tenant-local",
    });
    const flagId = (created.body as { flagId: string }).flagId;
    await app.featureFlags.setRollout({
      flagId,
      percentage: 100,
      changedBy: "admin-1",
      tenantId: "tenant-local",
    });
    await app.featureFlags.advance({
      flagId,
      toStatus: "killed",
      changedBy: "admin-1",
      tenantId: "tenant-local",
    });

    const enabled = await app.evaluator.isEnabled("risky-feature", "tenant-local", {
      subjectId: "customer-1",
    });
    expect(enabled).toBe(false);
  });

  it("an unknown flag key evaluates to disabled, never throws", async () => {
    const app = wire();
    const enabled = await app.evaluator.isEnabled("does-not-exist", "tenant-local", {
      subjectId: "customer-1",
    });
    expect(enabled).toBe(false);
  });

  it("rejects creating a duplicate flag key (409)", async () => {
    const app = wire();
    await app.featureFlags.create({
      key: "new-checkout",
      name: "New checkout flow",
      tenantId: "tenant-local",
    });
    const response = await app.featureFlags.create({
      key: "new-checkout",
      name: "Duplicate",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(409);
  });

  it("rejects an out-of-range rollout percentage (409)", async () => {
    const app = wire();
    const created = await app.featureFlags.create({
      key: "new-checkout",
      name: "New checkout flow",
      tenantId: "tenant-local",
    });
    const flagId = (created.body as { flagId: string }).flagId;
    const response = await app.featureFlags.setRollout({
      flagId,
      percentage: 150,
      changedBy: "admin-1",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(409);
  });
});
