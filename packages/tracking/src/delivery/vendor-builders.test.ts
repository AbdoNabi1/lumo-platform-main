import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import type { HashPort } from "../ids/dedup-id";
import { normalizeIdentity } from "../pipeline/normalization";
import {
  platformMatchKeys,
  type MatchPlatform,
  type PlatformMatchKeys,
} from "../pipeline/platform-identity";
import { buildVendorPayload, type VendorTarget } from "./vendor-builders";
import type { VendorEventInput } from "./vendor-event-input";
import {
  CANONICAL_EVENTS,
  MATCH_PLATFORM_OF,
  SITE_TYPE_EVENTS,
  VENDOR_EVENT_NAMES,
  vendorEventName,
  type CanonicalEvent,
  type VendorBuilderKey,
} from "./vendor-event-names";

const nodeSha256: HashPort = {
  sha256Hex: async (s) => createHash("sha256").update(s, "utf8").digest("hex"),
};
const sha = (s: string): Promise<string> => nodeSha256.sha256Hex(s);

// Built from parts so a masking display layer can never turn the fixture into something else.
const PHONE_DIGITS = "20" + "1012345678";
const PHONE_E164 = `+${PHONE_DIGITS}`;

const EVENT_ID = "lead_0193a1b2-0000-7000-8000-000000000001";
const URL_ = "https://clinic.example/offers?utm_source=meta";
const IP = "203.0.113.7";
const UA = "Mozilla/5.0 (test)";

const IDENTITY = normalizeIdentity({
  email: "Jane.Doe+x@gmail.com",
  phone: PHONE_E164,
  firstName: "Ahmed",
  lastName: "Ali",
  country: "EG",
  city: "Cairo",
  hashStatus: "raw",
});

const IDENTITY_WITH_EXTERNAL_ID = normalizeIdentity({
  ...IDENTITY,
  externalId: "cust-123",
  hashStatus: "raw",
});

const BUILDER_OF: Readonly<Record<MatchPlatform, VendorBuilderKey | null>> = {
  meta: "meta.capi.v27",
  tiktok: "tiktok.events.v1_3",
  snap: "snap.capi.v3",
  ga4: "ga4.mp",
  google_ads: null,
};

const NO_COMMERCE: VendorEventInput["commerce"] = {
  valueMajor: null,
  currency: null,
  orderId: null,
  contentType: null,
  numItems: null,
  contentIds: [],
  contents: [],
};

const PURCHASE_COMMERCE: VendorEventInput["commerce"] = {
  valueMajor: 1250,
  currency: "EGP",
  orderId: "o-1",
  contentType: "product",
  numItems: 3,
  contentIds: ["p-1", "p-2"],
  contents: [
    { id: "p-1", quantity: 2, itemPriceMajor: 500 },
    { id: "p-2", quantity: 1, itemPriceMajor: 250 },
  ],
};

async function inputFor(
  platform: MatchPlatform,
  overrides: Partial<VendorEventInput> = {},
  identity = IDENTITY,
): Promise<VendorEventInput> {
  return {
    eventName: "form_submitted",
    eventId: EVENT_ID,
    eventTimeMs: 1764000000123,
    sourceUrl: URL_,
    referrer: null,
    ip: IP,
    userAgent: UA,
    customerId: null,
    keys: await platformMatchKeys(platform, identity, nodeSha256),
    browser: {
      fbp: "fb.1.1764000000000.123456789",
      fbc: "fb.1.1764000000000.AbCdEf",
      ttp: "ttp-abc",
      scid: "scid-xyz",
      gaClientId: "111111111.1764000000",
      gaSessionId: null,
      ttclid: "tt-click-1",
      scClickId: "sc-click-1",
    },
    commerce: NO_COMMERCE,
    consent: { adUserData: true, adPersonalization: true },
    ...overrides,
  };
}

const TIKTOK_TARGET: VendorTarget = { id: "CABCDE1234567890" };
const META_TARGET: VendorTarget = { id: "123456789012345" };
const SNAP_TARGET: VendorTarget = { id: "0b8f1c7e-1a2b-4c3d-8e9f-0123456789ab" };
const GA4_TARGET: VendorTarget = { id: "G-ABCD1234" };

