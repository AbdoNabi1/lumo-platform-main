/**
 * Postgres adapter for the TrackingProfile store (Tracking P1-D4): `tracking.tracking_profiles`.
 *
 * ## Tenancy
 *
 * The table is RLS-forced. Every statement here runs in ONE short transaction that sets `app.tenant_id` first
 * (`runInTenantTransaction`) and names the tenant in its `where` as well — the application filter and the policy
 * agree, so the code keeps working unchanged on the day the connection role stops bypassing RLS. The single
 * cross-tenant read (which tenants have expired profiles) is a raw query run under `app.retention_scan = 'on'`,
 * the explicit switch the migration's read-only policy is tied to; every delete after it is tenant-scoped.
 *
 * ## Optimistic writes
 *
 * `persist` is conditional on the `version` the caller read (`updateMany … WHERE version = $read`), and creates
 * with `skipDuplicates`; a lost race returns `false` and rolls the whole transaction back (a sentinel throw), so a
 * change that also folds profiles together is all-or-nothing — never half a merge.
 *
 * ## Tombstones
 *
 * An absorbed or aliased cookie id keeps a row with `merged_into` set and EVERY data column emptied. Reading a
 * cookie id follows exactly one hop to the surviving row.
 *
 * Rows hold hashes and ids only; nothing here logs a row.
 */

import type { IdGenerator } from "@platform/contracts";
import { runInTenantTransaction, type Database, type Prisma } from "@platform/db";
import type {
  ExpiredProfileScan,
  ProfileChange,
  ProfileClickIds,
  ProfileLandingTouch,
  TrackingProfile,
  TrackingProfileStore,
} from "@platform/tracking";

/** Tenants looked at per retention scan; the rest are served by the next pass. */
const TENANT_SCAN_LIMIT = 200;

/** Thrown inside a transaction to roll it back when a conditional write lost its race. */
class WriteConflict extends Error {
  constructor() {
    super("tracking profile write conflict");
    this.name = "WriteConflict";
  }
}

interface ProfileRow {
  readonly tenantId: string;
  readonly visitorId: string;
  readonly mergedInto: string | null;
  readonly customerId: string | null;
  readonly emailStd: string | null;
  readonly emailGads: string | null;
  readonly emailGa4: string | null;
  readonly phoneDigits: string | null;
  readonly phoneE164: string | null;
  readonly fn: string | null;
  readonly ln: string | null;
  readonly ct: string | null;
  readonly st: string | null;
  readonly country: string | null;
  readonly externalId: string | null;
  readonly clickIds: unknown;
  readonly fbp: string | null;
  readonly fbc: string | null;
  readonly fbcCapturedAt: Date | null;
  readonly ttp: string | null;
  readonly scid: string | null;
  readonly gaClientId: string | null;
  readonly gaSessionId: string | null;
  readonly lastIp: string | null;
  readonly lastUserAgent: string | null;
  readonly lastPageUrl: string | null;
  readonly lastSeenAt: Date;
  readonly geoCountry: string | null;
  readonly geoRegion: string | null;
  readonly geoCity: string | null;
  readonly botScore: number | null;
  readonly fingerprintId: string | null;
  readonly landingTouch: unknown;
  readonly leadIds: string[];
  readonly orderIds: string[];
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
}

function isClickIdMap(value: unknown): value is ProfileClickIds {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLanding(value: unknown): value is ProfileLandingTouch {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { at?: unknown }).at === "string"
  );
}

