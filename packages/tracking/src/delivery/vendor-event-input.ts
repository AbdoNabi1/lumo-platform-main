/**
 * The neutral, vendor-agnostic input every vendor builder reads (lead-site plan D1, Task 3).
 *
 * The builders never see an envelope: this projection is the only seam between the envelope and a
 * vendor request, so a field that is not here cannot reach a vendor by accident. Identity arrives
 * only as per-platform match keys (hashes or the platform's plain values) — never as raw PII.
 */

import { isClickIdValidAt, isFbcValidAt } from "../envelope/click-ids";
import type { EnrichedEnvelope } from "../envelope/envelope";
import { deriveNumItems } from "../envelope/payload";
import { syntheticGaClientId } from "../business/ga4-client-id";
import type { PlatformMatchKeys } from "../pipeline/platform-identity";
import { visitorIdOf } from "../profile/profile-envelope";

export interface VendorEventInput {
  readonly eventName: string;
  readonly eventId: string;
  readonly eventTimeMs: number;
  /**
   * The instant the request is being built, for a vendor that refuses old events (GA4: 72 h). Absent => no age check
   * (a caller that does not know the time must not invent one).
   */
  readonly nowMs?: number;
  readonly sourceUrl: string | null;
  readonly referrer: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly customerId: string | null;
  readonly keys: PlatformMatchKeys;
  readonly browser: {
    readonly fbp: string | null;
    readonly fbc: string | null;
    readonly ttp: string | null;
    readonly scid: string | null;
    readonly gaClientId: string | null;
    readonly gaSessionId: string | null;
    readonly ttclid: string | null;
    readonly scClickId: string | null;
  };
  readonly commerce: {
    readonly valueMajor: number | null;
    readonly currency: string | null;
    readonly orderId: string | null;
    readonly contentType: string | null;
    readonly numItems: number | null;
    readonly contentIds: readonly string[];
    readonly contents: readonly {
      readonly id: string;
      readonly quantity: number;
      readonly itemPriceMajor: number | null;
    }[];
  };
  readonly consent: { readonly adUserData: boolean; readonly adPersonalization: boolean };
}

/** Minor units (integer cents) → the decimal major amount every vendor expects. */
function toMajor(minor: number | undefined): number | null {
  return minor === undefined ? null : minor / 100;
}

function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.trim() !== "" ? value : null;
}

/**
 * Projects an enriched envelope plus the destination's own match keys into a builder input.
 *
 * Click ids are found by their canonical key: `ttclid`, and Snap's `scclid` (whose landing-URL
 * parameter is `ScCid` — see `click-ids.ts`).
 *
 * `nowMs` is the instant the vendor request is built (the delivery runtime's clock); it is what GA4's 72-hour window
 * is judged against.
 *
 * GA4 client id (P2-D7): the visitor's real `_ga` client id when the envelope carries one (its own, or the profile's).
 * A SERVER event without one gets a deterministic synthetic id seeded by the visitor id, else by its business id, so a
 * server-only purchase still reaches GA4 without splitting one visitor into many. Browser events never get one: a
 * guessed id would only add a ghost user next to the real one the page's own tag reports.
 */
export function vendorEventInputFrom(
  envelope: EnrichedEnvelope,
  keys: PlatformMatchKeys,
  nowMs?: number,
): VendorEventInput {
  const page = envelope.context.page;
  const technical = envelope.context.technical;
  const attribution = envelope.context.attribution;
  const payload = envelope.payload;
  const browserIds = attribution?.browserIds;

  // Click-id windows (Tracking P1-X10): a vendor refuses a click id older than its attribution window and counts
  // the refusal against match diagnostics, so an expired one is not forwarded at all. Judged at the later of the
  // event's own time and the moment it was received — a conversion is credited to the click that preceded it.
  const reference = new Date(
    Math.max(envelope.eventTimestampMs, Date.parse(envelope.receivedAt) || 0),
  );
  const clickIds = (attribution?.clickIds ?? []).filter((click) =>
    isClickIdValidAt(click, reference),
  );
  const fbc = attribution?.meta?.fbc;
  const usableFbc = fbc !== undefined && isFbcValidAt(fbc, reference) ? fbc : undefined;

  const items = payload?.contents ?? [];
  const contents = items.map((item) => ({
    id: item.itemId,
    quantity: item.quantity ?? 1,
    itemPriceMajor: toMajor(item.priceMinor),
  }));
  const explicitIds = payload?.contentIds ?? [];
  const contentIds = explicitIds.length > 0 ? [...explicitIds] : items.map((item) => item.itemId);

  // Absent granular grants fall back to the coarse marketing flag, exactly as the consent gate does.
  const grants = envelope.consent.grants;
  const marketing = envelope.consent.marketing;

  const realGaClientId = nonEmpty(browserIds?.gaClientId);
  const gaClientId =
    realGaClientId ??
    (envelope.eventOrigin === "server"
      ? syntheticGaClientId(visitorIdOf(envelope) ?? envelope.dedupId)
      : null);

  return {
    eventName: envelope.eventName,
    eventId: envelope.dedupId,
    eventTimeMs: envelope.eventTimestampMs,
    ...(nowMs === undefined ? {} : { nowMs }),
    sourceUrl: nonEmpty(page?.eventSourceUrl) ?? nonEmpty(page?.url),
    referrer: nonEmpty(page?.referrer),
    ip: nonEmpty(technical?.clientIpAddress),
    userAgent: nonEmpty(technical?.clientUserAgent),
    customerId: nonEmpty(
      envelope.context.identity?.customerId ?? envelope.context.user?.customerId,
    ),
    keys,
    browser: {
      fbp: nonEmpty(attribution?.meta?.fbp),
      fbc: nonEmpty(usableFbc),
      ttp: nonEmpty(browserIds?.ttp),
      scid: nonEmpty(browserIds?.scid),
      gaClientId,
      gaSessionId: nonEmpty(browserIds?.gaSessionId),
      ttclid: nonEmpty(clickIds.find((click) => click.name === "ttclid")?.value),
      scClickId: nonEmpty(clickIds.find((click) => click.name === "scclid")?.value),
    },
    commerce: {
      valueMajor: toMajor(payload?.valueMinor),
      currency: nonEmpty(payload?.currency),
      orderId: nonEmpty(payload?.orderId),
      contentType: nonEmpty(payload?.contentType),
      numItems: payload?.numItems ?? deriveNumItems(items) ?? null,
      contentIds,
      contents,
    },
    consent: {
      adUserData: (grants?.ad_user_data ?? marketing) === true,
      adPersonalization: (grants?.ad_personalization ?? marketing) === true,
    },
  };
}

/**
 * GA4 client id from a `_ga` cookie: `GA1.1.111111111.1764000000` → `111111111.1764000000`.
 * Anything that is not that shape is `null` — a guessed client id would split one visitor in two.
 */
export function gaClientIdFromCookie(value: string | undefined): string | null {
  if (value === undefined) return null;
  const match = /^GA\d+\.\d+\.(\d+\.\d+)$/u.exec(value.trim());
  return match?.[1] ?? null;
}