function build(
  builder: VendorBuilderKey,
  input: VendorEventInput,
  target: VendorTarget,
): Readonly<Record<string, unknown>> {
  const result = buildVendorPayload(builder, input, target);
  if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
  return result.payload;
}

async function userDataFor(
  platform: "meta" | "snap",
  extra: Record<string, unknown>,
  withExternalId = false,
): Promise<Record<string, unknown>> {
  return {
    em: [await sha("jane.doe+x@gmail.com")],
    ph: [await sha(PHONE_DIGITS)],
    fn: [await sha("ahmed")],
    ln: [await sha("ali")],
    ct: [await sha("cairo")],
    country: [await sha("eg")],
    ...(withExternalId
      ? { external_id: platform === "meta" ? [await sha("cust-123")] : await sha("cust-123") }
      : {}),
    client_ip_address: IP,
    client_user_agent: UA,
    ...extra,
  };
}

describe("vendor builders: golden request bodies", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("pins the hasher with literal digests", async () => {
    expect(await sha(PHONE_DIGITS)).toBe(
      "b12a7c358b87131b5cef5a3e69a5d474532a78e4a3183971b2c70f67c8bb3c8f",
    );
  });

  it("meta: wrapper array, seconds, array-valued user_data", async () => {
    const input = await inputFor("meta");
    expect(build("meta.capi.v27", input, META_TARGET)).toEqual({
      data: [
        {
          event_name: "Lead",
          event_time: 1764000000,
          event_id: EVENT_ID,
          action_source: "website",
          event_source_url: URL_,
          user_data: await userDataFor("meta", {
            fbp: "fb.1.1764000000000.123456789",
            fbc: "fb.1.1764000000000.AbCdEf",
          }),
        },
      ],
    });
  });

  it("meta: test_event_code is a top-level sibling of data", async () => {
    const input = await inputFor("meta");
    expect(build("meta.capi.v27", input, { id: META_TARGET.id, testEventCode: "TEST123" })).toEqual(
      {
        data: [
          {
            event_name: "Lead",
            event_time: 1764000000,
            event_id: EVENT_ID,
            action_source: "website",
            event_source_url: URL_,
            user_data: await userDataFor("meta", {
              fbp: "fb.1.1764000000000.123456789",
              fbc: "fb.1.1764000000000.AbCdEf",
            }),
          },
        ],
        test_event_code: "TEST123",
      },
    );
  });

  it("tiktok: event_source web, event_source_id, hashed email/phone, plain ids", async () => {
    const input = await inputFor("tiktok");
    expect(build("tiktok.events.v1_3", input, TIKTOK_TARGET)).toEqual({
      event_source: "web",
      event_source_id: "CABCDE1234567890",
      data: [
        {
          event: "Lead",
          event_time: 1764000000,
          event_id: EVENT_ID,
          user: {
            email: await sha("jane.doe+x@gmail.com"),
            phone: await sha(PHONE_E164),
            ttclid: "tt-click-1",
            ttp: "ttp-abc",
            ip: IP,
            user_agent: UA,
          },
          page: { url: URL_ },
        },
      ],
    });
  });

  it("tiktok: test_event_code is top level", async () => {
    const input = await inputFor("tiktok");
    const payload = build("tiktok.events.v1_3", input, { ...TIKTOK_TARGET, testEventCode: "TT1" });
    expect(payload.test_event_code).toBe("TT1");
    expect(Object.keys(payload)).toEqual([
      "event_source",
      "event_source_id",
      "test_event_code",
      "data",
    ]);
  });

  it("snap: SIGN_UP for a lead, WEB action source, click id and cookie", async () => {
    const input = await inputFor("snap");
    expect(build("snap.capi.v3", input, SNAP_TARGET)).toEqual({
      data: [
        {
          event_name: "SIGN_UP",
          event_time: 1764000000,
          event_id: EVENT_ID,
          action_source: "WEB",
          event_source_url: URL_,
          user_data: await userDataFor("snap", {
            sc_click_id: "sc-click-1",
            sc_cookie1: "scid-xyz",
          }),
        },
      ],
    });
  });

  it("ga4: client_id, micros, consent, hashed user_data, address with plain city/country", async () => {
    const input = await inputFor("ga4");
    expect(build("ga4.mp", input, GA4_TARGET)).toEqual({
      client_id: "111111111.1764000000",
      timestamp_micros: 1764000000123000,
      consent: { ad_user_data: "GRANTED", ad_personalization: "GRANTED" },
      user_data: {
        sha256_email_address: [await sha("janedoe+x@gmail.com")],
        sha256_phone_number: [await sha(PHONE_E164)],
        address: [
          {
            sha256_first_name: await sha("ahmed"),
            sha256_last_name: await sha("ali"),
            city: "cairo",
            country: "EG",
          },
        ],
      },
      events: [
        {
          name: "generate_lead",
          params: { engagement_time_msec: 1, page_location: URL_ },
        },
      ],
    });
  });

  it("ga4: session_id is sent when the GA session id is known, user_id when a customer id is", async () => {
    const input = await inputFor("ga4", {
      customerId: "c-77",
      browser: {
        fbp: null,
        fbc: null,
        ttp: null,
        scid: null,
        gaClientId: "111111111.1764000000",
        gaSessionId: "1764000000",
        ttclid: null,
        scClickId: null,
      },
      consent: { adUserData: true, adPersonalization: false },
    });
    const payload = build("ga4.mp", input, GA4_TARGET);
    expect(payload).toEqual({
      client_id: "111111111.1764000000",
      user_id: "c-77",
      timestamp_micros: 1764000000123000,
      consent: { ad_user_data: "GRANTED", ad_personalization: "DENIED" },
      user_data: {
        sha256_email_address: [await sha("janedoe+x@gmail.com")],
        sha256_phone_number: [await sha(PHONE_E164)],
        address: [
          {
            sha256_first_name: await sha("ahmed"),
            sha256_last_name: await sha("ali"),
            city: "cairo",
            country: "EG",
          },
        ],
      },
      events: [
        {
          name: "generate_lead",
          params: { engagement_time_msec: 1, session_id: "1764000000", page_location: URL_ },
        },
      ],
    });
  });

  it("ga4: user_data and address are omitted when no identity is known", async () => {
    const input = await inputFor("ga4", { keys: {} });
    expect(build("ga4.mp", input, GA4_TARGET)).toEqual({
      client_id: "111111111.1764000000",
      timestamp_micros: 1764000000123000,
      consent: { ad_user_data: "GRANTED", ad_personalization: "GRANTED" },
      events: [{ name: "generate_lead", params: { engagement_time_msec: 1, page_location: URL_ } }],
    });
  });

  it("external id: meta array, tiktok scalar, snap scalar", async () => {
    const meta = build(
      "meta.capi.v27",
      await inputFor("meta", {}, IDENTITY_WITH_EXTERNAL_ID),
      META_TARGET,
    );
    expect(meta).toEqual({
      data: [
        {
          event_name: "Lead",
          event_time: 1764000000,
          event_id: EVENT_ID,
          action_source: "website",
          event_source_url: URL_,
          user_data: await userDataFor(
            "meta",
            { fbp: "fb.1.1764000000000.123456789", fbc: "fb.1.1764000000000.AbCdEf" },
            true,
          ),
        },
      ],
    });

    const tiktok = build(
      "tiktok.events.v1_3",
      await inputFor("tiktok", {}, IDENTITY_WITH_EXTERNAL_ID),
      TIKTOK_TARGET,
    );
    expect(tiktok).toEqual({
      event_source: "web",
      event_source_id: "CABCDE1234567890",
      data: [
        {
          event: "Lead",
          event_time: 1764000000,
          event_id: EVENT_ID,
          user: {
            email: await sha("jane.doe+x@gmail.com"),
            phone: await sha(PHONE_E164),
            external_id: await sha("cust-123"),
            ttclid: "tt-click-1",
            ttp: "ttp-abc",
            ip: IP,
            user_agent: UA,
          },
          page: { url: URL_ },
        },
      ],
    });

    const snap = build(
      "snap.capi.v3",
      await inputFor("snap", {}, IDENTITY_WITH_EXTERNAL_ID),
      SNAP_TARGET,
    );
    expect(snap).toEqual({
      data: [
        {
          event_name: "SIGN_UP",
          event_time: 1764000000,
          event_id: EVENT_ID,
          action_source: "WEB",
          event_source_url: URL_,
          user_data: await userDataFor(
            "snap",
            { sc_click_id: "sc-click-1", sc_cookie1: "scid-xyz" },
            true,
          ),
        },
      ],
    });
  });

  it("tiktok: referrer is sent in page when known", async () => {
    const input = await inputFor("tiktok", { referrer: "https://ads.example/" });
    const payload = build("tiktok.events.v1_3", input, TIKTOK_TARGET);
    expect((payload.data as { page: unknown }[])[0]?.page).toEqual({
      url: URL_,
      referrer: "https://ads.example/",
    });
  });
});

