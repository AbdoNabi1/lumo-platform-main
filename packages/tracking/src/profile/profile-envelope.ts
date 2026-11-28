/**
 * The envelope ⇄ profile bridge (Tracking P1-D4): what an event teaches a profile, and what a profile gives back
 * to an event that arrives without it.
 *
 * Giving back reuses the existing, previously unwired enrichment (`enrichContext` / `mergeClickIds`) rather than a
 * second merge: the event keeps everything it asserted itself, and only its GAPS are filled — click ids and the
 * Meta cookies from the profile, TikTok / Snap / GA browser ids, the last IP and user agent (a server event
 * has neither), a page url for `event_source_url`, the customer id, the landing campaign.
 */

import {
  CLICK_ID_DEFINITIONS,
  fbcCreatedAtMs,
  isClickIdName,
  isFbcValidAt,
  type CapturedClickId,
} from "../envelope/click-ids";
import type { EnrichedEnvelope, TrackingContext } from "../envelope/envelope";
import type { IdentityContext } from "../envelope/identity-context";
import type { TechnicalContext } from "../envelope/technical-context";
import { enrichContext, type PersistedAttribution } from "../pipeline/enrichment";
import { toCapturedClickId } from "./profile-merge";
import type {
  ProfileBrowserIds,
  ProfileHashes,
  ProfileLandingTouch,
  ProfileObservation,
  TrackingProfile,
} from "./tracking-profile";
import { MAX_CLICK_ID_LENGTH, hasMatchKeys } from "./tracking-profile";

const MAX_VISITOR_ID_LENGTH = 128;

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== "" ? value.trim() : undefined;
}

function compact<T extends object>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result as T;
}

/** The cookie id of the visitor an event belongs to, from wherever the emitter put it. */
export function visitorIdOf(envelope: EnrichedEnvelope): string | undefined {
  const { session, identity, user } = envelope.context;
  const candidate =
    nonEmpty(session?.visitorId) ?? nonEmpty(identity?.visitorId) ?? nonEmpty(user?.visitorId);
  return candidate !== undefined && candidate.length <= MAX_VISITOR_ID_LENGTH
    ? candidate
    : undefined;
}

export function customerIdOf(envelope: EnrichedEnvelope): string | undefined {
  return (
    nonEmpty(envelope.context.identity?.customerId) ?? nonEmpty(envelope.context.user?.customerId)
  );
}

/** The instant Meta itself stamped into an `fbc` cookie, as an ISO string; undefined if it does not parse. */
export function fbcCreatedAt(fbc: string | undefined): string | undefined {
  const created = fbcCreatedAtMs(fbc);
  return created === undefined ? undefined : new Date(created).toISOString();
}

/**
 * What this event teaches the profile. `hashes` come from the caller (they need the hasher); everything else is
 * read straight off the envelope. Order and lead ids are taken from the event's own business identifiers.
 */
