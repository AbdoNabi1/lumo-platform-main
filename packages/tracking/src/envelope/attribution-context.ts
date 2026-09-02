/**
 * Attribution block (doc 16 §6.4, doc 17). Carries the campaign surface of an event plus the
 * captured click identifiers. Credit *assignment* (first/last/linear/time-decay/position/data-
 * driven) is computed by the attribution stage over a journey's touchpoints — this module holds
 * the captured facts those models read, never the models' output.
 */

import type { CapturedClickId, MetaBrowserIds } from "./click-ids";

/** Channel grouping, resolved once at capture so reports never re-derive it inconsistently. */
export type ChannelGroup =
  | "direct"
  | "organic_search"
  | "paid_search"
  | "organic_social"
  | "paid_social"
  | "email"
  | "referral"
  | "display"
  | "affiliate"
  | "marketplace"
  | "sms"
  | "push"
  | "influencer"
  | "offline"
  | "internal"
  | "other"
  | "unknown";

export const CHANNEL_GROUPS: readonly ChannelGroup[] = [
  "direct",
  "organic_search",
  "paid_search",
  "organic_social",
  "paid_social",
  "email",
  "referral",
  "display",
  "affiliate",
  "marketplace",
  "sms",
  "push",
  "influencer",
  "offline",
  "internal",
  "other",
  "unknown",
];

/** Multi-touch credit models (doc 17 §5). All are computed over the same stored touchpoints. */
export type AttributionModel =
  "first_touch" | "last_touch" | "linear" | "time_decay" | "position_based" | "data_driven";

export const ATTRIBUTION_MODELS: readonly AttributionModel[] = [
  "first_touch",
  "last_touch",
  "linear",
  "time_decay",
  "position_based",
  "data_driven",
];

export interface AttributionContext {
  // UTM surface
  readonly utmSource?: string;
  readonly utmMedium?: string;
  readonly utmCampaign?: string;
  readonly utmContent?: string;
  readonly utmTerm?: string;

  // Page surface
  readonly landingPage?: string;
  readonly entryPage?: string;
  readonly exitPage?: string;
  readonly referrer?: string;

  // Resolved source classification
  readonly organicSource?: string;
  readonly paidSource?: string;
  readonly socialSource?: string;
  readonly channelGroup?: ChannelGroup;
  readonly trafficSource?: string;

  // Paid-media surface
  readonly campaign?: string;
  readonly adGroup?: string;
  readonly ad?: string;
  readonly creative?: string;
  readonly placement?: string;
  readonly keyword?: string;
  readonly audience?: string;

  /** Every click identifier captured for this visitor that is still within its window. */
  readonly clickIds?: readonly CapturedClickId[];
  /** Meta's derived first-party cookies, carried separately from the raw `fbclid`. */
  readonly meta?: MetaBrowserIds;

  /**
   * The consideration cycle this event belongs to (doc 17 §3). A conversion attributes against
   * the touchpoints of its open journey.
   */
  readonly journeyId?: string;
  /** Position of this touch within the journey, 1-based; set by the attribution stage. */
  readonly touchIndex?: number;
}

/**
 * A touch retained for credit assignment. Journeys are recomputable from these, which is what
 * makes model changes retroactive rather than forward-only.
 */
export interface Touchpoint {
  readonly journeyId: string;
  readonly occurredAt: string;
  readonly channelGroup: ChannelGroup;
  readonly source?: string;
  readonly medium?: string;
  readonly campaign?: string;
  readonly clickId?: CapturedClickId;
}

/** Credit assigned to one touch under one model; sums to 1 across a journey. */
export interface AttributionCredit {
  readonly touchIndex: number;
  readonly model: AttributionModel;
  readonly weight: number;
}
