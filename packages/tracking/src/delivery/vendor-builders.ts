/**
 * Per-vendor typed request builders (lead-site plan D1, Task 3, DD1).
 *
 * `applyMapping` cannot write arrays, has no event-name map and no micro-second transform, and
 * every real vendor body needs `data[]` / `events[]`. Each builder here is a pure function from a
 * neutral {@link VendorEventInput} to exactly the vendor's documented request body:
 *
 * - `meta.capi.v27`      → `POST /{pixel}/events`        body `{ data: [...] }`, time in seconds
 * - `tiktok.events.v1_3` → `POST /event/track/`          body `{ event_source, event_source_id, data: [...] }`
 * - `snap.capi.v3`       → `POST /v3/{pixel}/events`     body `{ data: [...] }`, time in seconds
 * - `ga4.mp`             → `POST /mp/collect`            body `{ client_id, events: [...] }`, time in micros
 *
 * No token ever appears in a body: the access token / API secret is added by the HTTP adapter as a
 * header or query parameter after the payload is recorded. A builder reads identity only from
 * `input.keys` (already hashed, per platform), so raw email/phone/name cannot reach a vendor body.
 *
 * Every builder omits a key whose value is null, undefined, an empty string, an empty array or an
 * empty object — a vendor treats a present-but-empty field as bad data, not as "absent".
 */

import type { VendorEventInput } from "./vendor-event-input";
import { vendorEventName, type VendorBuilderKey } from "./vendor-event-names";

/** The destination-specific id the request is addressed to (pixel id / pixel code / measurement id). */
export interface VendorTarget {
  readonly id: string;
  readonly testEventCode?: string;
}

export type BuildResult =
  | { readonly ok: true; readonly payload: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: string };

/** Drops null / undefined / "" / [] / {} recursively. Arrays keep their (compacted) non-empty items. */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((item) => item !== undefined);
    return items.length === 0 ? undefined : items;
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      const cleaned = compact(inner);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }
  if (value === null || value === undefined || value === "") return undefined;
  return value;
}

function ok(payload: Record<string, unknown>): BuildResult {
  return { ok: true, payload: (compact(payload) ?? {}) as Record<string, unknown> };
}

function refuse(reason: string): BuildResult {
  return { ok: false, reason };
}

/**
 * True when a required container would survive `compact`. A vendor container the API marks
 * required (Meta/Snap/TikTok user data) must never be silently deleted by compaction: the builder
 * checks it up front and refuses instead of emitting a request without it.
 */
function hasContent(container: Record<string, unknown>): boolean {
  return compact(container) !== undefined;
}

function isHttpUrl(value: string | null): value is string {
  if (value === null) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const list = (value: string | undefined): readonly string[] | undefined =>
  value === undefined ? undefined : [value];

const seconds = (input: VendorEventInput): number => Math.floor(input.eventTimeMs / 1000);

function buildMeta(name: string, input: VendorEventInput, target: VendorTarget): BuildResult {
  const { keys, browser, commerce } = input;

  const userData = {
    em: list(keys.em),
    ph: list(keys.ph),
    fn: list(keys.fn),
    ln: list(keys.ln),
    ct: list(keys.ct),
    st: list(keys.st),
    zp: list(keys.zp),
    country: list(keys.country),
    external_id: list(keys.externalId),
    client_ip_address: input.ip,
    client_user_agent: input.userAgent,
    fbp: browser.fbp,
    fbc: browser.fbc,
  };
  // `user_data` is required by the API; never let compaction delete it.
  if (!hasContent(userData)) return refuse("meta user data missing");

  return ok({
    data: [
      {
        event_name: name,
        event_time: seconds(input),
        event_id: input.eventId,
        action_source: "website",
        event_source_url: input.sourceUrl,
        user_data: userData,
        custom_data: {
          value: commerce.valueMajor,
          currency: commerce.currency,
          content_ids: commerce.contentIds,
          contents: commerce.contents.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            item_price: item.itemPriceMajor,
          })),
          content_type: commerce.contentType,
          num_items: commerce.numItems,
          order_id: commerce.orderId,
        },
      },
    ],
    test_event_code: target.testEventCode,
  });
}

function buildTikTok(name: string, input: VendorEventInput, target: VendorTarget): BuildResult {
  const { keys, browser, commerce } = input;

  const user = {
    email: keys.em,
    phone: keys.ph,
    external_id: keys.externalId,
    ttclid: browser.ttclid,
    ttp: browser.ttp,
    ip: input.ip,
    user_agent: input.userAgent,
  };
  // `user` is required for Web events. Never delete it, never fabricate identifiers: with nothing
  // to put in it, refuse (recorded blocked, no HTTP).
  if (!hasContent(user)) return refuse("tiktok user data missing");

  return ok({
    event_source: "web",
    event_source_id: target.id,
    test_event_code: target.testEventCode,
    data: [
      {
        event: name,
        event_time: seconds(input),
        event_id: input.eventId,
        user,
        properties: {
          value: commerce.valueMajor,
          currency: commerce.currency,
          content_type: commerce.contentType,
          contents: commerce.contents.map((item) => ({
            content_id: item.id,
            quantity: item.quantity,
            price: item.itemPriceMajor,
          })),
          order_id: commerce.orderId,
        },
        page: { url: input.sourceUrl, referrer: input.referrer },
      },
    ],
  });
}

