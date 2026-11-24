import { describe, expect, it } from "vitest";
import type { IntegrationEvent } from "@platform/domain-events";
import type { Logger } from "@platform/utils";
import { InMemoryConsentProjectionStore, ProjectionConsentPort } from "./consent-projection";
import {
  ConsentChangedConsumer,
  type ConsentChangedPayload,
} from "../interfaces/consent-changed.consumer";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

function event(
  subject: string,
  scope: string,
  granted: boolean,
  occurredAt: string,
  tenantId = "tenant-a",
): IntegrationEvent<ConsentChangedPayload> {
  return {
    messageId: `${tenantId}-${subject}-${scope}-${occurredAt}`,
    type: "identity.customer.consent_changed",
    eventVersion: 1,
    aggregateId: subject,
    aggregateType: "customer",
    occurredAt,
    correlationId: "c",
    causationId: "c",
    tenantId,
    payload: { scope, granted },
    metadata: {},
  };
}

describe("consent projection (H-2)", () => {
  it("projects a grant then answers hasConsent via the port", async () => {
    const store = new InMemoryConsentProjectionStore();
    const consumer = new ConsentChangedConsumer({ store, logger: silent });
    const port = new ProjectionConsentPort(store);

    await consumer.handle(event("cust-1", "marketing", true, "2026-07-18T00:00:00.000Z"));
    expect(await port.hasConsent("cust-1", "marketing", "tenant-a")).toBe(true);
    expect(await port.hasConsent("cust-1", "analytics", "tenant-a")).toBe(false); // never granted ⇒ fail-closed
  });

  it("is last-writer-wins: an older redelivered event never regresses a newer decision", async () => {
    const store = new InMemoryConsentProjectionStore();
    const consumer = new ConsentChangedConsumer({ store, logger: silent });
    const port = new ProjectionConsentPort(store);

    await consumer.handle(event("cust-1", "marketing", false, "2026-07-18T10:00:00.000Z")); // newer: revoked
    await consumer.handle(event("cust-1", "marketing", true, "2026-07-18T09:00:00.000Z")); // older redelivery: grant
    expect(await port.hasConsent("cust-1", "marketing", "tenant-a")).toBe(false); // newer revoke wins
  });

  it("is idempotent on exact redelivery", async () => {
    const store = new InMemoryConsentProjectionStore();
    const consumer = new ConsentChangedConsumer({ store, logger: silent });
    const port = new ProjectionConsentPort(store);
    const e = event("cust-1", "marketing", true, "2026-07-18T00:00:00.000Z");
    await consumer.handle(e);
    await consumer.handle(e);
    expect(await port.hasConsent("cust-1", "marketing", "tenant-a")).toBe(true);
  });

  it("skips a malformed event (no subject) without throwing", async () => {
    const store = new InMemoryConsentProjectionStore();
    const consumer = new ConsentChangedConsumer({ store, logger: silent });
    await expect(
      consumer.handle(event("", "marketing", true, "2026-07-18T00:00:00.000Z")),
    ).resolves.toBeUndefined();
  });

  it("projects marketing_sms grant and revoke independently of marketing", async () => {
    expect.hasAssertions();
    const store = new InMemoryConsentProjectionStore();
    const consumer = new ConsentChangedConsumer({ store, logger: silent });
    const port = new ProjectionConsentPort(store);

    await consumer.handle(event("cust-1", "marketing", true, "2026-07-18T00:00:00.000Z"));
    expect(await port.hasConsent("cust-1", "marketing_sms", "tenant-a")).toBe(false);

    await consumer.handle(event("cust-1", "marketing_sms", true, "2026-07-18T01:00:00.000Z"));
    expect(await port.hasConsent("cust-1", "marketing_sms", "tenant-a")).toBe(true);
    expect(await port.hasConsent("cust-1", "marketing", "tenant-a")).toBe(true);

    await consumer.handle(event("cust-1", "marketing_sms", false, "2026-07-18T02:00:00.000Z"));
    expect(await port.hasConsent("cust-1", "marketing_sms", "tenant-a")).toBe(false);
    expect(await port.hasConsent("cust-1", "marketing", "tenant-a")).toBe(true);

    await consumer.handle(event("cust-1", "marketing", false, "2026-07-18T03:00:00.000Z"));
    await consumer.handle(event("cust-1", "marketing_sms", true, "2026-07-18T04:00:00.000Z"));
    expect(await port.hasConsent("cust-1", "marketing", "tenant-a")).toBe(false);
    expect(await port.hasConsent("cust-1", "marketing_sms", "tenant-a")).toBe(true);
  });

  it("never lets tenant B read tenant A's marketing_sms grant", async () => {
    expect.hasAssertions();
    const store = new InMemoryConsentProjectionStore();
    const consumer = new ConsentChangedConsumer({ store, logger: silent });
    const port = new ProjectionConsentPort(store);

    await consumer.handle(
      event("cust-1", "marketing_sms", true, "2026-07-18T00:00:00.000Z", "tenant-a"),
    );
    expect(await port.hasConsent("cust-1", "marketing_sms", "tenant-a")).toBe(true);
    expect(await port.hasConsent("cust-1", "marketing_sms", "tenant-b")).toBe(false);

    await consumer.handle(
      event("cust-1", "marketing_sms", false, "2026-07-18T01:00:00.000Z", "tenant-b"),
    );
    expect(await port.hasConsent("cust-1", "marketing_sms", "tenant-a")).toBe(true);
    expect(await port.hasConsent("cust-1", "marketing_sms", "tenant-b")).toBe(false);
  });
});
