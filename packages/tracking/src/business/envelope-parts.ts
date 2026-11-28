/**
 * The parts of a business envelope that orders and leads build the same way: the snapshot becomes page, technical,
 * session and attribution context; the customer becomes the raw identity block. Internal to `business/`.
 */

import { isClickIdName, type CapturedClickId } from "../envelope/click-ids";
import { DENY_ALL_CONSENT } from "../envelope/consent";
import type { AttributionContext } from "../envelope/attribution-context";
import type {
  PageContext,
  SessionContext,
  TrackingContext,
  TrackingEnvelope,
  EventCategory,
} from "../envelope/envelope";
import type { IdentityContext } from "../envelope/identity-context";
import type { TechnicalContext } from "../envelope/technical-context";
import { gaClientIdFromCookie } from "../delivery/vendor-event-input";
import { normalizePhone } from "../pipeline/normalization";
import { splitFullName } from "../pipeline/platform-identity";
import { callingCodeForCurrency } from "./calling-code";
import { businessMessageId } from "./event-uuid";
import type { BusinessAttributionSnapshot } from "./order-read-model";

/** Removes keys whose value is undefined or an empty string, so a block is either useful or absent. */
export function defined<T extends object>(value: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) continue;
    if (typeof entry === "string" && entry.trim() === "") continue;
    out[key] = entry;
  }
  return out as Partial<T>;
}

function blockOrUndefined<T extends object>(value: T): Partial<T> | undefined {
  const cleaned = defined(value);
  return Object.keys(cleaned).length === 0 ? undefined : cleaned;
}

/** An ISO-8601 instant, or a RangeError that names the field (never the value of a customer field). */
export function instantOrThrow(value: string | undefined, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new RangeError(`${field} must be an ISO-8601 instant`);
  }
  return value;
}

export function pageContextOf(
  snapshot: BusinessAttributionSnapshot | undefined,
  storeUrl: string,
  currency: string | undefined,
): PageContext {
  const pageUrl = snapshot?.pageUrl?.trim() ?? "";
  return defined({
    eventSourceUrl: pageUrl !== "" ? pageUrl : storeUrl,
    url: pageUrl,
    referrer: snapshot?.referrer,
    currency,
  });
}

export function sessionContextOf(
  snapshot: BusinessAttributionSnapshot | undefined,
): SessionContext | undefined {
  return snapshot === undefined
    ? undefined
    : blockOrUndefined({ visitorId: snapshot.visitorId, sessionId: snapshot.sessionId });
}

export function technicalContextOf(
  snapshot: BusinessAttributionSnapshot | undefined,
): TechnicalContext | undefined {
  return snapshot === undefined
    ? undefined
    : blockOrUndefined({
        clientIpAddress: snapshot.ip,
        clientUserAgent: snapshot.userAgent,
      });
}

export function attributionContextOf(
  snapshot: BusinessAttributionSnapshot | undefined,
): AttributionContext | undefined {
  if (snapshot === undefined) return undefined;

  const clickIds: CapturedClickId[] = [];
  for (const click of snapshot.clickIds ?? []) {
    if (!isClickIdName(click.name) || click.value.trim() === "") continue;
    clickIds.push({ name: click.name, value: click.value.trim(), capturedAt: click.capturedAt });
  }

  const cookies = snapshot.cookies;
  const meta = blockOrUndefined({ fbp: cookies?.fbp, fbc: cookies?.fbc });
  // Only a REAL `_ga` client id goes into the envelope. A synthetic one is derived at build time (see
  // `vendorEventInputFrom`) so that the visitor's profile never learns it and can still supply the real one.
  const browserIds = blockOrUndefined({
    ttp: cookies?.ttp,
    scid: cookies?.scid,
    gaClientId: gaClientIdFromCookie(cookies?.ga) ?? undefined,
  });

  return blockOrUndefined({
    utmSource: snapshot.utm?.source,
    utmMedium: snapshot.utm?.medium,
    utmCampaign: snapshot.utm?.campaign,
    utmContent: snapshot.utm?.content,
    utmTerm: snapshot.utm?.term,
    clickIds: clickIds.length === 0 ? undefined : clickIds,
    meta,
    browserIds,
  });
}

/** First candidate that normalises to E.164; a number that cannot is dropped rather than guessed. */
export function e164Of(
  candidates: readonly (string | undefined)[],
  currency: string | undefined,
): string | undefined {
  const code = callingCodeForCurrency(currency);
  for (const candidate of candidates) {
    const normalized = normalizePhone(candidate, code);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

export function identityOf(input: {
  readonly email?: string | undefined;
  readonly phone?: string | undefined;
  readonly name?: string | undefined;
  readonly customerId?: string | undefined;
  readonly visitorId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly city?: string | undefined;
  readonly state?: string | undefined;
  readonly country?: string | undefined;
}): IdentityContext {
  const { firstName, lastName } = splitFullName(input.name);
  return {
    ...defined({
      customerId: input.customerId,
      visitorId: input.visitorId,
      sessionId: input.sessionId,
      email: input.email?.trim(),
      phone: input.phone,
      firstName,
      lastName,
      city: input.city,
      state: input.state,
      country: input.country,
    }),
    hashStatus: "raw",
  };
}

/** The envelope fields every server-origin business event shares. */
export function businessEnvelope(input: {
  readonly tenantId: string;
  readonly eventName: string;
  readonly dedupId: string;
  readonly timestamp: string;
  readonly category: EventCategory;
  readonly context: TrackingContext;
  readonly payload?: TrackingEnvelope["payload"];
  readonly properties?: Record<string, unknown>;
}): TrackingEnvelope {
  return {
    eventId: businessMessageId(input.tenantId, input.dedupId),
    eventName: input.eventName,
    eventVersion: 1,
    dedupId: input.dedupId,
    timestamp: input.timestamp,
    source: "server",
    eventOrigin: "server",
    actionSource: "website",
    eventType: "track",
    eventCategory: input.category,
    environment: "production",
    // The store's consent policy decides at ingest (P2-D1). Until then the snapshot is the fail-closed one.
    consent: DENY_ALL_CONSENT,
    tenancy: { tenantId: input.tenantId },
    context: input.context,
    properties: input.properties ?? {},
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  };
}
