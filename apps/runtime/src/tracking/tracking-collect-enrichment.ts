/**
 * Runtime wiring of the collect-time enrichment (Tracking P1-D8) and the store's IP block list (P1-D9) behind
 * `POST /public/tracking/collect` and the `/tracking/blocked-ips` admin routes.
 *
 * - **Geo** is optional and offline: `TRACKING_GEO_DB_PATH` names a MaxMind-format `.mmdb` (GeoLite2 / DB-IP Lite)
 *   the operator put on disk. Unset ⇒ geo is off; a missing, unreadable or corrupt file ⇒ geo is off and one warning
 *   names the reason. Nothing is ever downloaded at runtime and no licence key lives in the repository.
 * - **Burst flags** ride the platform's existing rate limiter (Redis), keyed per store and per visitor id /
 *   fingerprint — never per IP, because one Egyptian carrier address carries thousands of real shoppers.
 * - **The cookieless id** is keyed with `TRACKING_EDGE_SECRET` (per store); without the secret the route is off anyway.
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Clock, IdGenerator, RateLimiter } from "@platform/contracts";
import {
  BlockedIpService,
  TrackingSettingsService,
  UNKNOWN_GEO,
  createCollectEnricher,
  createMmdbGeoLookup,
  type BurstPort,
  type CollectEnricher,
  type GeoLookupPort,
} from "@platform/tracking";
import { logger } from "@platform/utils";
import type { Database } from "@platform/db";
import type { RuntimeCore } from "../composition";
import { PrismaBlockedIpStore } from "./prisma-blocked-ip-store";
import { PrismaTrackingStoreSettingsStore } from "./prisma-tracking-store-settings";

/** More events than a person can produce from one browser in a minute. */
export const VISITOR_BURST_LIMIT = 90;
/** One fingerprint is shared by everyone on a cell with one phone model: the bar is far higher, and it is capped weak. */
export const FINGERPRINT_BURST_LIMIT = 900;
export const BURST_WINDOW_MS = 60_000;

const hmacSha256Hex = (key: string, data: string): string =>
  createHmac("sha256", key).update(data).digest("hex");

export interface GeoLoadIo {
  readonly readFile: (path: string) => Uint8Array;
  readonly warn: (message: string, fields: Record<string, unknown>) => void;
}

const defaultIo: GeoLoadIo = {
  readFile: (path) => readFileSync(path),
  warn: (message, fields) => logger.warn(message, fields),
};

/** The geo lookup for a configured file, or "unknown for every address" — never an exception. */
export function loadGeoLookup(path: string | undefined, io: GeoLoadIo = defaultIo): GeoLookupPort {
  if (path === undefined || path.trim() === "") return UNKNOWN_GEO;
  try {
    return createMmdbGeoLookup(io.readFile(path));
  } catch (cause) {
    // The error NAME only (a path is configuration, but a message could carry anything).
    io.warn("tracking geo: database not usable, country detection is off", {
      error: cause instanceof Error ? cause.name : "unknown",
    });
    return UNKNOWN_GEO;
  }
}

/** Burst flags over the shared rate limiter. A limiter failure throws and the enricher skips the flag. */
export function createBurstPort(limiter: RateLimiter): BurstPort {
  return {
    check: async ({ tenantId, visitorId, fingerprintId }) => {
      const [visitor, fingerprint] = await Promise.all([
        visitorId === undefined
          ? undefined
          : limiter.consume(
              `tracking-burst:visitor:${tenantId}:${visitorId}`,
              VISITOR_BURST_LIMIT,
              BURST_WINDOW_MS,
            ),
        fingerprintId === undefined
          ? undefined
          : limiter.consume(
              `tracking-burst:fingerprint:${tenantId}:${fingerprintId}`,
              FINGERPRINT_BURST_LIMIT,
              BURST_WINDOW_MS,
            ),
      ]);
      return {
        visitorBurst: visitor !== undefined && !visitor.allowed,
        fingerprintBurst: fingerprint !== undefined && !fingerprint.allowed,
      };
    },
  };
}

export interface TrackingCollectDeps {
  readonly secret: string | undefined;
  readonly geoDbPath: string | undefined;
  readonly rateLimiter: RateLimiter;
  readonly prisma: Database;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly io?: GeoLoadIo;
}

export interface TrackingCollectWiring {
  /** Absent without `TRACKING_EDGE_SECRET` (the collect route is off then). */
  readonly enricher: CollectEnricher | undefined;
  /** One service: the admin routes edit it, the collect route reads it, so an edit takes effect at once. */
  readonly blockedIps: BlockedIpService;
  /** P2-D1: per-store consent policy and cookie notice, as the admin routes and the public notice switch read them. */
  readonly settings: TrackingSettingsService;
}

export function wireTrackingCollect(deps: TrackingCollectDeps): TrackingCollectWiring {
  const blockedIps = new BlockedIpService({
    store: new PrismaBlockedIpStore(deps.prisma),
    clock: deps.clock,
    idGenerator: deps.idGenerator,
    onError: (cause) =>
      logger.warn("tracking: excluded IP list unreadable, nothing is blocked", {
        error: cause instanceof Error ? cause.name : "unknown",
      }),
  });
  const settings = new TrackingSettingsService({
    store: new PrismaTrackingStoreSettingsStore(deps.prisma),
    clock: deps.clock,
    onError: (cause) =>
      logger.warn("tracking: store settings unreadable, defaults apply", {
        error: cause instanceof Error ? cause.name : "unknown",
      }),
  });
  const enricher =
    deps.secret === undefined
      ? undefined
      : createCollectEnricher({
          secret: deps.secret,
          hmacSha256Hex,
          geo: loadGeoLookup(deps.geoDbPath, deps.io),
          burst: createBurstPort(deps.rateLimiter),
          onError: (stage, cause) =>
            logger.warn(`tracking: ${stage} enrichment skipped`, {
              error: cause instanceof Error ? cause.name : "unknown",
            }),
        });
  return { enricher, blockedIps, settings };
}

/** Convenience for `api.ts`. */
export function buildTrackingCollectWiring(
  core: Pick<RuntimeCore, "config" | "prisma" | "idGenerator" | "clock" | "rateLimiter">,
): TrackingCollectWiring {
  return wireTrackingCollect({
    secret: core.config.TRACKING_EDGE_SECRET,
    geoDbPath: core.config.TRACKING_GEO_DB_PATH,
    rateLimiter: core.rateLimiter,
    prisma: core.prisma,
    idGenerator: core.idGenerator,
    clock: core.clock,
  });
}
