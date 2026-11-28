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
import { leadEnvelope } from "./lead-event";
import type { BusinessEventContext, LeadTrackingReadModel } from "./order-read-model";

const hasher: HashPort = {
  sha256Hex: async (s) => createHash("sha256").update(s, "utf8").digest("hex"),
};
const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

const TENANT = "22222222-2222-4222-8222-222222222222";
const LEAD_ID = "0193a1b2-0000-7000-8000-0000000000bb";
const SUBMITTED_AT = "2026-11-27T10:00:00.000Z";
const NOW = new Date("2026-11-27T10:00:05.000Z");
const STORE_URL = "https://clinic.example/";
const PAGE_URL = "https://clinic.example/offers?utm_source=meta";
const CTX: BusinessEventContext = { tenantId: TENANT, storeUrl: STORE_URL, currency: "EGP" };

function lead(overrides: Partial<LeadTrackingReadModel> = {}): LeadTrackingReadModel {
  return {
    leadId: LEAD_ID,
    name: "Mona Said El Sayed",
    phone: "01012345678",
    phoneE164: "+201012345678",
    email: "Test@Example.com",
    submittedAt: SUBMITTED_AT,
    snapshot: {
      visitorId: "visitor-1",
      sessionId: "sess-1",
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 (test)",
      pageUrl: PAGE_URL,
      cookies: {
        fbp: "fb.1.1764000000000.123456789",
        ttp: "ttp-abc",
        ga: "GA1.1.1111111111.1764000000",
      },
      utm: { source: "meta" },
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

async function payloads(
  envelope: TrackingEnvelope,
): Promise<Record<VendorBuilderKey, ReturnType<typeof buildVendorPayload>>> {
  const completed: EnrichedEnvelope = {
    ...envelope,
    dedupId: envelope.dedupId!,
    eventTimestampMs: Date.parse(envelope.timestamp),
    receivedAt: NOW.toISOString(),
    environment: "production",
    tenancy: { ...envelope.tenancy, tenantId: TENANT },
    consent: applyConsentPolicy(envelope.consent, "notice_only", NOW),
  };
  const normalized = normalizeIdentity(completed.context.identity ?? {}, {
    defaultCountryCode: "20",
  });
  const out = {} as Record<VendorBuilderKey, ReturnType<typeof buildVendorPayload>>;
  for (const builder of BUILDERS) {
    const keys = await platformMatchKeys(MATCH_PLATFORM_OF[builder], normalized, hasher);
    out[builder] = buildVendorPayload(
      builder,
      vendorEventInputFrom(completed, keys, NOW.getTime()),
      { id: "TARGET-1" },
    );
  }
  return out;
}

function payloadOf(result: ReturnType<typeof buildVendorPayload>): Record<string, unknown> {
  if (!result.ok) throw new Error(`build refused: ${result.reason}`);
  return result.payload as Record<string, unknown>;
}

describe("leadEnvelope", () => {
  it("builds the server-origin form_submitted envelope with the lead_ business id", () => {
    expect.hasAssertions();
    const envelope = leadEnvelope(lead(), CTX);
    expect(envelope).toMatchObject({
      eventName: "form_submitted",
      dedupId: `lead_${LEAD_ID}`,
      eventId: businessMessageId(TENANT, `lead_${LEAD_ID}`),
      timestamp: SUBMITTED_AT,
      source: "server",
      eventOrigin: "server",
      environment: "production",
      tenancy: { tenantId: TENANT },
      context: {
        page: { eventSourceUrl: PAGE_URL, url: PAGE_URL },
        session: { visitorId: "visitor-1", sessionId: "sess-1" },
        technical: { clientIpAddress: "203.0.113.7" },
        identity: {
          hashStatus: "raw",
          email: "Test@Example.com",
          phone: "+201012345678",
          firstName: "Mona",
          lastName: "Said El Sayed",
          visitorId: "visitor-1",
        },
      },
    });
    expect(envelope.payload).toBeUndefined();
    expect(isBusinessConversion(envelope)).toBe(true);
    expect(validateEnvelope(envelope, { now: NOW })).toEqual({ valid: true });
  });

  it("normalises a national phone from the store currency when there is no E.164", () => {
    expect.hasAssertions();
    const envelope = leadEnvelope(lead({ phoneE164: undefined }), CTX);
    expect(envelope.context.identity?.phone).toBe("+201012345678");
    const saudi = leadEnvelope(lead({ phoneE164: undefined, phone: "0512345678" }), {
      ...CTX,
      currency: "SAR",
    });
    expect(saudi.context.identity?.phone).toBe("+966512345678");
  });

  it("uses the store url when the snapshot has no page, and maps a lead with no snapshot", () => {
    expect.hasAssertions();
    const envelope = leadEnvelope(lead({ snapshot: undefined }), CTX);
    expect(envelope.context.page?.eventSourceUrl).toBe(STORE_URL);
    expect(envelope.context.technical).toBeUndefined();
    expect(envelope.context.session).toBeUndefined();
  });

  it("carries only what the read model has: no message, no form id", () => {
    expect.hasAssertions();
    const text = JSON.stringify(
      leadEnvelope({ ...lead(), message: "I am sick" } as LeadTrackingReadModel, CTX),
    );
    expect(text).not.toContain("I am sick");
    expect(text).not.toContain("message");
  });

  it("is deterministic and refuses a bad id or time", () => {
    expect.hasAssertions();
    expect(leadEnvelope(lead(), CTX)).toEqual(leadEnvelope(lead(), CTX));
    expect(() => leadEnvelope(lead({ leadId: "bad id" }), CTX)).toThrow(RangeError);
    expect(() => leadEnvelope(lead({ submittedAt: "yesterday" }), CTX)).toThrow(RangeError);
  });

  it("builds a Lead on Meta and TikTok, SIGN_UP on Snap and generate_lead on GA4", async () => {
    expect.hasAssertions();
    const built = await payloads(leadEnvelope(lead(), CTX));
    const dedup = `lead_${LEAD_ID}`;
    const seconds = Math.floor(Date.parse(SUBMITTED_AT) / 1000);

    expect(payloadOf(built["meta.capi.v27"])).toEqual({
      data: [
        {
          event_name: "Lead",
          event_time: seconds,
          event_id: dedup,
          action_source: "website",
          event_source_url: PAGE_URL,
          user_data: {
            em: [sha("test@example.com")],
            ph: [sha("201012345678")],
            fn: [sha("mona")],
            ln: [sha("saidelsayed")],
            client_ip_address: "203.0.113.7",
            client_user_agent: "Mozilla/5.0 (test)",
            fbp: "fb.1.1764000000000.123456789",
          },
        },
      ],
    });
    expect(payloadOf(built["tiktok.events.v1_3"])).toEqual({
      event_source: "web",
      event_source_id: "TARGET-1",
      data: [
        {
          event: "Lead",
          event_time: seconds,
          event_id: dedup,
          user: {
            email: sha("test@example.com"),
            phone: sha("+201012345678"),
            ttp: "ttp-abc",
            ip: "203.0.113.7",
            user_agent: "Mozilla/5.0 (test)",
          },
          page: { url: PAGE_URL },
        },
      ],
    });
    expect(payloadOf(built["snap.capi.v3"])).toEqual({
      data: [
        {
          event_name: "SIGN_UP",
          event_time: seconds,
          event_id: dedup,
          action_source: "WEB",
          event_source_url: PAGE_URL,
          user_data: {
            em: [sha("test@example.com")],
            ph: [sha("201012345678")],
            fn: [sha("mona")],
            ln: [sha("saidelsayed")],
            client_ip_address: "203.0.113.7",
            client_user_agent: "Mozilla/5.0 (test)",
          },
        },
      ],
    });
    expect(payloadOf(built["ga4.mp"])).toEqual({
      client_id: "1111111111.1764000000",
      timestamp_micros: Date.parse(SUBMITTED_AT) * 1000,
      consent: { ad_user_data: "GRANTED", ad_personalization: "DENIED" },
      user_data: {
        sha256_email_address: [sha("test@example.com")],
        sha256_phone_number: [sha("+201012345678")],
        address: [{ sha256_first_name: sha("mona"), sha256_last_name: sha("saidelsayed") }],
      },
      events: [
        {
          name: "generate_lead",
          params: { engagement_time_msec: 1, page_location: PAGE_URL },
        },
      ],
    });
  });

  it("a lead with no _ga gets the synthetic GA4 id seeded by its visitor, else by its lead id", async () => {
    expect.hasAssertions();
    const withVisitor = await payloads(
      leadEnvelope(lead({ snapshot: { visitorId: "visitor-9", pageUrl: PAGE_URL } }), CTX),
    );
    expect(payloadOf(withVisitor["ga4.mp"]).client_id).toBe(syntheticGaClientId("visitor-9"));

    const anonymous = await payloads(leadEnvelope(lead({ snapshot: undefined }), CTX));
    expect(payloadOf(anonymous["ga4.mp"]).client_id).toBe(syntheticGaClientId(`lead_${LEAD_ID}`));
  });

  it("sends no raw email, phone or name to any vendor", async () => {
    expect.hasAssertions();
    const built = await payloads(leadEnvelope(lead(), CTX));
    const text = JSON.stringify(Object.values(built).map(payloadOf));
    for (const raw of [
      "test@example.com",
      "Test@Example.com",
      "01012345678",
      "201012345678",
      "Mona",
      "mona",
    ]) {
      expect(text).not.toContain(raw);
    }
  });
});