export function observationFromEnvelope(
  envelope: EnrichedEnvelope,
  hashes: ProfileHashes,
): ProfileObservation {
  const { page, technical, attribution, marketing } = envelope.context;
  const at = envelope.receivedAt;

  const clickIds: Partial<
    Record<keyof typeof CLICK_ID_DEFINITIONS, { value: string; capturedAt: string }>
  > = {};
  for (const click of attribution?.clickIds ?? []) {
    if (!isClickIdName(click.name)) continue;
    const value = click.value.trim();
    if (value === "" || value.length > MAX_CLICK_ID_LENGTH) continue;
    clickIds[click.name] = { value, capturedAt: click.capturedAt };
  }

  const fbc = nonEmpty(attribution?.meta?.fbc);
  const browser: ProfileBrowserIds = compact({
    fbp: nonEmpty(attribution?.meta?.fbp),
    fbc,
    fbcCapturedAt: fbc === undefined ? undefined : (fbcCreatedAt(fbc) ?? at),
    ttp: nonEmpty(attribution?.browserIds?.ttp),
    scid: nonEmpty(attribution?.browserIds?.scid),
    gaClientId: nonEmpty(attribution?.browserIds?.gaClientId),
    gaSessionId: nonEmpty(attribution?.browserIds?.gaSessionId),
  });

  const utmSource = nonEmpty(attribution?.utmSource) ?? nonEmpty(marketing?.utmSource);
  const utmMedium = nonEmpty(attribution?.utmMedium) ?? nonEmpty(marketing?.utmMedium);
  const utmCampaign = nonEmpty(attribution?.utmCampaign) ?? nonEmpty(marketing?.utmCampaign);
  const utmContent = nonEmpty(attribution?.utmContent) ?? nonEmpty(marketing?.utmContent);
  const utmTerm = nonEmpty(attribution?.utmTerm) ?? nonEmpty(marketing?.utmTerm);
  const pageUrl = nonEmpty(page?.eventSourceUrl) ?? nonEmpty(page?.url);

  // A landing touch is a visit that CARRIES a campaign signal (UTMs or a click id); an ordinary page view of a
  // returning visitor must not overwrite the campaign that brought them.
  const aiSource = nonEmpty(attribution?.aiSource);
  const hasCampaignSignal =
    aiSource !== undefined ||
    utmSource !== undefined ||
    utmMedium !== undefined ||
    utmCampaign !== undefined ||
    Object.keys(clickIds).length > 0;
  const landing: ProfileLandingTouch | undefined = hasCampaignSignal
    ? compact({
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        utmTerm,
        referrer: nonEmpty(page?.referrer) ?? nonEmpty(attribution?.referrer),
        pageUrl: nonEmpty(attribution?.landingPage) ?? pageUrl,
        aiSource,
        at,
      })
    : undefined;

  const leadIds: string[] = [];
  if (envelope.dedupId.startsWith("lead_")) leadIds.push(envelope.dedupId.slice("lead_".length));
  const orderId = nonEmpty(envelope.payload?.orderId);

  const visitorId = visitorIdOf(envelope);
  const customerId = customerIdOf(envelope);
  const ip = nonEmpty(technical?.clientIpAddress);
  const userAgent = nonEmpty(technical?.clientUserAgent);
  const geo = compact({
    country: nonEmpty(technical?.countryDetected),
    region: nonEmpty(technical?.regionDetected),
    city: nonEmpty(technical?.cityDetected),
  });
  const botScore = technical?.botScore;
  const fingerprintId = nonEmpty(technical?.fingerprintId);

  return {
    tenantId: envelope.tenancy.tenantId,
    ...(visitorId === undefined ? {} : { visitorId }),
    ...(customerId === undefined ? {} : { customerId }),
    at,
    hashes,
    clickIds: clickIds,
    browser,
    ...(ip === undefined ? {} : { ip }),
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(pageUrl === undefined ? {} : { pageUrl }),
    ...(landing === undefined ? {} : { landing }),
    ...(Object.keys(geo).length === 0 ? {} : { geo }),
    ...(botScore === undefined ? {} : { botScore }),
    ...(fingerprintId === undefined ? {} : { fingerprintId }),
    leadIds,
    orderIds: orderId === undefined ? [] : [orderId],
  };
}

/** True when an event carries nothing to key a profile on or to store in one. */
export function isObservable(observation: ProfileObservation): boolean {
  return (
    observation.visitorId !== undefined ||
    observation.customerId !== undefined ||
    observation.hashes.emailStd !== undefined ||
    observation.hashes.phoneE164 !== undefined
  );
}

/**
 * The event, completed from the profile. Existing values always win; the TTL is judged at the event's own
 * `receivedAt`, so a click id past its platform's window is dropped from the event (and was dropped from the
 * profile when it expired).
 */
