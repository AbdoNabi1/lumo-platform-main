import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { applyConsentPolicy } from "../envelope/consent";
import type { EnrichedEnvelope, TrackingEnvelope } from "../envelope/envelope";
import { isBusinessConversion } from "../enrichment/business-conversion";
import { buildVendorPayload } from "../delivery/vendor-builders";
import { vendorEventInputFrom } from "../delivery/vendor-event-input";
import { MATCH_PLATFORM_OF, type VendorBuilderKey } from "../delivery/vendor-event-names";
import type { HashPort } from "../ids/dedup-id";
import { normalizeIdentity } from "../pipeline/normalization";
import { platformMatchKeys } from "../pipeline/platform-identity";
import { validateEnvelope } from "../pipeline/validation";
import { businessMessageId } from "./event-uuid";
import { syntheticGaClientId } from "./ga4-client-id";
import { cancelledEnvelope, deliveredEnvelope, purchaseEnvelope } from "./order-events";
import type {
  BusinessEventContext,
  OrderTrackingReadModel,
  TransitionEventContext,
} from "./order-read-model";

const hasher: HashPort = {
  sha256Hex: async (s) => createHash("sha256").update(s, "utf8").digest("hex"),
};
const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

const TENANT = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "0193a1b2-0000-7000-8000-0000000000aa";
const PLACED_AT = "2026-11-27T10:00:00.000Z";
const NOW = new Date("2026-11-27T10:00:05.000Z");
const STORE_URL = "https://shop.example/";
const PAGE_URL = "https://shop.example/checkout";
const CLICK_AT = "2026-11-27T09:00:00.000Z";

const CTX: BusinessEventContext = { tenantId: TENANT, storeUrl: STORE_URL };

function order(overrides: Partial<OrderTrackingReadModel> = {}): OrderTrackingReadModel {
  return {
    orderId: ORDER_ID,
    orderNumber: "1042",
    currency: "EGP",
    totals: {
      subtotalMinor: 120_000,
      discountMinor: 20_000,
      taxMinor: 14_000,
      shippingMinor: 5_000,
      totalMinor: 119_000,
      taxIncluded: false,
    },
    lines: [
      {
        productRef: "prod-1",
        variantRef: "var-1",
        sku: "SKU-1",
        name: "Linen shirt",
        unitPriceMinor: 50_000,
        quantity: 2,
      },
      { productRef: "prod-2", name: "Belt", unitPriceMinor: 20_000, quantity: 1 },
    ],
    customer: {
      customerRef: "cust-1",
      email: "Test@Example.com",
      phone: "01012345678",
      name: "Ahmed Ali Hassan",
    },
    shipping: { city: "Cairo", province: "Cairo", country: "EG", recipientName: "Ahmed Ali" },
    checkoutRef: "chk-1",
    placedAt: PLACED_AT,
    snapshot: {
      visitorId: "visitor-1",
      sessionId: "sess-1",
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 (test)",
      pageUrl: PAGE_URL,
      referrer: "https://www.instagram.com/",
      cookies: {
        fbp: "fb.1.1764000000000.123456789",
        fbc: `fb.1.${String(Date.parse(CLICK_AT))}.AbCdEf`,
        ttp: "ttp-abc",
        scid: "scid-xyz",
        ga: "GA1.1.1111111111.1764000000",
      },
      clickIds: [
        { name: "ttclid", value: "tt-click-1", capturedAt: CLICK_AT },
        { name: "scclid", value: "sc-click-1", capturedAt: CLICK_AT },
      ],
      utm: { source: "meta", medium: "paid", campaign: "eid" },
    },
    ...overrides,
  };
}

const BUILDERS: readonly VendorBuilderKey[] = [
  "meta.capi.v27",
  "tiktok.events.v1_3",
  "snap.capi.v3",
  "ga4.mp",
];

/** What ingest does between the mapper and the builder: complete, stamp consent, normalise + hash identity. */
function complete(envelope: TrackingEnvelope, now: Date): EnrichedEnvelope {
  return {
    ...envelope,
    dedupId: envelope.dedupId!,
    eventTimestampMs: Date.parse(envelope.timestamp),
    receivedAt: now.toISOString(),
    environment: "production",
    tenancy: { ...envelope.tenancy, tenantId: TENANT },
    consent: applyConsentPolicy(envelope.consent, "notice_only", now),
  };
}

