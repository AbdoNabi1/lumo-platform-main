import type { createAdminHttpApi } from "@platform/admin";
import { restorableCookies, type TrackingProfileStore } from "@platform/tracking";
import type { Clock } from "@platform/contracts";
import type { RuntimeCore } from "../composition";
import { PrismaTrackingProfileStore } from "./prisma-tracking-profile-store";

/** The seam `POST /public/tracking/collect` calls (declared by the admin HTTP app, not re-exported by it). */
export type TrackingCookieKeeper = NonNullable<
  Parameters<typeof createAdminHttpApi>[0]["trackingCookieKeeper"]
>;

/**
 * Cookie Keeper (Tracking P1-D6) over the real profile store: looks the visitor up by the SIGNED tenant and the
 * master-cookie id (`findByVisitorId` follows one merge tombstone), then asks the pure `restorableCookies` which
 * vendor cookies the browser lacks. One read, tenant-scoped (RLS + `where`); a visitor with no profile yet — a brand
 * new one — simply restores nothing.
 */
export function createTrackingCookieKeeper(
  profiles: Pick<TrackingProfileStore, "findByVisitorId">,
  clock: Clock,
): TrackingCookieKeeper {
  return async ({ tenantId, visitorId, present }) => {
    const profile = await profiles.findByVisitorId(tenantId, visitorId);
    if (profile === null) return [];
    return restorableCookies({ tenantId, profile, present, now: clock.now() });
  };
}

/**
 * `null` while tracking ingest is off: no profile is ever written then (and the table may not be migrated yet), so
 * the capture route must not read it.
 */
export function buildTrackingCookieKeeper(
  core: Pick<RuntimeCore, "config" | "prisma" | "idGenerator" | "clock">,
): TrackingCookieKeeper | null {
  if (!core.config.TRACKING_INGEST_ENABLED) return null;
  return createTrackingCookieKeeper(
    new PrismaTrackingProfileStore(core.prisma, core.idGenerator),
    core.clock,
  );
}