function buildSnap(
  name: string,
  input: VendorEventInput,
  _target: VendorTarget,
  canonicalEvent: string,
): BuildResult {
  const { keys, browser, commerce } = input;

  if (
    keys.em === undefined &&
    keys.ph === undefined &&
    (input.ip === null || input.userAgent === null)
  ) {
    return refuse("snap matching data missing");
  }
  if (
    canonicalEvent === "purchase" &&
    (commerce.valueMajor === null || commerce.currency === null)
  ) {
    return refuse("snap purchase value missing");
  }

  const userData = {
    em: list(keys.em),
    ph: list(keys.ph),
    fn: list(keys.fn),
    ln: list(keys.ln),
    ct: list(keys.ct),
    st: list(keys.st),
    zp: list(keys.zp),
    country: list(keys.country),
    // Snap's external_id is a scalar string, unlike Meta's array.
    external_id: keys.externalId,
    client_ip_address: input.ip,
    client_user_agent: input.userAgent,
    sc_click_id: browser.scClickId,
    sc_cookie1: browser.scid,
  };
  // `user_data` is required; an empty-string key would pass the check above but be compacted away.
  if (!hasContent(userData)) return refuse("snap matching data missing");

  return ok({
    data: [
      {
        event_name: name,
        event_time: seconds(input),
        event_id: input.eventId,
        action_source: "WEB",
        event_source_url: input.sourceUrl,
        user_data: userData,
        custom_data: {
          value: commerce.valueMajor,
          currency: commerce.currency,
          content_ids: commerce.contentIds,
          // Snap's num_items is a string.
          num_items: commerce.numItems === null ? null : String(commerce.numItems),
          order_id: commerce.orderId,
        },
      },
    ],
  });
}

/**
 * GA4's Measurement Protocol drops an event whose `timestamp_micros` is more than 72 hours old, and answers 2xx
 * anyway: the request would "succeed" and count nothing. Refusing here records it as blocked, with the reason.
 */
export const GA4_MAX_EVENT_AGE_MS = 72 * 60 * 60 * 1000;

function buildGa4(name: string, input: VendorEventInput): BuildResult {
  const { keys, browser, commerce } = input;

  if (input.nowMs !== undefined && input.nowMs - input.eventTimeMs > GA4_MAX_EVENT_AGE_MS) {
    return refuse("ga4 window passed");
  }
  if (browser.gaClientId === null) return refuse("ga4 client_id unavailable");

  return ok({
    client_id: browser.gaClientId,
    user_id: input.customerId,
    timestamp_micros: input.eventTimeMs * 1000,
    consent: {
      ad_user_data: input.consent.adUserData ? "GRANTED" : "DENIED",
      ad_personalization: input.consent.adPersonalization ? "GRANTED" : "DENIED",
    },
    user_data: {
      sha256_email_address: list(keys.em),
      sha256_phone_number: list(keys.ph),
      address: [
        {
          sha256_first_name: keys.fn,
          sha256_last_name: keys.ln,
          city: keys.ct,
          region: keys.st,
          postal_code: keys.zp,
          country: keys.country,
        },
      ],
    },
    events: [
      {
        name,
        params: {
          engagement_time_msec: 1,
          session_id: browser.gaSessionId,
          page_location: input.sourceUrl,
          transaction_id: commerce.orderId,
          value: commerce.valueMajor,
          currency: commerce.currency,
          items: commerce.contents.map((item) => ({
            item_id: item.id,
            quantity: item.quantity,
            price: item.itemPriceMajor,
          })),
        },
      },
    ],
  });
}

/**
 * Builds one vendor's request body, or refuses with a reason that never contains a raw value.
 * Check order: event supported → source url → builder-specific requirements.
 */
export function buildVendorPayload(
  builder: VendorBuilderKey,
  input: VendorEventInput,
  target: VendorTarget,
): BuildResult {
  const name = vendorEventName(builder, input.eventName);
  if (name === null) return refuse(`event not supported by ${builder}`);
  if (!isHttpUrl(input.sourceUrl)) return refuse("event source url missing");

  switch (builder) {
    case "meta.capi.v27":
      return buildMeta(name, input, target);
    case "tiktok.events.v1_3":
      return buildTikTok(name, input, target);
    case "snap.capi.v3":
      return buildSnap(name, input, target, input.eventName);
    case "ga4.mp":
      return buildGa4(name, input);
  }
}
