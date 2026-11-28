/**
 * Collect-time enrichment (Tracking P1-D8): what only the request itself can tell us, stamped onto the event
 * before it is queued, so every later stage (profile, router, vendor builders, inspector) reads one completed
 * document.
 *
 * - **User agent** → browser, OS, device type/brand/model (an addition: the raw UA stays verbatim for the vendors).
 * - **Bot score** → `technical.botScore` + `botReasons`; the router skips marketing destinations at ≥ 50, never for
 *   a real order or lead. Reads the user agent, request headers and a per-VISITOR burst flag — never the address.
 * - **Geo** → country (+ region/city when the database has them) from the trusted client IP; absent without a database.
 * - **AI source** → `attribution.aiSource` from the referrer / `utm_source` table (the channel itself is resolved
 *   by the attribution stage).
 * - **Cookieless id** → `technical.fingerprintId`, keyed per store; identity's last resort, never an override.
 *
 * Every step is best-effort and independent: a failing burst counter or a missing geo database costs that one
 * field, never the event. The function returns the event it was given, completed — it never refuses one.
 */

import type { TrackingEnvelope } from "../envelope/envelope";
import type { TechnicalContext } from "../envelope/technical-context";
import { scoreBot } from "./bot-score";
import { computeFingerprintId, type HmacSha256Hex } from "./fingerprint";
import type { GeoLookupPort } from "./geo-mmdb";
import { resolveAiSource } from "./ai-referrer";
import { parseUserAgent } from "./user-agent";

/** What the storefront forwarded about the visitor's request (the IP is already the trusted one, P1-D7). */
export interface CollectSignals {
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** `undefined` = the storefront did not say (older build); `null` = it looked and the header was absent. */
  readonly acceptLanguage?: string | null | undefined;
  readonly secChUa?: string | null | undefined;
  /** The store host the visitor browsed (`shop.example.com`). */
  readonly host?: string | null | undefined;
}

export interface BurstVerdict {
  readonly visitorBurst: boolean;
  readonly fingerprintBurst: boolean;
}

/** Counts this event against the visitor and the fingerprint and says whether either is far above human pace. */
export interface BurstPort {
  check(input: {
    readonly tenantId: string;
    readonly visitorId?: string;
    readonly fingerprintId?: string;
  }): Promise<BurstVerdict>;
}

export interface CollectEnricherDeps {
  /** `TRACKING_EDGE_SECRET`; the per-store fingerprint key is derived from it. Absent ⇒ no cookieless id. */
  readonly secret: string | undefined;
  readonly hmacSha256Hex: HmacSha256Hex;
  readonly geo: GeoLookupPort;
  readonly burst?: BurstPort;
  /** Reports a swallowed failure (error name only — no event data). */
  readonly onError?: (stage: "burst" | "geo", error: unknown) => void;
}

export type CollectEnricher = (input: {
  readonly tenantId: string;
  readonly envelope: TrackingEnvelope;
  readonly signals: CollectSignals;
}) => Promise<TrackingEnvelope>;

function compact<T extends object>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result as T;
}

/** `ar-EG,ar;q=0.9,en;q=0.8` → `ar-EG`. */
function primaryLanguage(header: string | null | undefined): string | undefined {
  const first = (header ?? "").split(",")[0]?.split(";")[0]?.trim();
  return first === undefined || first === "" || first.length > 35 ? undefined : first;
}

export function createCollectEnricher(deps: CollectEnricherDeps): CollectEnricher {
  return async ({ tenantId, envelope, signals }) => {
    const userAgent = (signals.userAgent ?? "").trim() === "" ? null : signals.userAgent;
    const ua = parseUserAgent(userAgent);
    const technical = envelope.context.technical ?? {};

    const fingerprintId =
      deps.secret === undefined || deps.secret === ""
        ? null
        : computeFingerprintId(deps.hmacSha256Hex, {
            secret: deps.secret,
            tenantId,
            ip: signals.ip,
            userAgent,
            host: signals.host,
          });

    const visitorId = envelope.context.session?.visitorId;
    let visitorBurst = false;
    let fingerprintBurst = false;
    if (deps.burst !== undefined) {
      try {
        const verdict = await deps.burst.check({
          tenantId,
          ...(visitorId === undefined || visitorId === "" ? {} : { visitorId }),
          ...(fingerprintId === null ? {} : { fingerprintId }),
        });
        visitorBurst = verdict.visitorBurst;
        fingerprintBurst = verdict.fingerprintBurst;
      } catch (error) {
        deps.onError?.("burst", error);
      }
    }

    const bot = scoreBot({
      userAgent,
      ua,
      ...(signals.acceptLanguage === undefined ? {} : { acceptLanguage: signals.acceptLanguage }),
      ...(signals.secChUa === undefined ? {} : { secChUa: signals.secChUa }),
      visitorBurst,
      fingerprintBurst,
    });

    let geo: ReturnType<GeoLookupPort["lookup"]> = null;
    if (signals.ip !== null) {
      try {
        geo = deps.geo.lookup(signals.ip);
      } catch (error) {
        deps.onError?.("geo", error);
      }
    }

    const stamped: TechnicalContext = compact({
      ...technical,
      browserName: ua.browserName ?? technical.browserName,
      browserVersion: ua.browserVersion ?? technical.browserVersion,
      osName: ua.osName ?? technical.osName,
      osVersion: ua.osVersion ?? technical.osVersion,
      // The UA parse is the better signal when it knows; "unknown" never replaces a classification already made.
      deviceType: ua.deviceType !== "unknown" ? ua.deviceType : technical.deviceType,
      deviceBrand: ua.deviceBrand ?? technical.deviceBrand,
      deviceModel: ua.deviceModel ?? technical.deviceModel,
      browserLanguage: technical.browserLanguage ?? primaryLanguage(signals.acceptLanguage),
      // Server-observed geo replaces anything the browser claimed; no database ⇒ whatever the event had.
      countryDetected: geo?.country ?? technical.countryDetected,
      regionDetected: geo?.region ?? technical.regionDetected,
      cityDetected: geo?.city ?? technical.cityDetected,
      botScore: bot.score,
      botReasons: bot.reasons.length === 0 ? undefined : bot.reasons,
      fingerprintId: fingerprintId ?? technical.fingerprintId,
    });

    const attribution = envelope.context.attribution;
    const ai = resolveAiSource({
      utmSource: attribution?.utmSource ?? envelope.context.marketing?.utmSource,
      referrer: envelope.context.page?.referrer ?? attribution?.referrer,
    });

    return {
      ...envelope,
      context: {
        ...envelope.context,
        technical: stamped,
        ...(ai === undefined ? {} : { attribution: { ...attribution, aiSource: ai.key } }),
      },
    };
  };
}