describe("vendor builders: purchase goldens", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("meta: custom_data with decimals, contents and content ids", async () => {
    const input = await inputFor("meta", { eventName: "purchase", commerce: PURCHASE_COMMERCE });
    expect(build("meta.capi.v27", input, META_TARGET)).toEqual({
      data: [
        {
          event_name: "Purchase",
          event_time: 1764000000,
          event_id: EVENT_ID,
          action_source: "website",
          event_source_url: URL_,
          user_data: await userDataFor("meta", {
            fbp: "fb.1.1764000000000.123456789",
            fbc: "fb.1.1764000000000.AbCdEf",
          }),
          custom_data: {
            value: 1250,
            currency: "EGP",
            content_ids: ["p-1", "p-2"],
            contents: [
              { id: "p-1", quantity: 2, item_price: 500 },
              { id: "p-2", quantity: 1, item_price: 250 },
            ],
            content_type: "product",
            num_items: 3,
            order_id: "o-1",
          },
        },
      ],
    });
  });

  it("meta: ids-only payload sends content_ids and no contents", async () => {
    const input = await inputFor("meta", {
      eventName: "product_viewed",
      commerce: { ...NO_COMMERCE, contentIds: ["p-9"] },
    });
    const payload = build("meta.capi.v27", input, META_TARGET);
    expect((payload.data as { custom_data: unknown }[])[0]?.custom_data).toEqual({
      content_ids: ["p-9"],
    });
  });

  it("meta: a line item without a price omits item_price", async () => {
    const input = await inputFor("meta", {
      eventName: "add_to_cart",
      commerce: {
        ...NO_COMMERCE,
        contentIds: ["p-1"],
        contents: [{ id: "p-1", quantity: 1, itemPriceMajor: null }],
      },
    });
    const payload = build("meta.capi.v27", input, META_TARGET);
    expect((payload.data as { custom_data: unknown }[])[0]?.custom_data).toEqual({
      content_ids: ["p-1"],
      contents: [{ id: "p-1", quantity: 1 }],
    });
  });

  it("tiktok: properties with contents", async () => {
    const input = await inputFor("tiktok", { eventName: "purchase", commerce: PURCHASE_COMMERCE });
    expect(build("tiktok.events.v1_3", input, TIKTOK_TARGET)).toEqual({
      event_source: "web",
      event_source_id: "CABCDE1234567890",
      data: [
        {
          event: "Purchase",
          event_time: 1764000000,
          event_id: EVENT_ID,
          user: {
            email: await sha("jane.doe+x@gmail.com"),
            phone: await sha(PHONE_E164),
            ttclid: "tt-click-1",
            ttp: "ttp-abc",
            ip: IP,
            user_agent: UA,
          },
          properties: {
            value: 1250,
            currency: "EGP",
            content_type: "product",
            contents: [
              { content_id: "p-1", quantity: 2, price: 500 },
              { content_id: "p-2", quantity: 1, price: 250 },
            ],
            order_id: "o-1",
          },
          page: { url: URL_ },
        },
      ],
    });
  });

  it("snap: num_items is a string", async () => {
    const input = await inputFor("snap", { eventName: "purchase", commerce: PURCHASE_COMMERCE });
    expect(build("snap.capi.v3", input, SNAP_TARGET)).toEqual({
      data: [
        {
          event_name: "PURCHASE",
          event_time: 1764000000,
          event_id: EVENT_ID,
          action_source: "WEB",
          event_source_url: URL_,
          user_data: await userDataFor("snap", {
            sc_click_id: "sc-click-1",
            sc_cookie1: "scid-xyz",
          }),
          custom_data: {
            value: 1250,
            currency: "EGP",
            content_ids: ["p-1", "p-2"],
            num_items: "3",
            order_id: "o-1",
          },
        },
      ],
    });
  });

  it("ga4: transaction_id, value, currency and items", async () => {
    const input = await inputFor("ga4", { eventName: "purchase", commerce: PURCHASE_COMMERCE });
    expect(build("ga4.mp", input, GA4_TARGET)).toEqual({
      client_id: "111111111.1764000000",
      timestamp_micros: 1764000000123000,
      consent: { ad_user_data: "GRANTED", ad_personalization: "GRANTED" },
      user_data: {
        sha256_email_address: [await sha("janedoe+x@gmail.com")],
        sha256_phone_number: [await sha(PHONE_E164)],
        address: [
          {
            sha256_first_name: await sha("ahmed"),
            sha256_last_name: await sha("ali"),
            city: "cairo",
            country: "EG",
          },
        ],
      },
      events: [
        {
          name: "purchase",
          params: {
            engagement_time_msec: 1,
            page_location: URL_,
            transaction_id: "o-1",
            value: 1250,
            currency: "EGP",
            items: [
              { item_id: "p-1", quantity: 2, price: 500 },
              { item_id: "p-2", quantity: 1, price: 250 },
            ],
          },
        },
      ],
    });
  });
});

