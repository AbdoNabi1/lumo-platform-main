import { describe, expect, it } from "vitest";

import { syntheticGaClientId } from "../business/ga4-client-id";
import type { EnrichedEnvelope } from "../envelope/envelope";
import { buildVendorPayload, GA4_MAX_EVENT_AGE_MS } from "./vendor-builders";
import { vendorEventInputFrom, type VendorEventInput } from "./vendor-event-input";

const EVENT_TIME = 1_795_000_000_000;

function envelope(overrides: Partial<EnrichedEnvelope> = {}): EnrichedEnvelope {
  return {
    eventId: "01919d1e-0000-7000-8000-000000000001",
    eventName: "purchase",
    eventVersion: 1,
    dedupId: "ord_0193a1b2-0000-7000-8000-000000000001",
    timestamp: new Date(EVENT_TIME).toISOString(),
    receivedAt: new Date(EVENT_TIME + 1000).toISOString(),
    eventTimestampMs: EVENT_TIME,
    source: "server",
    eventOrigin: "server",
    environment: "production",
    consent: { analytics: true, marketing: true, personalization: false },
    tenancy: { tenantId: "t-1" },
    context: { page: { eventSourceUrl: "https://shop.example/" } },
    properties: {},
    payload: { valueMinor: 100_000, currency: "EGP", orderId: "o-1" },
    ...overrides,
  };
}

function input(overrides: Partial<EnvelopeInput> = {}): VendorEventInput {
  return vendorEventInputFrom(envelope(overrides.envelope), {}, overrides.nowMs);
}
interface EnvelopeInput {
  envelope?: Partial<EnrichedEnvelope>;
  nowMs?: number;
}

describe("GA4 72-hour window", () => {
  it("builds at exactly 72 h, refuses a millisecond later, and does not judge without a clock", () => {
    expect.hasAssertions();
    const target = { id: "G-ABCD1234" };
    const at = (offset: number): number => EVENT_TIME + GA4_MAX_EVENT_AGE_MS + offset;

    expect(buildVendorPayload("ga4.mp", input({ nowMs: at(0) }), target).ok).toBe(true);
    expect(buildVendorPayload("ga4.mp", input({ nowMs: at(1) }), target)).toEqual({
      ok: false,
      reason: "ga4 window passed",
    });
    expect(buildVendorPayload("ga4.mp", input(), target).ok).toBe(true);
  });

  it("does not refuse the other vendors for the same age (their windows are longer)", () => {
    expect.hasAssertions();
    const old = input({ nowMs: EVENT_TIME + 6 * 24 * 3_600_000 });
    const withKeys = { ...old, keys: { em: "hash" } };
    expect(buildVendorPayload("meta.capi.v27", withKeys, { id: "1" }).ok).toBe(true);
    expect(buildVendorPayload("snap.capi.v3", withKeys, { id: "1" }).ok).toBe(true);
  });
});

describe("GA4 client id for server events (P2-D7)", () => {
  it("uses the real client id when the envelope carries one", () => {
    expect.hasAssertions();
    const real = input({
      envelope: {
        context: {
          page: { eventSourceUrl: "https://shop.example/" },
          attribution: { browserIds: { gaClientId: "1111111111.1764000000" } },
        },
      },
    });
    expect(real.browser.gaClientId).toBe("1111111111.1764000000");
  });

  it("derives a stable id from the visitor, else from the business id, for a server event", () => {
    expect.hasAssertions();
    const visitor = (id: string): VendorEventInput =>
      input({
        envelope: {
          context: {
            page: { eventSourceUrl: "https://shop.example/" },
            session: { visitorId: id },
          },
        },
      });
    expect(visitor("v-1").browser.gaClientId).toBe(syntheticGaClientId("v-1"));
    expect(visitor("v-1").browser.gaClientId).toBe(visitor("v-1").browser.gaClientId);
    expect(visitor("v-2").browser.gaClientId).not.toBe(visitor("v-1").browser.gaClientId);
    expect(input().browser.gaClientId).toBe(
      syntheticGaClientId("ord_0193a1b2-0000-7000-8000-000000000001"),
    );
  });

  it("never invents one for a browser event: it is still refused as unavailable", () => {
    expect.hasAssertions();
    const browser = input({ envelope: { eventOrigin: "browser", source: "web" } });
    expect(browser.browser.gaClientId).toBeNull();
    expect(buildVendorPayload("ga4.mp", browser, { id: "G-ABCD1234" })).toEqual({
      ok: false,
      reason: "ga4 client_id unavailable",
    });
  });
});
