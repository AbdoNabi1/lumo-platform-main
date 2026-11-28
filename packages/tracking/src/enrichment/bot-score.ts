/**
 * Bot score, 0–100 (Tracking P1-D8, gap A9).
 *
 * A score ≥ {@link BOT_SKIP_THRESHOLD} means "do not send this event to ad platforms" — it never means "drop it": the
 * event is still recorded (the inspector shows the visible reason `bot`), and a real order or lead is exempt from
 * the skip altogether (`isBusinessConversion` in the router). A wrong "bot" verdict costs one skipped page view; a
 * wrong "human" verdict costs one inflated count — so the model errs toward sending.
 *
 * ## What it reads, and — deliberately — what it does not
 *
 * Only facts about the REQUEST's client: the user agent (declared crawler, HTTP library, headless/automation
 * marker, monitoring tool, missing or implausibly short), the headers a real browser always sends
 * (`Accept-Language`, Client Hints on a Chromium UA) and a per-VISITOR burst flag. The IP address is not an input
 * at all. Egyptian mobile carriers put thousands of subscribers behind one carrier-grade NAT address; an IP-based
 * rate or reputation signal would mark a whole district of real shoppers as bots. The fingerprint (IP /24 + UA +
 * host) is one step better but is still shared by everyone on one cell with one phone model, so a burst on it
 * adds only a small, never-sufficient amount.
 *
 * Signals the caller could not observe are `undefined`, not `false`: an older storefront that does not forward
 * `Accept-Language` must not read as "every visitor lacks Accept-Language".
 */

import type { UserAgentInfo } from "./user-agent";

/** At or above this a marketing destination is skipped for a non-conversion event. */
export const BOT_SKIP_THRESHOLD = 50;

export type BotReason =
  | "declared_crawler"
  | "http_client"
  | "headless_browser"
  | "monitoring_tool"
  | "missing_user_agent"
  | "implausible_user_agent"
  | "missing_accept_language"
  | "missing_client_hints"
  | "visitor_burst"
  | "fingerprint_burst";

export type BotBand = "human" | "suspicious" | "bot" | "certain_bot";

/** Points per signal. Pinned by tests; the thresholds below are what make them meaningful. */
export const BOT_REASON_POINTS: Readonly<Record<BotReason, number>> = {
  declared_crawler: 100,
  http_client: 90,
  headless_browser: 90,
  monitoring_tool: 70,
  missing_user_agent: 55,
  implausible_user_agent: 30,
  missing_accept_language: 25,
  missing_client_hints: 10,
  visitor_burst: 60,
  // Never enough alone, whatever else is true of a shared cell address.
  fingerprint_burst: 20,
};

export interface BotSignals {
  /** The raw user agent as the client sent it; `null`/`undefined`/empty ⇒ none. */
  readonly userAgent: string | null | undefined;
  readonly ua: UserAgentInfo;
  /** `undefined` = not observed; `null` = observed absent. */
  readonly acceptLanguage?: string | null;
  /** `Sec-CH-UA`. `undefined` = not observed; `null` = observed absent. */
  readonly secChUa?: string | null;
  /** One visitor id (cookie) produced more events than a person plausibly can in the window. */
  readonly visitorBurst?: boolean;
  /** One fingerprint produced a very large number of events in the window. */
  readonly fingerprintBurst?: boolean;
}

export interface BotScore {
  readonly score: number;
  readonly band: BotBand;
  readonly reasons: readonly BotReason[];
}

export function botBand(score: number): BotBand {
  if (score >= 80) return "certain_bot";
  if (score >= BOT_SKIP_THRESHOLD) return "bot";
  if (score >= 20) return "suspicious";
  return "human";
}

/** A UA that claims a modern Chromium (Chrome/Edge/Opera 90+), where `Sec-CH-UA` is sent on every HTTPS request. */
function claimsClientHintBrowser(ua: UserAgentInfo): boolean {
  if (ua.browserName !== "Chrome" && ua.browserName !== "Edge" && ua.browserName !== "Opera") {
    return false;
  }
  const major = Number.parseInt(ua.browserVersion ?? "", 10);
  return Number.isFinite(major) && major >= 90 && ua.osName !== "iOS";
}

export function scoreBot(signals: BotSignals): BotScore {
  const reasons: BotReason[] = [];
  const raw = (signals.userAgent ?? "").trim();

  if (raw === "") {
    reasons.push("missing_user_agent");
  } else {
    const marker = signals.ua.bot;
    if (marker?.kind === "crawler") reasons.push("declared_crawler");
    else if (marker?.kind === "http_client") reasons.push("http_client");
    else if (marker?.kind === "headless") reasons.push("headless_browser");
    else if (marker?.kind === "monitor") reasons.push("monitoring_tool");
    // `Mozilla/5.0` alone, `Mozilla/4.0`, a bare product token: no mainstream browser is this terse.
    else if (raw.length < 20) reasons.push("implausible_user_agent");
  }

  if (signals.acceptLanguage === null || signals.acceptLanguage?.trim() === "") {
    reasons.push("missing_accept_language");
  }
  if (signals.secChUa === null && claimsClientHintBrowser(signals.ua)) {
    reasons.push("missing_client_hints");
  }
  if (signals.visitorBurst === true) reasons.push("visitor_burst");
  if (signals.fingerprintBurst === true) reasons.push("fingerprint_burst");

  const score = Math.min(
    100,
    reasons.reduce((sum, reason) => sum + BOT_REASON_POINTS[reason], 0),
  );
  return { score, band: botBand(score), reasons };
}