describe("vendor builders: refusals", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("tiktok refuses page_viewed (TikTok has no server PageView)", async () => {
    const input = await inputFor("tiktok", { eventName: "page_viewed" });
    expect(buildVendorPayload("tiktok.events.v1_3", input, TIKTOK_TARGET)).toEqual({
      ok: false,
      reason: "event not supported by tiktok.events.v1_3",
    });
  });

  it("every builder refuses an unknown event", async () => {
    for (const builder of Object.values(BUILDER_OF)) {
      if (builder === null) continue;
      const platform = MATCH_PLATFORM_OF[builder];
      const input = await inputFor(platform, { eventName: "toString" });
      expect(buildVendorPayload(builder, input, GA4_TARGET)).toEqual({
        ok: false,
        reason: `event not supported by ${builder}`,
      });
    }
  });

  it("ga4 refuses without a client id", async () => {
    const base = await inputFor("ga4");
    const input = { ...base, browser: { ...base.browser, gaClientId: null } };
    expect(buildVendorPayload("ga4.mp", input, GA4_TARGET)).toEqual({
      ok: false,
      reason: "ga4 client_id unavailable",
    });
  });

  it.each([null, "", "not a url", "ftp://clinic.example/x", "javascript:alert(1)"])(
    "every builder refuses source url %j",
    async (sourceUrl) => {
      for (const builder of Object.values(BUILDER_OF)) {
        if (builder === null) continue;
        const input = await inputFor(MATCH_PLATFORM_OF[builder], { sourceUrl });
        expect(buildVendorPayload(builder, input, TIKTOK_TARGET)).toEqual({
          ok: false,
          reason: "event source url missing",
        });
      }
    },
  );

  it("snap refuses without email, phone, or both ip and user agent", async () => {
    const none = await inputFor("snap", { keys: {}, ip: null, userAgent: null });
    expect(buildVendorPayload("snap.capi.v3", none, SNAP_TARGET)).toEqual({
      ok: false,
      reason: "snap matching data missing",
    });
    const onlyIp = await inputFor("snap", { keys: {}, userAgent: null });
    expect(buildVendorPayload("snap.capi.v3", onlyIp, SNAP_TARGET)).toEqual({
      ok: false,
      reason: "snap matching data missing",
    });
  });

  it("snap accepts ip and user agent alone, or a phone alone", async () => {
    const ipUa = await inputFor("snap", { keys: {} });
    expect(buildVendorPayload("snap.capi.v3", ipUa, SNAP_TARGET).ok).toBe(true);
    const phoneOnly: PlatformMatchKeys = { ph: await sha(PHONE_DIGITS) };
    const ph = await inputFor("snap", { keys: phoneOnly, ip: null, userAgent: null });
    expect(buildVendorPayload("snap.capi.v3", ph, SNAP_TARGET).ok).toBe(true);
  });

  it("snap purchase needs a value and a currency", async () => {
    const noValue = await inputFor("snap", {
      eventName: "purchase",
      commerce: { ...PURCHASE_COMMERCE, valueMajor: null },
    });
    expect(buildVendorPayload("snap.capi.v3", noValue, SNAP_TARGET)).toEqual({
      ok: false,
      reason: "snap purchase value missing",
    });
    const noCurrency = await inputFor("snap", {
      eventName: "purchase",
      commerce: { ...PURCHASE_COMMERCE, currency: null },
    });
    expect(buildVendorPayload("snap.capi.v3", noCurrency, SNAP_TARGET)).toEqual({
      ok: false,
      reason: "snap purchase value missing",
    });
  });
});

