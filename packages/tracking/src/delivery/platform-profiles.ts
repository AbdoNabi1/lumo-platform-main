/**
 * The nine launch platforms — expressed entirely as **seed configuration** (directive §Destination
 * Adapters, §Mapping Engine).
 *
 * Nothing here is code. These are Registry seed values: every platform is a `DestinationDefinition`
 * plus a `MappingProfile`, all served by the one `HttpJsonAdapter`. Adding a tenth platform means
 * appending to this data (or writing it through the admin surface) — the engine is untouched.
 *
 * Seeds are a starting point, not a source of truth: once registered, the Registry owns them and
 * an operator may version, deprecate or roll them back without a deployment.
 */

import { Expr } from "@platform/expression";

import type { DestinationDefinition } from "./destination";
import type { MappingProfile } from "./mapping";

const STANDARD_RETRY = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  factor: 2,
  maxDelayMs: 60_000,
} as const;

const STANDARD_BREAKER = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenSuccesses: 2,
} as const;

function destination(
  key: string,
  platform: string,
  url: string,
  credentialRef: string,
  requestsPerSecond: number,
): DestinationDefinition {
  return {
    key,
    platform,
    transport: "http_json",
    channel: "server",
    consentPurpose: "marketing",
    mappingProfileKey: `${key}.mapping`,
    endpoint: { url, method: "POST", credentialRef, timeoutMs: 5_000 },
    retry: STANDARD_RETRY,
    rateLimit: { requestsPerSecond, burst: requestsPerSecond * 2 },
    circuitBreaker: STANDARD_BREAKER,
    enabled: true,
  };
}

/** Seed destinations. URLs carry a `{version}`/`{id}` placeholder resolved from configuration. */
export const SEED_DESTINATIONS: readonly DestinationDefinition[] = [
  destination(
    "meta.capi",
    "meta",
    "https://graph.facebook.com/v21.0/{pixel_id}/events",
    "vault://tracking/meta/access_token",
    50,
  ),
  destination(
    "google.ads",
    "google",
    "https://googleads.googleapis.com/v18/customers/{customer_id}:uploadClickConversions",
    "vault://tracking/google/access_token",
    20,
  ),
  destination(
    "ga4.mp",
    "google",
    "https://www.google-analytics.com/mp/collect",
    "vault://tracking/ga4/api_secret",
    100,
  ),
  destination(
    "tiktok.events",
    "tiktok",
    "https://business-api.tiktok.com/open_api/v1.3/event/track/",
    "vault://tracking/tiktok/access_token",
    50,
  ),
  destination(
    "snap.capi",
    "snapchat",
    "https://tr.snapchat.com/v3/{pixel_id}/events",
    "vault://tracking/snap/access_token",
    50,
  ),
  destination(
    "pinterest.capi",
    "pinterest",
    "https://api.pinterest.com/v5/ad_accounts/{ad_account_id}/events",
    "vault://tracking/pinterest/access_token",
    20,
  ),
  destination(
    "linkedin.capi",
    "linkedin",
    "https://api.linkedin.com/rest/conversionEvents",
    "vault://tracking/linkedin/access_token",
    20,
  ),
  destination(
    "microsoft.ads",
    "microsoft",
    "https://conversions.bingads.microsoft.com/v1/conversions",
    "vault://tracking/microsoft/access_token",
    20,
  ),
  destination(
    "x.ads",
    "x",
    "https://ads-api.x.com/12/measurement/conversions/{account_id}",
    "vault://tracking/x/access_token",
    20,
  ),
];

/** Emitted only when marketing consent is granted — belt and braces alongside the router gate. */
const MARKETING_CONSENTED = Expr.and(
  Expr.where("consent.marketing", "eq", true),
  Expr.exists("identity.country"),
);

/**
 * Meta CAPI. Identity fields are already normalized and SHA-256 hashed by the pipeline, so the
 * mapping only renames them — it never hashes (that would double-hash).
 */