/** A stored row as the domain profile. */
export function toProfile(row: ProfileRow): TrackingProfile {
  const opt = <K extends string, T>(key: K, value: T | null): { [P in K]?: T } =>
    value === null ? {} : ({ [key]: value } as { [P in K]?: T });

  const geo = {
    ...opt("country", row.geoCountry),
    ...opt("region", row.geoRegion),
    ...opt("city", row.geoCity),
  };
  return {
    tenantId: row.tenantId,
    visitorId: row.visitorId,
    ...opt("customerId", row.customerId),
    hashes: {
      ...opt("emailStd", row.emailStd),
      ...opt("emailGads", row.emailGads),
      ...opt("emailGa4", row.emailGa4),
      ...opt("phoneDigits", row.phoneDigits),
      ...opt("phoneE164", row.phoneE164),
      ...opt("fn", row.fn),
      ...opt("ln", row.ln),
      ...opt("ct", row.ct),
      ...opt("st", row.st),
      ...opt("country", row.country),
      ...opt("externalId", row.externalId),
    },
    clickIds: isClickIdMap(row.clickIds) ? row.clickIds : {},
    browser: {
      ...opt("fbp", row.fbp),
      ...opt("fbc", row.fbc),
      ...(row.fbcCapturedAt === null ? {} : { fbcCapturedAt: row.fbcCapturedAt.toISOString() }),
      ...opt("ttp", row.ttp),
      ...opt("scid", row.scid),
      ...opt("gaClientId", row.gaClientId),
      ...opt("gaSessionId", row.gaSessionId),
    },
    ...opt("lastIp", row.lastIp),
    ...opt("lastUserAgent", row.lastUserAgent),
    ...opt("lastPageUrl", row.lastPageUrl),
    lastSeenAt: row.lastSeenAt.toISOString(),
    ...(Object.keys(geo).length === 0 ? {} : { geo }),
    ...(isLanding(row.landingTouch) ? { landing: row.landingTouch } : {}),
    ...(row.botScore === null ? {} : { botScore: row.botScore }),
    ...opt("fingerprintId", row.fingerprintId),
    leadIds: row.leadIds,
    orderIds: row.orderIds,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** The column values of a LIVE profile (every nullable column explicit, so an update clears what is gone). */
function liveData(profile: TrackingProfile): Prisma.TrackingProfileUncheckedCreateInput {
  const h = profile.hashes;
  const b = profile.browser;
  return {
    id: "", // replaced by the caller on create
    tenantId: profile.tenantId,
    visitorId: profile.visitorId,
    mergedInto: null,
    customerId: profile.customerId ?? null,
    emailStd: h.emailStd ?? null,
    emailGads: h.emailGads ?? null,
    emailGa4: h.emailGa4 ?? null,
    phoneDigits: h.phoneDigits ?? null,
    phoneE164: h.phoneE164 ?? null,
    fn: h.fn ?? null,
    ln: h.ln ?? null,
    ct: h.ct ?? null,
    st: h.st ?? null,
    country: h.country ?? null,
    externalId: h.externalId ?? null,
    clickIds: profile.clickIds as unknown as Prisma.InputJsonValue,
    fbp: b.fbp ?? null,
    fbc: b.fbc ?? null,
    fbcCapturedAt: b.fbcCapturedAt === undefined ? null : new Date(b.fbcCapturedAt),
    ttp: b.ttp ?? null,
    scid: b.scid ?? null,
    gaClientId: b.gaClientId ?? null,
    gaSessionId: b.gaSessionId ?? null,
    lastIp: profile.lastIp ?? null,
    lastUserAgent: profile.lastUserAgent ?? null,
    lastPageUrl: profile.lastPageUrl ?? null,
    lastSeenAt: new Date(profile.lastSeenAt),
    geoCountry: profile.geo?.country ?? null,
    geoRegion: profile.geo?.region ?? null,
    geoCity: profile.geo?.city ?? null,
    botScore: profile.botScore ?? null,
    fingerprintId: profile.fingerprintId ?? null,
    // `{}` is "no landing touch": the column stays writable without Prisma's JSON-null sentinel.
    landingTouch: (profile.landing ?? {}) as unknown as Prisma.InputJsonValue,
    leadIds: [...profile.leadIds],
    orderIds: [...profile.orderIds],
    createdAt: new Date(profile.createdAt),
    updatedAt: new Date(profile.updatedAt),
    expiresAt: new Date(profile.expiresAt),
  };
}

/** What a tombstone row holds: where it points, when it lapses, and nothing else. */
function tombstoneData(
  survivor: TrackingProfile,
  visitorId: string,
): Prisma.TrackingProfileUncheckedCreateInput {
  return {
    ...liveData({
      tenantId: survivor.tenantId,
      visitorId,
      hashes: {},
      clickIds: {},
      browser: {},
      lastSeenAt: survivor.lastSeenAt,
      leadIds: [],
      orderIds: [],
      version: 0,
      createdAt: survivor.createdAt,
      updatedAt: survivor.updatedAt,
      expiresAt: survivor.expiresAt,
    }),
    mergedInto: survivor.visitorId,
  };
}

export class PrismaTrackingProfileStore implements TrackingProfileStore, ExpiredProfileScan {
  constructor(
    private readonly db: Database,
    private readonly idGenerator: IdGenerator,
  ) {}

  findByCustomerId(tenantId: string, customerId: string): Promise<TrackingProfile | null> {
    return this.findLive(tenantId, { customerId });
  }

  findByEmailHash(tenantId: string, emailStd: string): Promise<TrackingProfile | null> {
    return this.findLive(tenantId, { emailStd });
  }

  findByPhoneHash(tenantId: string, phoneE164: string): Promise<TrackingProfile | null> {
    return this.findLive(tenantId, { phoneE164 });
  }

  /** The newest live (non-tombstone) profile matching, ties broken by cookie id so the choice is stable. */
  private findLive(
    tenantId: string,
    match: Prisma.TrackingProfileWhereInput,
  ): Promise<TrackingProfile | null> {
    return runInTenantTransaction(this.db, tenantId, async (tx) => {
      const row = await tx.trackingProfile.findFirst({
        where: { tenantId, mergedInto: null, ...match },
        orderBy: [{ lastSeenAt: "desc" }, { visitorId: "asc" }],
      });
      return row === null ? null : toProfile(row);
    });
  }

  findByVisitorId(tenantId: string, visitorId: string): Promise<TrackingProfile | null> {
    return runInTenantTransaction(this.db, tenantId, async (tx) => {
      const row = await tx.trackingProfile.findFirst({ where: { tenantId, visitorId } });
      if (row === null) return null;
      if (row.mergedInto === null) return toProfile(row);
      const survivor = await tx.trackingProfile.findFirst({
        where: { tenantId, visitorId: row.mergedInto, mergedInto: null },
      });
      return survivor === null ? null : toProfile(survivor);
    });
  }

  async persist(change: ProfileChange): Promise<boolean> {
    const { profile } = change;
    try {
      await runInTenantTransaction(this.db, profile.tenantId, async (tx) => {
        if (profile.version === 0) {
          // A leftover tombstone of this cookie id whose survivor is gone would block the create.
          await tx.trackingProfile.deleteMany({
            where: {
              tenantId: profile.tenantId,
              visitorId: profile.visitorId,
              mergedInto: { not: null },
            },
          });
          const created = await tx.trackingProfile.createMany({
            skipDuplicates: true,
            data: [{ ...liveData(profile), id: this.idGenerator.generate(), version: 1 }],
          });
          if (created.count === 0) throw new WriteConflict();
        } else {
          const { id: _id, tenantId: _tenant, visitorId: _visitor, ...data } = liveData(profile);
          const updated = await tx.trackingProfile.updateMany({
            where: {
              tenantId: profile.tenantId,
              visitorId: profile.visitorId,
              mergedInto: null,
              version: profile.version,
            },
            data: { ...data, version: profile.version + 1 },
          });
          if (updated.count === 0) throw new WriteConflict();
        }

        for (const absorbed of change.absorbed) {
          const {
            id: _id,
            tenantId: _tenant,
            visitorId: _visitor,
            ...data
          } = tombstoneData(profile, absorbed.visitorId);
          const folded = await tx.trackingProfile.updateMany({
            where: {
              tenantId: profile.tenantId,
              visitorId: absorbed.visitorId,
              mergedInto: null,
              version: absorbed.version,
            },
            data: { ...data, version: absorbed.version + 1 },
          });
          if (folded.count === 0) throw new WriteConflict();
        }

        const absorbedIds = new Set(change.absorbed.map((absorbed) => absorbed.visitorId));
        for (const alias of change.aliases) {
          if (alias === profile.visitorId || absorbedIds.has(alias)) continue;
          const {
            id: _id,
            tenantId: _tenant,
            visitorId: _visitor,
            ...data
          } = tombstoneData(profile, alias);
          // Refresh an existing tombstone (it keeps resolving), else create one.
          const refreshed = await tx.trackingProfile.updateMany({
            where: { tenantId: profile.tenantId, visitorId: alias, mergedInto: { not: null } },
            data,
          });
          if (refreshed.count > 0) continue;
          const created = await tx.trackingProfile.createMany({
            skipDuplicates: true,
            data: [
              { ...tombstoneData(profile, alias), id: this.idGenerator.generate(), version: 1 },
            ],
          });
          // The cookie id is a LIVE profile of its own that this change did not fold in: another writer's.
          if (created.count === 0) throw new WriteConflict();
        }
      });
      return true;
    } catch (error) {
      if (error instanceof WriteConflict) return false;
      throw error;
    }
  }

  eraseCustomer(tenantId: string, customerId: string): Promise<number> {
    return runInTenantTransaction(this.db, tenantId, async (tx) => {
      const survivors = await tx.trackingProfile.findMany({
        where: { tenantId, customerId, mergedInto: null },
        select: { visitorId: true },
      });
      const visitorIds = survivors.map((row) => row.visitorId);
      if (visitorIds.length === 0) return 0;
      const deleted = await tx.trackingProfile.deleteMany({
        where: {
          tenantId,
          OR: [{ visitorId: { in: visitorIds } }, { mergedInto: { in: visitorIds } }],
        },
      });
      return deleted.count;
    });
  }

  deleteExpiredAnonymous(tenantId: string, now: Date): Promise<number> {
    return runInTenantTransaction(this.db, tenantId, async (tx) => {
      // Anonymous = no customer on the row AND, for a tombstone, none on the profile it points at: a
      // customer's profile and the cookie ids that resolve to it are erased with the customer
      // (`eraseCustomer`), never by the clock. The tenant scan below applies the same rule.
      return tx.$executeRaw`
        DELETE FROM "tracking"."tracking_profiles" AS p
        WHERE p.tenant_id = ${tenantId}
          AND p.customer_id IS NULL
          AND p.expires_at < ${now.toISOString()}::timestamp
          AND NOT EXISTS (
            SELECT 1 FROM "tracking"."tracking_profiles" AS s
            WHERE s.tenant_id = p.tenant_id
              AND s.visitor_id = p.merged_into
              AND s.merged_into IS NULL
              AND s.customer_id IS NOT NULL
          )`;
    });
  }

  /** Cross-tenant, read-only, behind the explicit `app.retention_scan` switch (see the migration). */
  async tenantsWithExpiredProfiles(now: Date): Promise<readonly string[]> {
    const rows = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.retention_scan', 'on', true)`;
      return tx.$queryRaw<{ tenant_id: string }[]>`
        SELECT DISTINCT tenant_id
        FROM "tracking"."tracking_profiles" AS p
        WHERE p.customer_id IS NULL
          AND p.expires_at < ${now.toISOString()}::timestamp
          AND NOT EXISTS (
            SELECT 1 FROM "tracking"."tracking_profiles" AS s
            WHERE s.tenant_id = p.tenant_id
              AND s.visitor_id = p.merged_into
              AND s.merged_into IS NULL
              AND s.customer_id IS NOT NULL
          )
        ORDER BY p.tenant_id
        LIMIT ${TENANT_SCAN_LIMIT}`;
    });
    return rows.map((row) => row.tenant_id);
  }
}