describe("vendor builders: no raw PII in any output", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  // GA4 legitimately carries the lower-case city, so the capitalised raw form is what is checked.
  const RAW = ["Jane.Doe", "jane.doe", PHONE_DIGITS, "Ahmed", "ahmed", "Cairo"];

  it.each(Object.entries(BUILDER_OF).filter(([, builder]) => builder !== null))(
    "%s",
    async (platform, builder) => {
      const input = await inputFor(platform as MatchPlatform, {
        eventName: "purchase",
        commerce: PURCHASE_COMMERCE,
      });
      const payload = build(builder as VendorBuilderKey, input, GA4_TARGET);
      const text = JSON.stringify(payload);
      for (const raw of RAW) expect(text).not.toContain(raw);
    },
  );
});

describe("vendor event names", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  // The plan table, one row per canonical event: meta, tiktok, snap, ga4 (null = not sent).
  const TABLE: readonly (readonly [
    CanonicalEvent,
    string | null,
    string | null,
    string | null,
    string,
  ])[] = [
    ["page_viewed", "PageView", null, "PAGE_VIEW", "page_view"],
    ["form_submitted", "Lead", "Lead", "SIGN_UP", "generate_lead"],
    ["contact_clicked", "Contact", "Contact", "CUSTOM_EVENT_2", "contact"],
    ["product_viewed", "ViewContent", "ViewContent", "VIEW_CONTENT", "view_item"],
    ["view_item_list", "ViewCategory", null, "LIST_VIEW", "view_item_list"],
    ["add_to_cart", "AddToCart", "AddToCart", "ADD_CART", "add_to_cart"],
    ["add_to_wishlist", "AddToWishlist", "AddToWishlist", "SAVE", "add_to_wishlist"],
    [
      "checkout_started",
      "InitiateCheckout",
      "InitiateCheckout",
      "START_CHECKOUT",
      "begin_checkout",
    ],
    ["add_payment_info", "AddPaymentInfo", "AddPaymentInfo", "ADD_BILLING", "add_payment_info"],
    ["search", "Search", "Search", "SEARCH", "search"],
    ["signup", "CompleteRegistration", "CompleteRegistration", "SIGN_UP", "sign_up"],
    ["login", "Login", "Login", "LOGIN", "login"],
    ["purchase", "Purchase", "Purchase", "PURCHASE", "purchase"],
    ["order_delivered", "OrderDelivered", "OrderDelivered", "CUSTOM_EVENT_1", "order_delivered"],
    ["order_cancelled", "OrderCancelled", "OrderCancelled", "CUSTOM_EVENT_5", "refund"],
  ];

  const BUILDERS: readonly VendorBuilderKey[] = [
    "meta.capi.v27",
    "tiktok.events.v1_3",
    "snap.capi.v3",
    "ga4.mp",
  ];

  const CELLS = TABLE.flatMap((row) =>
    BUILDERS.map((builder, index) => [row[0], builder, row[index + 1] ?? null] as const),
  );

  it("the table covers every canonical event exactly once", () => {
    expect(TABLE.map((row) => row[0])).toEqual([...CANONICAL_EVENTS]);
  });

  it.each(CELLS)("%s on %s → %j", (event, builder, expected) => {
    expect(vendorEventName(builder, event)).toBe(expected);
    expect(VENDOR_EVENT_NAMES[builder][event] ?? null).toBe(expected);
  });

  it("returns null for an unknown event or an inherited object key", () => {
    expect(vendorEventName("meta.capi.v27", "nope")).toBeNull();
    expect(vendorEventName("meta.capi.v27", "constructor")).toBeNull();
    expect(vendorEventName("meta.capi.v27", "__proto__")).toBeNull();
  });

  it("site types: lead sites emit three events, stores everything but form_submitted", () => {
    expect(SITE_TYPE_EVENTS.lead_site).toEqual([
      "page_viewed",
      "form_submitted",
      "contact_clicked",
    ]);
    expect(SITE_TYPE_EVENTS.store).toEqual(
      CANONICAL_EVENTS.filter((event) => event !== "form_submitted"),
    );
  });
});