async function payloads(
  envelope: TrackingEnvelope,
  now: Date,
): Promise<Record<VendorBuilderKey, ReturnType<typeof buildVendorPayload>>> {
  const completed = complete(envelope, now);
  const normalized = normalizeIdentity(completed.context.identity ?? {}, {
    defaultCountryCode: "20",
  });
  const out = {} as Record<VendorBuilderKey, ReturnType<typeof buildVendorPayload>>;
  for (const builder of BUILDERS) {
    const keys = await platformMatchKeys(MATCH_PLATFORM_OF[builder], normalized, hasher);
    out[builder] = buildVendorPayload(
      builder,
      vendorEventInputFrom(completed, keys, now.getTime()),
      { id: "TARGET-1" },
    );
  }
  return out;
}

function payloadOf(result: ReturnType<typeof buildVendorPayload>): Record<string, unknown> {
  if (!result.ok) throw new Error(`build refused: ${result.reason}`);
  return result.payload as Record<string, unknown>;
}

describe("purchaseEnvelope", () => {
  it("builds the server-origin purchase envelope for an order", () => {
    expect.hasAssertions();
    const envelope = purchaseEnvelope(order(), CTX);

    expect(envelope).toMatchObject({
      eventName: "purchase",
      eventVersion: 1,
      dedupId: `ord_${ORDER_ID}`,
      eventId: businessMessageId(TENANT, `ord_${ORDER_ID}`),
      timestamp: PLACED_AT,
      source: "server",
      eventOrigin: "server",
      actionSource: "website",
      eventType: "track",
      eventCategory: "commerce",
      environment: "production",
      tenancy: { tenantId: TENANT },
      payload: {
        valueMinor: 100_000,
        currency: "EGP",
        orderId: ORDER_ID,
        transactionId: ORDER_ID,
        taxMinor: 14_000,
        shippingMinor: 5_000,
        discountMinor: 20_000,
        numItems: 3,
        contentIds: ["var-1", "prod-2"],
        contentType: "product",
        contents: [
          { itemId: "var-1", sku: "SKU-1", name: "Linen shirt", quantity: 2, priceMinor: 50_000 },
          { itemId: "prod-2", name: "Belt", quantity: 1, priceMinor: 20_000 },
        ],
      },
      context: {
        page: { eventSourceUrl: PAGE_URL, url: PAGE_URL, referrer: "https://www.instagram.com/" },
        session: { visitorId: "visitor-1", sessionId: "sess-1" },
        technical: { clientIpAddress: "203.0.113.7", clientUserAgent: "Mozilla/5.0 (test)" },
        attribution: {
          utmSource: "meta",
          utmMedium: "paid",
          utmCampaign: "eid",
          meta: { fbp: "fb.1.1764000000000.123456789" },
          browserIds: { ttp: "ttp-abc", scid: "scid-xyz", gaClientId: "1111111111.1764000000" },
        },
        identity: {
          hashStatus: "raw",
          customerId: "cust-1",
          visitorId: "visitor-1",
          email: "Test@Example.com",
          phone: "+201012345678",
          firstName: "Ahmed",
          lastName: "Ali Hassan",
          city: "Cairo",
          state: "Cairo",
          country: "EG",
        },
      },
    });
    expect(envelope.context.attribution?.clickIds).toEqual([
      { name: "ttclid", value: "tt-click-1", capturedAt: CLICK_AT },
      { name: "scclid", value: "sc-click-1", capturedAt: CLICK_AT },
    ]);
    // The framework the stamped consent will be judged under is the store's, not the mapper's.
    expect(envelope.consent.marketing).toBe(false);
  });

  it("is deterministic: the same order maps to the same envelope", () => {
    expect.hasAssertions();
    expect(purchaseEnvelope(order(), CTX)).toEqual(purchaseEnvelope(order(), CTX));
  });

  it("is a business conversion and passes validation at ingest", () => {
    expect.hasAssertions();
    const envelope = purchaseEnvelope(order(), CTX);
    expect(isBusinessConversion(envelope)).toBe(true);
    expect(validateEnvelope(envelope, { now: NOW })).toEqual({ valid: true });
  });

  it("falls back to the store url when there is no snapshot, and still maps identity", () => {
    expect.hasAssertions();
    const envelope = purchaseEnvelope(order({ snapshot: undefined }), CTX);
    expect(envelope.context.page?.eventSourceUrl).toBe(STORE_URL);
    expect(envelope.context.page?.url).toBeUndefined();
    expect(envelope.context.technical).toBeUndefined();
    expect(envelope.context.identity?.email).toBe("Test@Example.com");
    expect(envelope.context.attribution?.browserIds).toBeUndefined();
  });

  it("falls back to the store url when the snapshot has no page url", () => {
    expect.hasAssertions();
    const envelope = purchaseEnvelope(order({ snapshot: { visitorId: "visitor-1" } }), CTX);
    expect(envelope.context.page?.eventSourceUrl).toBe(STORE_URL);
  });

  it("takes the phone from the shipping address when the customer has none, normalised from the currency", () => {
    expect.hasAssertions();
    const envelope = purchaseEnvelope(
      order({
        customer: { email: "test@example.com" },
        shipping: { phone: "01012345678", recipientName: "Mona Said" },
      }),
      CTX,
    );
    expect(envelope.context.identity).toMatchObject({
      phone: "+201012345678",
      firstName: "Mona",
      lastName: "Said",
    });
  });

  it("normalises a Saudi national number with the Saudi code", () => {
    expect.hasAssertions();
    const envelope = purchaseEnvelope(
      order({ currency: "SAR", customer: { phone: "0512345678" } }),
      CTX,
    );
    expect(envelope.context.identity?.phone).toBe("+966512345678");
  });

  it("drops a phone that cannot be normalised instead of guessing", () => {
    expect.hasAssertions();
    const envelope = purchaseEnvelope(order({ customer: { phone: "123" } }), CTX);
    expect(envelope.context.identity?.phone).toBeUndefined();
  });

  it("ignores click ids with an unknown name and keeps no empty blocks", () => {
    expect.hasAssertions();
    const envelope = purchaseEnvelope(
      order({
        snapshot: { clickIds: [{ name: "nope", value: "x", capturedAt: CLICK_AT }] },
      }),
      CTX,
    );
    expect(envelope.context.attribution?.clickIds).toBeUndefined();
  });

  it("an order total of discounts bigger than the subtotal reports zero, not a negative value", () => {
    expect.hasAssertions();
    const envelope = purchaseEnvelope(
      order({ totals: { ...order().totals, subtotalMinor: 1_000, discountMinor: 9_000 } }),
      CTX,
    );
    expect(envelope.payload?.valueMinor).toBe(0);
  });

  it("refuses an order id that cannot be a business reference", () => {
    expect.hasAssertions();
    expect(() => purchaseEnvelope(order({ orderId: "bad id!" }), CTX)).toThrow(RangeError);
  });
});