export function enrichEnvelopeWithProfile(
  envelope: EnrichedEnvelope,
  profile: TrackingProfile,
): EnrichedEnvelope {
  const now = new Date(envelope.receivedAt);
  const context = envelope.context;

  const persistedClickIds: CapturedClickId[] = [];
  for (const [name, click] of Object.entries(profile.clickIds)) {
    if (isClickIdName(name)) persistedClickIds.push(toCapturedClickId(name, click));
  }

  // `fbc` is only forwarded inside Meta's window (judged by the time it was captured, else by the time Meta
  // stamped into it); `fbp` carries no expiry of its own.
  const fbcAge = Date.parse(envelope.receivedAt) - Date.parse(profile.browser.fbcCapturedAt ?? "");
  const fbcUsable =
    profile.browser.fbc !== undefined &&
    (Number.isNaN(fbcAge)
      ? isFbcValidAt(profile.browser.fbc, now)
      : fbcAge <= CLICK_ID_DEFINITIONS.fbclid.ttlDays * 24 * 60 * 60 * 1000);

  const persisted: PersistedAttribution = compact({
    clickIds: persistedClickIds,
    meta: compact({
      fbp: profile.browser.fbp,
      fbc: fbcUsable ? profile.browser.fbc : undefined,
    }),
    landingPage: profile.landing?.pageUrl,
    referrer: profile.landing?.referrer,
    utmSource: profile.landing?.utmSource,
    utmMedium: profile.landing?.utmMedium,
    utmCampaign: profile.landing?.utmCampaign,
    utmContent: profile.landing?.utmContent,
    utmTerm: profile.landing?.utmTerm,
  });

  const ownTechnical = context.technical;
  const technical: TechnicalContext = compact({
    clientIpAddress: profile.lastIp,
    clientUserAgent: profile.lastUserAgent,
    countryDetected: profile.geo?.country,
    regionDetected: profile.geo?.region,
    cityDetected: profile.geo?.city,
  });

  const needsSourceUrl =
    nonEmpty(context.page?.eventSourceUrl) === undefined &&
    nonEmpty(context.page?.url) === undefined;

  const enriched = enrichContext({
    context,
    persisted,
    observedClickIds: context.attribution?.clickIds,
    ...(Object.keys(technical).length === 0 && ownTechnical === undefined ? {} : { technical }),
    ...(needsSourceUrl && profile.lastPageUrl !== undefined
      ? { page: { eventSourceUrl: profile.lastPageUrl } }
      : {}),
    now,
  });

  const ownBrowserIds = context.attribution?.browserIds;
  const browserIds = compact({
    ttp: nonEmpty(ownBrowserIds?.ttp) ?? profile.browser.ttp,
    scid: nonEmpty(ownBrowserIds?.scid) ?? profile.browser.scid,
    gaClientId: nonEmpty(ownBrowserIds?.gaClientId) ?? profile.browser.gaClientId,
    gaSessionId: nonEmpty(ownBrowserIds?.gaSessionId) ?? profile.browser.gaSessionId,
  });

  const customerId = customerIdOf(envelope) ?? profile.customerId;

  // The delivery gate refuses an event with no identity block at all. An event that arrives without one but
  // whose visitor the profile knows by email or phone gets a block of HASHES (`hashStatus: sha256`, the form the
  // gate forwards) — the per-platform keys themselves are handed to delivery separately. An event that already
  // has an identity block keeps it untouched.
  const identity: IdentityContext | undefined =
    context.identity === undefined && hasMatchKeys(profile.hashes)
      ? compact({
          hashStatus: "sha256" as const,
          visitorId: profile.visitorId,
          customerId,
          email: profile.hashes.emailStd,
          phone: profile.hashes.phoneE164,
        })
      : context.identity;

  const completed: TrackingContext = {
    ...enriched,
    ...(identity === undefined ? {} : { identity }),
    attribution: {
      ...enriched.attribution,
      ...(Object.keys(browserIds).length === 0 ? {} : { browserIds }),
    },
    ...(customerId === undefined || customerIdOf(envelope) !== undefined
      ? {}
      : { user: { ...enriched.user, customerId } }),
  };

  return { ...envelope, context: completed };
}
