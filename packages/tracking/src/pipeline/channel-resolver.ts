/**
 * Marketing channel resolution (directive §Marketing Channel Detection).
 *
 * One reusable resolver classifies every session, and the result is stamped on every event. Doing
 * this **once at capture** rather than in each report is what stops two dashboards disagreeing
 * about what "paid social" means — and it is why the resolved channel is frozen onto the
 * touchpoint even if the campaign is later renamed.
 *
 * Precedence is deliberate and ordered strongest-evidence-first: a click identifier is proof of a
 * paid click, an explicit `utm_medium` is a declared intent, and a referrer is only an inference.
 */

import type { ChannelGroup } from "../envelope/attribution-context";
import {
  CLICK_ID_DEFINITIONS,
  type ClickIdName,
  type ClickIdPlatform,
} from "../envelope/click-ids";

/** Which channel a paid click on each platform belongs to. */
const PLATFORM_PAID_CHANNEL: Readonly<Record<ClickIdPlatform, ChannelGroup>> = {
  google: "paid_search",
  microsoft: "paid_search",
  meta: "paid_social",
  tiktok: "paid_social",
  snapchat: "paid_social",
  x: "paid_social",
  linkedin: "paid_social",
  pinterest: "paid_social",
};

/** Referrer hosts treated as search engines. Suffix-matched, so subdomains resolve. */
export const SEARCH_ENGINE_HOSTS: readonly string[] = [
  "google.com",
  "google.co.uk",
  "bing.com",
  "yahoo.com",
  "duckduckgo.com",
  "yandex.com",
  "baidu.com",
  "ecosia.org",
  "brave.com",
  "ask.com",
];

export const SOCIAL_HOSTS: readonly string[] = [
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "snapchat.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "pinterest.com",
  "reddit.com",
  "youtube.com",
  "whatsapp.com",
  "t.co",
];

export const MARKETPLACE_HOSTS: readonly string[] = [
  "amazon.com",
  "ebay.com",
  "etsy.com",
  "noon.com",
  "jumia.com",
  "aliexpress.com",
  "walmart.com",
];

/** Paid-intent mediums, per the GA convention. */
const PAID_MEDIUMS: readonly string[] = ["cpc", "ppc", "paidsearch", "paid", "cpm", "cpv", "cpa"];
const DISPLAY_MEDIUMS: readonly string[] = ["display", "banner", "cpm", "retargeting"];
const SOCIAL_MEDIUMS: readonly string[] = ["social", "social-network", "social-media", "sm"];

