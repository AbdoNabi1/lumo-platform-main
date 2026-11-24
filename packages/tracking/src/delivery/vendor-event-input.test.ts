import { beforeEach, describe, expect, it } from "vitest";

import { extractClickIds } from "../envelope/click-ids";
import type { EnrichedEnvelope } from "../envelope/envelope";
import { gaClientIdFromCookie, vendorEventInputFrom } from "./vendor-event-input";

function envelope(overrides: Partial<EnrichedEnvelope> = {}): EnrichedEnvelope {
  const pageUrl = new URL(
    "https://clinic.example/offers?utm_source=meta&ttclid=tt-click-1&ScCid=sc-click-1",
  );
  const clickIds = extractClickIds(
    (param) => pageUrl.searchParams.get(param),
    "2026-11-24T10:00:00.000Z",
  );
  return {
    eventId: "01919d1e-0000-7000-8000-000000000001",
    eventName: "form_submitted",
    eventVersion: 1,
    dedupId: "lead_0193a1b2-0000-7000-8000-000000000001",
    timestamp: "2026-11-24T10:00:00.123Z",
    receivedAt: "2026-11-24T10:00:01.000Z",
    eventTimestampMs: 1764000000123,
    source: "server",
    environment: "production",
    consent: { analytics: true, marketing: true, personalization: false },
    context: {
      page: { url: pageUrl.toString(), referrer: "https://ads.example/" },
      user: { customerId: "c-user" },
      technical: { clientIpAddress: "203.0.113.7", clientUserAgent: "Mozilla/5.0 (test)" },
      attribution: {
        clickIds,
        meta: { fbp: "fb.1.1764000000000.123456789", fbc: "fb.1.1764000000000.AbCdEf" },
        browserIds: {
          ttp: "ttp-abc",
          scid: "scid-xyz",
          gaClientId: "111111111.1764000000",
          gaSessionId: "1764000000",
        },
      },
    },
    properties: {},
    tenancy: { tenantId: "t-1" },
    ...overrides,
  } as EnrichedEnvelope;
}

describe("vendorEventInputFrom", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("projects ids, time, page, technical and browser identifiers", () => {
    const input = vendorEventInputFrom(envelope(), { em: "h-em" });
    expect(input).toEqual({
      eventName: "form_submitted",
      eventId: "lead_0193a1b2-0000-7000-8000-000000000001",
      eventTimeMs: 1764000000123,
      sourceUrl: "https://clinic.example/offers?utm_source=meta&ttclid=tt-click-1&ScCid=sc-click-1",
      referrer: "https://ads.example/",
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 (test)",
      customerId: "c-user",
      keys: { em: "h-em" },
      browser: {
        fbp: "fb.1.1764000000000.123456789",
        fbc: "fb.1.1764000000000.AbCdEf",
        ttp: "ttp-abc",
        scid: "scid-xyz",
        gaClientId: "111111111.1764000000",
        gaSessionId: "1764000000",
        ttclid: "tt-click-1",
        scClickId: "sc-click-1",
      },
      commerce: {
        valueMajor: null,
        currency: null,
        orderId: null,
        contentType: null,
        numItems: null,
        contentIds: [],
        contents: [],
      },
      consent: { adUserData: true, adPersonalization: true },
    });
  });

  it("prefers eventSourceUrl over url and prefers the identity customer id", () => {
    const base = envelope();
    const input = vendorEventInputFrom(
      envelope({
        context: {
          ...base.context,
          page: { url: "https://a.example/", eventSourceUrl: "https://b.example/landing" },
          identity: { customerId: "c-identity", hashStatus: "sha256" },
        },
      }),
      {},
    );
    expect(input.sourceUrl).toBe("https://b.example/landing");
    expect(input.customerId).toBe("c-identity");
  });

  it("returns nulls, not empty strings, for absent context", () => {
    const input = vendorEventInputFrom(envelope({ context: {} }), {});
    expect(input).toMatchObject({
      sourceUrl: null,
      referrer: null,
      ip: null,
      userAgent: null,
      customerId: null,
      browser: {
        fbp: null,
        fbc: null,
        ttp: null,
        scid: null,
        gaClientId: null,
        gaSessionId: null,
        ttclid: null,
        scClickId: null,
      },
    });
  });

  it("converts minor units and line items; quantity defaults to 1", () => {
    const input = vendorEventInputFrom(
      envelope({
        eventName: "purchase",
        payload: {
          valueMinor: 125000,
          currency: "EGP",
          orderId: "o-1",
          contentType: "product",
          contents: [
            { itemId: "p-1", quantity: 2, priceMinor: 50000 },
            { itemId: "p-2", priceMinor: 25000 },
            { itemId: "p-3" },
          ],
        },
      }),
      {},
    );
    expect(input.commerce).toEqual({
      valueMajor: 1250,
      currency: "EGP",
      orderId: "o-1",
      contentType: "product",
      numItems: 4,
      contentIds: ["p-1", "p-2", "p-3"],
      contents: [
        { id: "p-1", quantity: 2, itemPriceMajor: 500 },
        { id: "p-2", quantity: 1, itemPriceMajor: 250 },
        { id: "p-3", quantity: 1, itemPriceMajor: null },
      ],
    });
  });

  it("an explicit numItems and explicit contentIds win over derived ones", () => {
    const input = vendorEventInputFrom(
      envelope({
        payload: {
          numItems: 7,
          contentIds: ["x-1"],
          contents: [{ itemId: "p-1", quantity: 2 }],
        },
      }),
      {},
    );
    expect(input.commerce.numItems).toBe(7);
    expect(input.commerce.contentIds).toEqual(["x-1"]);
  });

  it("an ids-only payload keeps content ids and no contents", () => {
    const input = vendorEventInputFrom(envelope({ payload: { contentIds: ["p-9"] } }), {});
    expect(input.commerce.contentIds).toEqual(["p-9"]);
    expect(input.commerce.contents).toEqual([]);
  });

  it("consent: granular grants win, absent grants fall back to the marketing flag", () => {
    const base = envelope();
    const granular = vendorEventInputFrom(
      envelope({
        consent: {
          analytics: true,
          marketing: true,
          personalization: false,
          grants: { ad_user_data: true, ad_personalization: false },
        },
      }),
      {},
    );
    expect(granular.consent).toEqual({ adUserData: true, adPersonalization: false });

    const denied = vendorEventInputFrom(
      envelope({ consent: { ...base.consent, marketing: false } }),
      {},
    );
    expect(denied.consent).toEqual({ adUserData: false, adPersonalization: false });
  });
});

describe("gaClientIdFromCookie", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it.each([
    ["GA1.1.111111111.1764000000", "111111111.1764000000"],
    ["GA1.2.1.2", "1.2"],
    ["x", null],
    ["GA1.1.abc.def", null],
    ["GA1.1.1", null],
    ["", null],
    [undefined, null],
  ])("%j → %j", (cookie, expected) => {
    expect(gaClientIdFromCookie(cookie)).toBe(expected);
  });
});