const META_MAPPING: MappingProfile = {
  key: "meta.capi.mapping",
  version: 1,
  destination: "meta.capi",
  constants: { action_source: "website" },
  fields: [
    { target: "event_name", source: "event.name", required: true },
    { target: "event_id", source: "event.dedupId", required: true },
    {
      target: "event_time",
      source: "event.timestamp",
      transform: "to_unix_seconds",
      required: true,
    },
    { target: "event_source_url", source: "page.eventSourceUrl" },
    { target: "user_data.em", source: "identity.email", transform: "to_array" },
    { target: "user_data.ph", source: "identity.phone", transform: "to_array" },
    { target: "user_data.fn", source: "identity.firstName", transform: "to_array" },
    { target: "user_data.ln", source: "identity.lastName", transform: "to_array" },
    { target: "user_data.ct", source: "identity.city", transform: "to_array" },
    { target: "user_data.country", source: "identity.country", transform: "to_array" },
    { target: "user_data.zp", source: "identity.postalCode", transform: "to_array" },
    { target: "user_data.external_id", source: "identity.externalId", transform: "to_array" },
    { target: "user_data.fbp", source: "attribution.meta.fbp" },
    { target: "user_data.fbc", source: "attribution.meta.fbc" },
    { target: "user_data.client_ip_address", source: "technical.clientIpAddress" },
    { target: "user_data.client_user_agent", source: "technical.clientUserAgent" },
    {
      target: "custom_data.value",
      source: "payload.valueMinor",
      transform: "minor_to_major",
      when: MARKETING_CONSENTED,
    },
    { target: "custom_data.currency", source: "payload.currency" },
    { target: "custom_data.order_id", source: "payload.orderId" },
  ],
};

const GA4_MAPPING: MappingProfile = {
  key: "ga4.mp.mapping",
  version: 1,
  destination: "ga4.mp",
  fields: [
    { target: "client_id", source: "identity.clientId", required: true },
    { target: "user_id", source: "identity.customerId" },
    { target: "timestamp_micros", source: "event.timestampMs" },
    { target: "events.0.name", source: "event.name", required: true },
    { target: "events.0.params.transaction_id", source: "payload.orderId" },
    { target: "events.0.params.value", source: "payload.valueMinor", transform: "minor_to_major" },
    { target: "events.0.params.currency", source: "payload.currency" },
    { target: "events.0.params.engagement_time_msec", defaultValue: 1 },
  ],
};

const TIKTOK_MAPPING: MappingProfile = {
  key: "tiktok.events.mapping",
  version: 1,
  destination: "tiktok.events",
  fields: [
    { target: "event", source: "event.name", required: true },
    { target: "event_id", source: "event.dedupId", required: true },
    {
      target: "event_time",
      source: "event.timestamp",
      transform: "to_unix_seconds",
      required: true,
    },
    { target: "user.email", source: "identity.email" },
    { target: "user.phone", source: "identity.phone" },
    { target: "user.external_id", source: "identity.externalId" },
    { target: "user.ttclid", source: "attribution.ttclid" },
    { target: "user.ip", source: "technical.clientIpAddress" },
    { target: "user.user_agent", source: "technical.clientUserAgent" },
    { target: "properties.value", source: "payload.valueMinor", transform: "minor_to_major" },
    { target: "properties.currency", source: "payload.currency" },
  ],
};

function clickIdMapping(
  key: string,
  destinationKey: string,
  clickIdTarget: string,
  clickIdSource: string,
): MappingProfile {
  return {
    key,
    version: 1,
    destination: destinationKey,
    fields: [
      { target: "event_name", source: "event.name", required: true },
      { target: "event_id", source: "event.dedupId", required: true },
      {
        target: "event_time",
        source: "event.timestamp",
        transform: "to_unix_seconds",
        required: true,
      },
      { target: "user_data.em", source: "identity.email" },
      { target: "user_data.ph", source: "identity.phone" },
      { target: "user_data.external_id", source: "identity.externalId" },
      { target: clickIdTarget, source: clickIdSource },
      { target: "user_data.client_ip_address", source: "technical.clientIpAddress" },
      { target: "user_data.client_user_agent", source: "technical.clientUserAgent" },
      { target: "custom_data.value", source: "payload.valueMinor", transform: "minor_to_major" },
      { target: "custom_data.currency", source: "payload.currency" },
    ],
  };
}

/** Seed mapping profiles, one per destination. */
export const SEED_MAPPING_PROFILES: readonly MappingProfile[] = [
  META_MAPPING,
  GA4_MAPPING,
  TIKTOK_MAPPING,
  clickIdMapping("google.ads.mapping", "google.ads", "user_data.gclid", "attribution.gclid"),
  clickIdMapping("snap.capi.mapping", "snap.capi", "user_data.sc_click_id", "attribution.scclid"),
  clickIdMapping(
    "pinterest.capi.mapping",
    "pinterest.capi",
    "user_data.click_id",
    "attribution.epik",
  ),
  clickIdMapping(
    "linkedin.capi.mapping",
    "linkedin.capi",
    "user_data.li_fat_id",
    "attribution.li_fat_id",
  ),
  clickIdMapping(
    "microsoft.ads.mapping",
    "microsoft.ads",
    "user_data.msclkid",
    "attribution.msclkid",
  ),
  clickIdMapping("x.ads.mapping", "x.ads", "user_data.twclid", "attribution.twclid"),
];

/** Every seed profile key, so a destination's `mappingProfileKey` can be integrity-checked. */
export const SEED_PROFILE_KEYS: readonly string[] = SEED_MAPPING_PROFILES.map((p) => p.key);
