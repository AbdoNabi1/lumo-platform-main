import { describe, expect, it } from "vitest";

import type { TrackingEnvelope } from "../envelope/envelope";
import { MAX_BUSINESS_EVENT_AGE_MS, MAX_CLOCK_SKEW_MS, validateEnvelope } from "./validation";

const AT = Date.parse("2026-11-20T10:00:00.000Z");

function envelope(overrides: Partial<TrackingEnvelope> = {}): TrackingEnvelope {
  return {
    eventId: "e-1",
    eventName: "purchase",
    eventVersion: 1,
    dedupId: "ord_1",
    timestamp: new Date(AT).toISOString(),
    source: "server",
    eventOrigin: "server",
    consent: { analytics: false, marketing: false, personalization: false },
    context: {},
    properties: {},
    tenancy: { tenantId: "t-1" },
    ...overrides,
  };
}

const ageOf = (ms: number): Date => new Date(AT + ms);
const violationFields = (result: ReturnType<typeof validateEnvelope>): string[] =>
  result.valid ? [] : result.violations.map((v) => v.field);

describe("clock skew: 24 h for browsers, 7 days for server business events (P2-D7)", () => {
  it("keeps the 24 h window for a browser event and for a server event that is not a business conversion", () => {
    expect.hasAssertions();
    const dayAndAHalf = ageOf(MAX_CLOCK_SKEW_MS * 1.5);
    expect(
      violationFields(
        validateEnvelope(envelope({ eventOrigin: "browser", source: "web" }), { now: dayAndAHalf }),
      ),
    ).toEqual(["timestamp"]);
    expect(
      violationFields(
        validateEnvelope(envelope({ eventName: "page_viewed" }), { now: dayAndAHalf }),
      ),
    ).toEqual(["timestamp"]);
  });

  it("accepts every business conversion up to 7 days old when it is server-origin", () => {
    expect.hasAssertions();
    for (const eventName of ["purchase", "order_delivered", "order_cancelled", "form_submitted"]) {
      expect(
        validateEnvelope(envelope({ eventName }), { now: ageOf(MAX_BUSINESS_EVENT_AGE_MS) }),
      ).toEqual({ valid: true });
    }
  });

  it("refuses one past 7 days", () => {
    expect.hasAssertions();
    expect(
      violationFields(validateEnvelope(envelope(), { now: ageOf(MAX_BUSINESS_EVENT_AGE_MS + 1) })),
    ).toEqual(["timestamp"]);
  });

  it("keeps refusing a future time for a business event", () => {
    expect.hasAssertions();
    const future = envelope({ timestamp: new Date(AT + 3_600_000).toISOString() });
    expect(violationFields(validateEnvelope(future, { now: new Date(AT) }))).toEqual(["timestamp"]);
  });
});