describe("deliveredEnvelope and cancelledEnvelope", () => {
  const DELIVERED_AT = "2026-11-29T12:00:00.000Z";
  const transition: TransitionEventContext = { ...CTX, occurredAt: DELIVERED_AT };

  it("use their own business id and the transition time, and share the order id and value", () => {
    expect.hasAssertions();
    const delivered = deliveredEnvelope(order(), transition);
    const cancelled = cancelledEnvelope(order(), transition);

    expect(delivered).toMatchObject({
      eventName: "order_delivered",
      dedupId: `dlv_${ORDER_ID}`,
      eventId: businessMessageId(TENANT, `dlv_${ORDER_ID}`),
      timestamp: DELIVERED_AT,
      eventOrigin: "server",
      payload: { orderId: ORDER_ID, valueMinor: 100_000, currency: "EGP" },
    });
    expect(cancelled).toMatchObject({
      eventName: "order_cancelled",
      dedupId: `cnl_${ORDER_ID}`,
      eventId: businessMessageId(TENANT, `cnl_${ORDER_ID}`),
      timestamp: DELIVERED_AT,
      eventOrigin: "server",
      payload: { orderId: ORDER_ID, valueMinor: 100_000, currency: "EGP" },
    });
    expect(
      new Set([purchaseEnvelope(order(), CTX).eventId, delivered.eventId, cancelled.eventId]).size,
    ).toBe(3);
    expect(isBusinessConversion(delivered)).toBe(true);
    expect(isBusinessConversion(cancelled)).toBe(true);
    expect(validateEnvelope(delivered, { now: new Date("2026-11-29T12:00:05.000Z") })).toEqual({
      valid: true,
    });
  });

  it("refuse a transition without a usable time", () => {
    expect.hasAssertions();
    expect(() => deliveredEnvelope(order(), { ...CTX, occurredAt: "" })).toThrow(RangeError);
    expect(() => cancelledEnvelope(order(), { ...CTX, occurredAt: "not a date" })).toThrow(
      RangeError,
    );
  });
});

