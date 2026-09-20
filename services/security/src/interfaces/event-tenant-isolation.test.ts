import { describe, expect, it } from "vitest";
import type { IntegrationEvent } from "@platform/domain-events";
import { InMemoryConsentProjectionStore } from "../infrastructure/consent-projection";
import { InMemoryIdentityProjectionStore } from "../infrastructure/identity-projection";
import { ConsentChangedConsumer, type ConsentChangedPayload } from "./consent-changed.consumer";
import {
  IdentityUserCreatedConsumer,
  type IdentityUserCreatedPayload,
} from "./identity-projection.consumers";

/**
 * T10.5 case 3 — "an event published under A is not consumed into B's projections".
 *
 * WHAT THE CODE DOES TODAY (class D, G-64), stated so nobody reads these tests as the future design:
 * these consumers are built ONCE with `deps.tenantId` (`apps/runtime` passes `TENANT_DEFAULT_ID`),
 * and they never read `event.tenantId`. So the projection tenant is the deployment's, not the
 * event's. Consequences, each pinned below:
 *   - an event carrying tenant A is NOT written into tenant B's projection (the property asked for) —
 *     but only because it is written into the CONSUMER'S tenant instead, A's included;
 *   - it therefore does NOT land in A's projection either. Under `TENANT_MODE=multi` that is wrong for
 *     A, which is exactly why the worker refuses multi (`assertWorkerTenantModeSupported`).
 * When G-64 lands (tenantId required on the envelope, read per message) the "lands in the consumer's
 * tenant" assertions below MUST flip to "lands in the envelope's tenant" — a red test here is the
 * signal to update this file deliberately, not to loosen it.
 *
 * Layer: application (event consumer → in-memory projection store). No broker, no RLS.
 */
const CONSUMER_TENANT = "tenant-default";

function envelope<T>(type: string, tenantId: string, aggregateId: string, payload: T) {
  return {
    messageId: `msg-${type}-${tenantId}`,
    type,
    eventVersion: 1,
    aggregateId,
    aggregateType: "x",
    occurredAt: "2026-09-20T00:00:00.000Z",
    correlationId: "c",
    causationId: "c",
    tenantId,
    payload,
  } satisfies IntegrationEvent<T>;
}

const logger = { debug() {}, info() {}, warn() {}, error() {} } as never;

describe("event consumers vs tenant-scoped projections (T10.5 case 3, class D as-is)", () => {
  it("identity projection: A's event never reaches B's rows; it lands in the consumer's tenant, not A's", async () => {
    const store = new InMemoryIdentityProjectionStore();
    const consumer = new IdentityUserCreatedConsumer({ store, logger, tenantId: CONSUMER_TENANT });

    await consumer.handle(
      envelope<IdentityUserCreatedPayload>("identity.user.created", "tenant-a", "u1", {
        userId: "u1",
        tenantId: "tenant-a",
      }),
    );

    expect(await store.getUser("u1", "tenant-b")).toBeNull(); // the property asked for
    expect(await store.getUser("u1", CONSUMER_TENANT)).not.toBeNull(); // where it really went
    expect(await store.getUser("u1", "tenant-a")).toBeNull(); // the G-64 gap: A's own row is absent
  });

  it("consent projection: same shape — the envelope tenant is ignored", async () => {
    const store = new InMemoryConsentProjectionStore();
    const consumer = new ConsentChangedConsumer({ store, logger, tenantId: CONSUMER_TENANT });

    await consumer.handle(
      envelope<ConsentChangedPayload>("identity.customer.consent_changed", "tenant-a", "c1", {
        scope: "marketing",
        granted: true,
      }),
    );

    const has = async (tenant: string) =>
      (await store.get("c1", "marketing", tenant))?.granted === true;
    expect(await has("tenant-b")).toBe(false);
    expect(await has(CONSUMER_TENANT)).toBe(true);
    expect(await has("tenant-a")).toBe(false);
  });
});