function hostOf(url: string | undefined): string | undefined {
  if (url === undefined || url.trim() === "") return undefined;

  // Parsed without `URL` so the resolver stays free of runtime globals (browser/edge/server safe).
  const withoutScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const host = withoutScheme
    .split(/[/?#]/)[0]
    ?.toLowerCase()
    .replace(/^www\./, "");
  return host === undefined || host === "" ? undefined : host;
}

function matchesHost(host: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

export interface ChannelSignals {
  readonly utmSource?: string;
  readonly utmMedium?: string;
  readonly utmCampaign?: string;
  readonly referrer?: string;
  readonly clickIds?: readonly ClickIdName[];
  /** Our own hosts — a referral from one of them is internal, not an acquisition. */
  readonly selfHosts?: readonly string[];
}

export interface ChannelResolution {
  readonly channelGroup: ChannelGroup;
  /** Which signal decided it, surfaced in diagnostics so a merchant can audit the classification. */
  readonly basis:
    | "click_id"
    | "utm_medium"
    | "utm_source"
    | "referrer"
    | "no_referrer"
    | "internal"
    | "insufficient_signal";
  readonly source?: string;
  readonly medium?: string;
}

/**
 * Resolves the channel for a landing. Returns `unknown` with an explicit basis rather than
 * defaulting to `direct` when signals conflict — mislabelling paid traffic as direct is the single
 * most common way attribution silently overstates organic performance.
 */
export function resolveChannel(signals: ChannelSignals): ChannelResolution {
  const medium = signals.utmMedium?.trim().toLowerCase();
  const source = signals.utmSource?.trim().toLowerCase();
  const referrerHost = hostOf(signals.referrer);

  // 1. A click identifier is proof of a paid click — it outranks any declared medium.
  const clickId = signals.clickIds?.[0];
  if (clickId !== undefined) {
    return {
      channelGroup: PLATFORM_PAID_CHANNEL[CLICK_ID_DEFINITIONS[clickId].platform],
      basis: "click_id",
      source: source ?? CLICK_ID_DEFINITIONS[clickId].platform,
      medium: medium ?? "cpc",
    };
  }

  // 2. Internal traffic never counts as an acquisition channel.
  if (referrerHost !== undefined && signals.selfHosts !== undefined) {
    if (matchesHost(referrerHost, signals.selfHosts)) {
      return { channelGroup: "internal", basis: "internal", source: referrerHost };
    }
  }

  // 3. An explicit medium is a declared intent.
  if (medium !== undefined && medium !== "") {
    const declared = channelForMedium(medium, source);
    if (declared !== undefined) {
      return { channelGroup: declared, basis: "utm_medium", source, medium };
    }
  }

  // 4. A recognised source without a usable medium.
  if (source !== undefined && source !== "") {
    if (matchesHost(source, SOCIAL_HOSTS)) {
      return { channelGroup: "organic_social", basis: "utm_source", source, medium };
    }
    if (matchesHost(source, MARKETPLACE_HOSTS)) {
      return { channelGroup: "marketplace", basis: "utm_source", source, medium };
    }
  }

  // 5. Referrer inference.
  if (referrerHost !== undefined) {
    if (matchesHost(referrerHost, SEARCH_ENGINE_HOSTS)) {
      return { channelGroup: "organic_search", basis: "referrer", source: referrerHost };
    }
    if (matchesHost(referrerHost, SOCIAL_HOSTS)) {
      return { channelGroup: "organic_social", basis: "referrer", source: referrerHost };
    }
    if (matchesHost(referrerHost, MARKETPLACE_HOSTS)) {
      return { channelGroup: "marketplace", basis: "referrer", source: referrerHost };
    }
    return { channelGroup: "referral", basis: "referrer", source: referrerHost };
  }

  // 6. No referrer and no campaign surface at all: a genuine direct arrival.
  if (source === undefined && medium === undefined) {
    return { channelGroup: "direct", basis: "no_referrer" };
  }

  // 7. A campaign surface we could not classify. Explicitly unknown, never assumed direct.
  return { channelGroup: "unknown", basis: "insufficient_signal", source, medium };
}

function channelForMedium(medium: string, source: string | undefined): ChannelGroup | undefined {
  if (PAID_MEDIUMS.includes(medium)) {
    // A paid medium on a social source is paid social, not paid search.
    return source !== undefined && matchesHost(source, SOCIAL_HOSTS)
      ? "paid_social"
      : "paid_search";
  }
  if (DISPLAY_MEDIUMS.includes(medium)) return "display";
  if (SOCIAL_MEDIUMS.includes(medium)) return "organic_social";
  if (medium === "email" || medium === "newsletter") return "email";
  if (medium === "sms" || medium === "text") return "sms";
  if (medium === "push" || medium === "web_push" || medium === "notification") return "push";
  if (medium === "affiliate" || medium === "partner") return "affiliate";
  if (medium === "influencer" || medium === "creator") return "influencer";
  if (medium === "marketplace") return "marketplace";
  if (medium === "offline" || medium === "print" || medium === "qr" || medium === "instore") {
    return "offline";
  }
  if (medium === "referral") return "referral";
  if (medium === "organic") return "organic_search";
  if (medium === "internal") return "internal";
  return undefined;
}
