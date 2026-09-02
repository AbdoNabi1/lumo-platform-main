/**
 * Enrichment stage (directive §Enrichment).
 *
 * Fills in page, device, geo, campaign and channel context, and — most importantly — **preserves
 * every advertising click identifier across the session**. A click id captured on the landing page
 * must still be present at checkout, possibly days later, or the conversion cannot be forwarded to
 * the platform that paid for it.
 *
 * Preservation is a merge, never a replace: previously captured click ids survive an event that
 * carries none. Overwriting on every page view is the classic way attribution silently collapses
 * to "direct" mid-funnel.
 */

import type { AttributionContext } from "../envelope/attribution-context";
import type { CapturedClickId, ClickIdName, MetaBrowserIds } from "../envelope/click-ids";
import { isClickIdValidAt } from "../envelope/click-ids";
import type { PageContext, TrackingContext } from "../envelope/envelope";
import type { TechnicalContext } from "../envelope/technical-context";
import { resolveChannel } from "./channel-resolver";

/** Campaign/click state carried forward for a visitor, supplied by the session store. */
export interface PersistedAttribution {
  readonly clickIds?: readonly CapturedClickId[];
  readonly meta?: MetaBrowserIds;
  readonly landingPage?: string;
  readonly entryPage?: string;
  readonly referrer?: string;
  readonly utmSource?: string;
  readonly utmMedium?: string;
  readonly utmCampaign?: string;
  readonly utmContent?: string;
  readonly utmTerm?: string;
  readonly journeyId?: string;
}

export interface EnrichmentInput {
  readonly context: TrackingContext;
  /** State already persisted against this visitor/journey. */
  readonly persisted?: PersistedAttribution;
  /** Click ids observed on *this* request, if it is a landing. */
  readonly observedClickIds?: readonly CapturedClickId[];
  readonly page?: PageContext;
  readonly technical?: TechnicalContext;
  readonly selfHosts?: readonly string[];
  readonly now: Date;
}

/**
 * Merges click ids, newest observation winning per identifier, and drops any that have aged out of
 * their platform's attribution window — forwarding an expired click id is rejected by the vendor
 * and pollutes match-quality diagnostics.
 */
export function mergeClickIds(
  persisted: readonly CapturedClickId[] | undefined,
  observed: readonly CapturedClickId[] | undefined,
  now: Date,
): readonly CapturedClickId[] {
  const byName = new Map<ClickIdName, CapturedClickId>();

  for (const clickId of persisted ?? []) {
    byName.set(clickId.name, clickId);
  }
  for (const clickId of observed ?? []) {
    // A fresh observation replaces a stored one: the campaign resolved now is more current.
    byName.set(clickId.name, clickId);
  }

  return [...byName.values()].filter((clickId) => isClickIdValidAt(clickId, now));
}

/** First defined, non-empty string. Used so a persisted value survives an event that omits it. */
function firstPresent(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * Builds the enriched attribution block. Persisted campaign values win over absent ones but never
 * over a newly observed campaign — a visitor arriving on a *new* campaign starts a new touch.
 */
export function enrichAttribution(input: EnrichmentInput): AttributionContext {
  const persisted = input.persisted;
  const existing = input.context.attribution;
  const marketing = input.context.marketing;

  const clickIds = mergeClickIds(persisted?.clickIds, input.observedClickIds, input.now);

  const utmSource = firstPresent(existing?.utmSource, marketing?.utmSource, persisted?.utmSource);
  const utmMedium = firstPresent(existing?.utmMedium, marketing?.utmMedium, persisted?.utmMedium);
  const utmCampaign = firstPresent(
    existing?.utmCampaign,
    marketing?.utmCampaign,
    persisted?.utmCampaign,
  );
  const referrer = firstPresent(existing?.referrer, input.page?.referrer, persisted?.referrer);

  const resolution = resolveChannel({
    utmSource,
    utmMedium,
    utmCampaign,
    referrer,
    clickIds: clickIds.map((c) => c.name),
    selfHosts: input.selfHosts,
  });

  const enriched: Record<string, unknown> = {
    ...existing,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent: firstPresent(existing?.utmContent, marketing?.utmContent, persisted?.utmContent),
    utmTerm: firstPresent(existing?.utmTerm, marketing?.utmTerm, persisted?.utmTerm),
    referrer,
    landingPage: firstPresent(existing?.landingPage, persisted?.landingPage, input.page?.url),
    entryPage: firstPresent(existing?.entryPage, persisted?.entryPage, input.page?.url),
    exitPage: firstPresent(input.page?.url, existing?.exitPage),
    channelGroup: resolution.channelGroup,
    trafficSource: firstPresent(existing?.trafficSource, resolution.source),
    campaign: firstPresent(existing?.campaign, utmCampaign),
    journeyId: firstPresent(existing?.journeyId, persisted?.journeyId),
    meta: { ...persisted?.meta, ...existing?.meta },
    clickIds,
  };

  for (const key of Object.keys(enriched)) {
    if (enriched[key] === undefined) delete enriched[key];
  }
  if (clickIds.length === 0) delete enriched.clickIds;

  const meta = enriched.meta as MetaBrowserIds | undefined;
  if (meta !== undefined && meta.fbp === undefined && meta.fbc === undefined) {
    delete enriched.meta;
  }

  return enriched;
}

/**
 * Enriches the full tracking context. Existing values always win — enrichment fills gaps, it never
 * overrides what an emitter explicitly asserted.
 */
export function enrichContext(input: EnrichmentInput): TrackingContext {
  const page: PageContext | undefined =
    input.page === undefined && input.context.page === undefined
      ? undefined
      : { ...input.page, ...input.context.page };

  const technical: TechnicalContext | undefined =
    input.technical === undefined && input.context.technical === undefined
      ? undefined
      : { ...input.technical, ...input.context.technical };

  const enriched: TrackingContext = {
    ...input.context,
    ...(page === undefined ? {} : { page }),
    ...(technical === undefined ? {} : { technical }),
    attribution: enrichAttribution(input),
  };

  return enriched;
}
