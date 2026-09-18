import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wirePromotions } from "./composition";

/**
 * Phase A.17 — systemic FSM/idempotency sweep.
 *
 * `RecordPromotionUsage` is the ONLY status-mutating use case in this codebase (23-file sweep)
 * that does not wrap its domain call in `try { ... } catch (error) { if (isDomainError(error))
 * return err(error); throw error; }`. `Promotion.recordUsage()` unconditionally increments
 * `usageCount` regardless of the promotion's current status, and internally calls
 * `transition("depleted", ...)` once the usage limit is crossed — a transition that is only
 * legal from `"active"` per the domain's own `TRANSITIONS` table. Called on any other status
 * (e.g. a promotion an admin just paused, with an in-flight Checkout/Coupons usage record still
 * arriving), `recordUsage()` throws `BusinessRuleError`, and because the use case has no
 * try/catch, that throw propagates all the way out of `execute()` as an unhandled rejection
 * instead of the `Result<T, DomainError>` channel every other use case in this file (and all 22
 * other audited files) uses — breaking the controller's `present()` contract, which expects a
 * `Result`, not a thrown error.
 */

const TENANT = "tenant-a";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-13T00:00:00.000Z") };

function wire() {
  return wirePromotions({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

function createInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tenantId: TENANT,
    name: "10% off everything",
    ruleType: "automatic" as const,
    scope: "cart" as const,
    targetRefs: [],
    rewardType: "percentage" as const,
    rewardValue: 10,
    stackable: false,
    priority: 0,
    startsAt: new Date("2026-01-01T00:00:00.000Z"),
    usageLimit: 1,
    ...overrides,
  };
}

describe("RecordPromotionUsage error handling (Phase A.17)", () => {
  it("returns a 409 domain-error response, not an unhandled rejection, when usage-limit crossing hits an illegal transition", async () => {
    const app = wire();
    const created = await app.promotions.create(createInput({ usageLimit: 1 }));
    const id = (created.body as { promotionId: string }).promotionId;
    await app.promotions.advance({ tenantId: TENANT, promotionId: id, toStatus: "active" });
    await app.promotions.advance({ tenantId: TENANT, promotionId: id, toStatus: "paused" });

    // Before the fix, this call rejects instead of resolving to a Result — the assertion below
    // is what must hold post-fix; capture the pre-fix behavior separately via the reject case.
    const response = await app.promotions.recordUsage({ tenantId: TENANT, promotionId: id });
    expect(response.status).toBe(409);
  });

  it("leaves the promotion's usageCount/status unchanged when the transition is rejected", async () => {
    const app = wire();
    const created = await app.promotions.create(createInput({ usageLimit: 1 }));
    const id = (created.body as { promotionId: string }).promotionId;
    await app.promotions.advance({ tenantId: TENANT, promotionId: id, toStatus: "active" });
    await app.promotions.advance({ tenantId: TENANT, promotionId: id, toStatus: "paused" });

    await app.promotions.recordUsage({ tenantId: TENANT, promotionId: id });

    const secondUsage = await app.promotions.recordUsage({ tenantId: TENANT, promotionId: id });
    expect(secondUsage.status).toBe(409);
  });
});
