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
): IntegrationEvent<ConsentChangedPayload> {
  return {
    messageId: `${subject}-${occurredAt}`,
    type: "identity.customer.consent_changed",
    eventVersion: 1,
    aggregateId: subject,
    aggregateType: "customer",
    occurredAt,
    correlationId: "c",
    causationId: "c",
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
    expect(await port.hasConsent("cust-1", "marketing")).toBe(true);
    expect(await port.hasConsent("cust-1", "analytics")).toBe(false); // never granted ⇒ fail-closed
  });

  it("is last-writer-wins: an older redelivered event never regresses a newer decision", async () => {
    const store = new InMemoryConsentProjectionStore();
    const consumer = new ConsentChangedConsumer({ store, logger: silent });
    const port = new ProjectionConsentPort(store);

    await consumer.handle(event("cust-1", "marketing", false, "2026-07-18T10:00:00.000Z")); // newer: revoked
    await consumer.handle(event("cust-1", "marketing", true, "2026-07-18T09:00:00.000Z")); // older redelivery: grant
    expect(await port.hasConsent("cust-1", "marketing")).toBe(false); // newer revoke wins
  });

  it("is idempotent on exact redelivery", async () => {
    const store = new InMemoryConsentProjectionStore();
    const consumer = new ConsentChangedConsumer({ store, logger: silent });
    const port = new ProjectionConsentPort(store);
    const e = event("cust-1", "marketing", true, "2026-07-18T00:00:00.000Z");
    await consumer.handle(e);
    await consumer.handle(e);
    expect(await port.hasConsent("cust-1", "marketing")).toBe(true);
  });

  it("skips a malformed event (no subject) without throwing", async () => {
    const store = new InMemoryConsentProjectionStore();
    const consumer = new ConsentChangedConsumer({ store, logger: silent });
    await expect(
      consumer.handle(event("", "marketing", true, "2026-07-18T00:00:00.000Z")),
    ).resolves.toBeUndefined();
  });
});