describe("vendor payloads (golden)", () => {
  const H = {
    email: sha("test@example.com"),
    phoneDigits: sha("201012345678"),
    phonePlus: sha("+201012345678"),
    first: sha("ahmed"),
    last: sha("alihassan"),
    city: sha("cairo"),
    state: sha("cairo"),
    country: sha("eg"),
  };
  const SECONDS = Math.floor(Date.parse(PLACED_AT) / 1000);
  const DEDUP = `ord_${ORDER_ID}`;
  const FBC = `fb.1.${String(Date.parse(CLICK_AT))}.AbCdEf`;

  it("Purchase on Meta", async () => {
    expect.hasAssertions();
    const built = await payloads(purchaseEnvelope(order(), CTX), NOW);
    expect(payloadOf(built["meta.capi.v27"])).toEqual({
      data: [
        {
          event_name: "Purchase",
          event_time: SECONDS,
          event_id: DEDUP,
          action_source: "website",
          event_source_url: PAGE_URL,
          user_data: {
            em: [H.email],
            ph: [H.phoneDigits],
            fn: [H.first],
            ln: [H.last],
            ct: [H.city],
            st: [H.state],
            country: [H.country],
            client_ip_address: "203.0.113.7",
            client_user_agent: "Mozilla/5.0 (test)",
            fbp: "fb.1.1764000000000.123456789",
            fbc: FBC,
          },
          custom_data: {
            value: 1000,
            currency: "EGP",
            content_ids: ["var-1", "prod-2"],
            contents: [
              { id: "var-1", quantity: 2, item_price: 500 },
              { id: "prod-2", quantity: 1, item_price: 200 },
            ],
            content_type: "product",
            num_items: 3,
            order_id: ORDER_ID,
          },
        },
      ],
    });
  });

  it("Purchase on TikTok", async () => {
    expect.hasAssertions();
    const built = await payloads(purchaseEnvelope(order(), CTX), NOW);
    expect(payloadOf(built["tiktok.events.v1_3"])).toEqual({
      event_source: "web",
      event_source_id: "TARGET-1",
      data: [
        {
          event: "Purchase",
          event_time: SECONDS,
          event_id: DEDUP,
          user: {
            email: H.email,
            phone: H.phonePlus,
            ttclid: "tt-click-1",
            ttp: "ttp-abc",
            ip: "203.0.113.7",
            user_agent: "Mozilla/5.0 (test)",
          },
          properties: {
            value: 1000,
            currency: "EGP",
            content_type: "product",
            contents: [
              { content_id: "var-1", quantity: 2, price: 500 },
              { content_id: "prod-2", quantity: 1, price: 200 },
            ],
            order_id: ORDER_ID,
          },
          page: { url: PAGE_URL, referrer: "https://www.instagram.com/" },
        },
      ],
    });
  });

  it("PURCHASE on Snap", async () => {
    expect.hasAssertions();
    const built = await payloads(purchaseEnvelope(order(), CTX), NOW);
    expect(payloadOf(built["snap.capi.v3"])).toEqual({
      data: [
        {
          event_name: "PURCHASE",
          event_time: SECONDS,
          event_id: DEDUP,
          action_source: "WEB",
          event_source_url: PAGE_URL,
          user_data: {
            em: [H.email],
            ph: [H.phoneDigits],
            fn: [H.first],
            ln: [H.last],
            ct: [H.city],
            st: [H.state],
            country: [H.country],
            client_ip_address: "203.0.113.7",
            client_user_agent: "Mozilla/5.0 (test)",
            sc_click_id: "sc-click-1",
            sc_cookie1: "scid-xyz",
          },
          custom_data: {
            value: 1000,
            currency: "EGP",
            content_ids: ["var-1", "prod-2"],
            num_items: "3",
            order_id: ORDER_ID,
          },
        },
      ],
    });
  });

  it("purchase on GA4 uses the real _ga client id and the order id as transaction_id", async () => {
    expect.hasAssertions();
    const built = await payloads(purchaseEnvelope(order(), CTX), NOW);
    expect(payloadOf(built["ga4.mp"])).toEqual({
      client_id: "1111111111.1764000000",
      user_id: "cust-1",
      timestamp_micros: Date.parse(PLACED_AT) * 1000,
      consent: { ad_user_data: "GRANTED", ad_personalization: "DENIED" },
      user_data: {
        sha256_email_address: [H.email],
        sha256_phone_number: [H.phonePlus],
        address: [
          {
            sha256_first_name: H.first,
            sha256_last_name: H.last,
            city: "cairo",
            region: "cairo",
            country: "EG",
          },
        ],
      },
      events: [
        {
          name: "purchase",
          params: {
            engagement_time_msec: 1,
            page_location: PAGE_URL,
            transaction_id: ORDER_ID,
            value: 1000,
            currency: "EGP",
            items: [
              { item_id: "var-1", quantity: 2, price: 500 },
              { item_id: "prod-2", quantity: 1, price: 200 },
            ],
          },
        },
      ],
    });
  });

  it("delivered and cancelled use the vendor custom names, their own event ids, and GA4 refund keeps the purchase's transaction_id", async () => {
    expect.hasAssertions();
    const at = "2026-11-29T12:00:00.000Z";
    const now = new Date("2026-11-29T12:00:05.000Z");
    const transition = { ...CTX, occurredAt: at };
    const delivered = await payloads(deliveredEnvelope(order(), transition), now);
    const cancelled = await payloads(cancelledEnvelope(order(), transition), now);
    const purchase = await payloads(purchaseEnvelope(order(), CTX), NOW);

    const metaDelivered = payloadOf(delivered["meta.capi.v27"]).data as Record<string, unknown>[];
    expect(metaDelivered[0]).toMatchObject({
      event_name: "OrderDelivered",
      event_id: `dlv_${ORDER_ID}`,
    });
    const tiktokCancelled = payloadOf(cancelled["tiktok.events.v1_3"]).data as Record<
      string,
      unknown
    >[];
    expect(tiktokCancelled[0]).toMatchObject({
      event: "OrderCancelled",
      event_id: `cnl_${ORDER_ID}`,
    });
    const snapDelivered = payloadOf(delivered["snap.capi.v3"]).data as Record<string, unknown>[];
    expect(snapDelivered[0]).toMatchObject({ event_name: "CUSTOM_EVENT_1" });
    const snapCancelled = payloadOf(cancelled["snap.capi.v3"]).data as Record<string, unknown>[];
    expect(snapCancelled[0]).toMatchObject({ event_name: "CUSTOM_EVENT_5" });

    const refund = payloadOf(cancelled["ga4.mp"]).events as {
      name: string;
      params: Record<string, unknown>;
    }[];
    const ga4Purchase = payloadOf(purchase["ga4.mp"]).events as {
      name: string;
      params: Record<string, unknown>;
    }[];
    expect(refund[0]!.name).toBe("refund");
    expect(refund[0]!.params.transaction_id).toBe(ga4Purchase[0]!.params.transaction_id);
    expect(refund[0]!.params).toMatchObject({ value: 1000, currency: "EGP" });
  });

  it("sends no raw email, phone or name to any vendor", async () => {
    expect.hasAssertions();
    const built = await payloads(purchaseEnvelope(order(), CTX), NOW);
    const text = JSON.stringify(Object.values(built).map(payloadOf));
    for (const raw of [
      "test@example.com",
      "Test@Example.com",
      "01012345678",
      "201012345678",
      "Ahmed",
      "ahmed",
    ]) {
      expect(text).not.toContain(raw);
    }
  });

  it("builds on all four vendors for an order with no snapshot (identity only, store url, synthetic GA4 id)", async () => {
    expect.hasAssertions();
    const envelope = purchaseEnvelope(order({ snapshot: undefined }), CTX);
    const built = await payloads(envelope, NOW);
    for (const builder of BUILDERS) expect(built[builder].ok, builder).toBe(true);

    const meta = payloadOf(built["meta.capi.v27"]).data as { event_source_url: string }[];
    expect(meta[0]!.event_source_url).toBe(STORE_URL);
    const ga4 = payloadOf(built["ga4.mp"]);
    // No visitor, so the seed is the business id: `ord_<orderId>`.
    expect(ga4.client_id).toBe(syntheticGaClientId(`ord_${ORDER_ID}`));
  });

  it("the synthetic GA4 client id is stable per visitor, differs per visitor, and a real _ga wins", async () => {
    expect.hasAssertions();
    const bare = (visitorId: string): OrderTrackingReadModel =>
      order({ snapshot: { visitorId, pageUrl: PAGE_URL } });

    const clientIdOf = async (model: OrderTrackingReadModel): Promise<unknown> =>
      payloadOf((await payloads(purchaseEnvelope(model, CTX), NOW))["ga4.mp"]).client_id;

    const a1 = await clientIdOf(bare("visitor-a"));
    const a2 = await clientIdOf(bare("visitor-a"));
    const b = await clientIdOf(bare("visitor-b"));
    expect(a1).toBe(a2);
    expect(a1).toBe(syntheticGaClientId("visitor-a"));
    expect(b).not.toBe(a1);
    expect(a1).toMatch(/^\d{10}\.\d{10}$/);

    const real = await clientIdOf(order());
    expect(real).toBe("1111111111.1764000000");
  });

  it("a 6-day-old purchase is accepted by validation and by Meta, TikTok and Snap, but GA4 is blocked with a reason", async () => {
    expect.hasAssertions();
    const sixDays = new Date(Date.parse(PLACED_AT) + 6 * 24 * 60 * 60 * 1000);
    const envelope = purchaseEnvelope(order(), CTX);
    expect(validateEnvelope(envelope, { now: sixDays })).toEqual({ valid: true });

    const built = await payloads(envelope, sixDays);
    expect(built["meta.capi.v27"].ok).toBe(true);
    expect(built["tiktok.events.v1_3"].ok).toBe(true);
    expect(built["snap.capi.v3"].ok).toBe(true);
    expect(built["ga4.mp"]).toEqual({ ok: false, reason: "ga4 window passed" });
  });

  it("a 2-day-old purchase is still sent to GA4, and a 73-hour-old one is not", async () => {
    expect.hasAssertions();
    const envelope = purchaseEnvelope(order(), CTX);
    const at = (hours: number): Date => new Date(Date.parse(PLACED_AT) + hours * 3_600_000);
    expect((await payloads(envelope, at(48)))["ga4.mp"].ok).toBe(true);
    expect((await payloads(envelope, at(72)))["ga4.mp"].ok).toBe(true);
    expect((await payloads(envelope, at(73)))["ga4.mp"]).toEqual({
      ok: false,
      reason: "ga4 window passed",
    });
  });

  it("an 8-day-old purchase fails validation (past the 7-day business window)", () => {
    expect.hasAssertions();
    const eightDays = new Date(Date.parse(PLACED_AT) + 8 * 24 * 60 * 60 * 1000);
    const result = validateEnvelope(purchaseEnvelope(order(), CTX), { now: eightDays });
    expect(result.valid).toBe(false);
  });

  it("the 7-day window is only for server-origin business events", () => {
    expect.hasAssertions();
    const twoDays = new Date(Date.parse(PLACED_AT) + 2 * 24 * 60 * 60 * 1000);
    const server = purchaseEnvelope(order(), CTX);
    expect(validateEnvelope(server, { now: twoDays }).valid).toBe(true);
    expect(validateEnvelope({ ...server, eventOrigin: "browser" }, { now: twoDays }).valid).toBe(
      false,
    );
    expect(validateEnvelope({ ...server, eventName: "page_viewed" }, { now: twoDays }).valid).toBe(
      false,
    );
  });
});
