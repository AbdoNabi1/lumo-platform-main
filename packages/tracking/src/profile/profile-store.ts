/**
 * The TrackingProfile store port (Tracking P1-D4) and its in-memory twin.
 *
 * The twin is not a test shortcut to be thrown away: it is the specification the Prisma adapter is held to —
 * the same contract tests run against both (`profile-store.contract.ts`), and the Postgres-gated integration test
 * runs that very suite against a real database. Every behaviour a caller relies on is therefore written here
 * once: tenants are separate keyspaces, a write is conditional on the version the caller read, an absorbed
 * cookie keeps resolving through a tombstone, and an erase takes the tombstones with it.
 */

import { isAnonymousProfile, type TrackingProfile } from "./tracking-profile";

/** One atomic change: the profile as it should be stored, plus the cookie ids that now resolve to it. */
export interface ProfileChange {
  /** `version` is the version the caller READ (0 = this profile was never stored: create it). */
  readonly profile: TrackingProfile;
  /** Cookie ids that now resolve to `profile` (a new device, or a profile that was folded in). */
  readonly aliases: readonly string[];
  /** Stored profiles folded into `profile`: they become tombstones, each only if still at `version`. */
  readonly absorbed: readonly { readonly visitorId: string; readonly version: number }[];
}

export interface TrackingProfileStore {
  findByCustomerId(tenantId: string, customerId: string): Promise<TrackingProfile | null>;
  /** `emailStd` is the hash of the platform-neutral email form. */
  findByEmailHash(tenantId: string, emailStd: string): Promise<TrackingProfile | null>;
  /** `phoneE164` is the hash of the `+`-prefixed phone number. */
  findByPhoneHash(tenantId: string, phoneE164: string): Promise<TrackingProfile | null>;
  /** The profile a cookie id resolves to, following one tombstone hop; `null` when unknown. */
  findByVisitorId(tenantId: string, visitorId: string): Promise<TrackingProfile | null>;
  /**
   * Stores the change atomically. Returns `false` — and changes NOTHING — when another writer got there first
   * (the stored version is not the one the caller read, or a profile it meant to create already exists); the
   * caller re-reads and re-applies.
   */
  persist(change: ProfileChange): Promise<boolean>;
  /** Deletes every profile of the customer and every cookie id that resolved to one. Returns rows deleted. */
  eraseCustomer(tenantId: string, customerId: string): Promise<number>;
  /** Deletes anonymous profiles (and tombstones) whose `expiresAt` is before `now`. Returns rows deleted. */
  deleteExpiredAnonymous(tenantId: string, now: Date): Promise<number>;
}

/** Which tenants have anything for the retention job to do (see {@link TrackingRetentionStore}). */
export interface ExpiredProfileScan {
  tenantsWithExpiredProfiles(now: Date): Promise<readonly string[]>;
}

interface StoredRow {
  readonly profile: TrackingProfile;
  /** Set on a tombstone: the cookie id of the surviving profile. */
  readonly mergedInto?: string;
}

const keyOf = (tenantId: string, visitorId: string): string => `${tenantId}\u0000${visitorId}`;

function newestFirst(a: TrackingProfile, b: TrackingProfile): number {
  const delta = Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
  return delta !== 0 ? delta : a.visitorId.localeCompare(b.visitorId);
}

export class InMemoryTrackingProfileStore implements TrackingProfileStore, ExpiredProfileScan {
  private readonly rows = new Map<string, StoredRow>();

  /** Test helper: every stored profile of a tenant (tombstones excluded). */
  all(tenantId: string): readonly TrackingProfile[] {
    return [...this.rows.values()]
      .filter((row) => row.mergedInto === undefined && row.profile.tenantId === tenantId)
      .map((row) => row.profile);
  }

  /** Test helper: the tombstones of a tenant as `cookie → survivor`. */
  aliases(tenantId: string): ReadonlyMap<string, string> {
    return new Map(
      [...this.rows.values()]
        .filter((row) => row.mergedInto !== undefined && row.profile.tenantId === tenantId)
        .map((row) => [row.profile.visitorId, row.mergedInto as string]),
    );
  }

  private live(
    tenantId: string,
    match: (profile: TrackingProfile) => boolean,
  ): TrackingProfile | null {
    const found = [...this.rows.values()]
      .filter(
        (row) =>
          row.mergedInto === undefined && row.profile.tenantId === tenantId && match(row.profile),
      )
      .map((row) => row.profile)
      .sort(newestFirst);
    return found[0] ?? null;
  }

  findByCustomerId(tenantId: string, customerId: string): Promise<TrackingProfile | null> {
    return Promise.resolve(this.live(tenantId, (profile) => profile.customerId === customerId));
  }

  findByEmailHash(tenantId: string, emailStd: string): Promise<TrackingProfile | null> {
    return Promise.resolve(this.live(tenantId, (profile) => profile.hashes.emailStd === emailStd));
  }

  findByPhoneHash(tenantId: string, phoneE164: string): Promise<TrackingProfile | null> {
    return Promise.resolve(
      this.live(tenantId, (profile) => profile.hashes.phoneE164 === phoneE164),
    );
  }

  findByVisitorId(tenantId: string, visitorId: string): Promise<TrackingProfile | null> {
    const row = this.rows.get(keyOf(tenantId, visitorId));
    if (row === undefined) return Promise.resolve(null);
    if (row.mergedInto === undefined) return Promise.resolve(row.profile);
    const survivor = this.rows.get(keyOf(tenantId, row.mergedInto));
    return Promise.resolve(
      survivor !== undefined && survivor.mergedInto === undefined ? survivor.profile : null,
    );
  }

  persist(change: ProfileChange): Promise<boolean> {
    const { profile } = change;
    const own = this.rows.get(keyOf(profile.tenantId, profile.visitorId));

    if (profile.version === 0) {
      // Create: a live profile under this cookie id means someone else created it first. A leftover tombstone
      // (its survivor was erased) is simply replaced.
      if (own !== undefined && own.mergedInto === undefined) return Promise.resolve(false);
    } else if (
      own === undefined ||
      own.mergedInto !== undefined ||
      own.profile.version !== profile.version
    ) {
      return Promise.resolve(false);
    }

    for (const target of change.absorbed) {
      const row = this.rows.get(keyOf(profile.tenantId, target.visitorId));
      if (
        row === undefined ||
        row.mergedInto !== undefined ||
        row.profile.version !== target.version
      ) {
        return Promise.resolve(false);
      }
    }

    this.rows.set(keyOf(profile.tenantId, profile.visitorId), {
      profile: { ...profile, version: profile.version + 1 },
    });

    const tombstoned = new Set([...change.aliases, ...change.absorbed.map((a) => a.visitorId)]);
    tombstoned.delete(profile.visitorId);
    for (const visitorId of tombstoned) {
      this.rows.set(keyOf(profile.tenantId, visitorId), {
        mergedInto: profile.visitorId,
        profile: {
          tenantId: profile.tenantId,
          visitorId,
          hashes: {},
          clickIds: {},
          browser: {},
          lastSeenAt: profile.lastSeenAt,
          leadIds: [],
          orderIds: [],
          version: 0,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
          expiresAt: profile.expiresAt,
        },
      });
    }
    return Promise.resolve(true);
  }

  eraseCustomer(tenantId: string, customerId: string): Promise<number> {
    const survivors = new Set(
      [...this.rows.values()]
        .filter(
          (row) =>
            row.mergedInto === undefined &&
            row.profile.tenantId === tenantId &&
            row.profile.customerId === customerId,
        )
        .map((row) => row.profile.visitorId),
    );
    let deleted = 0;
    for (const [key, row] of [...this.rows.entries()]) {
      if (row.profile.tenantId !== tenantId) continue;
      const doomed =
        (row.mergedInto === undefined && survivors.has(row.profile.visitorId)) ||
        (row.mergedInto !== undefined && survivors.has(row.mergedInto));
      if (doomed) {
        this.rows.delete(key);
        deleted += 1;
      }
    }
    return Promise.resolve(deleted);
  }

  deleteExpiredAnonymous(tenantId: string, now: Date): Promise<number> {
    let deleted = 0;
    for (const [key, row] of [...this.rows.entries()]) {
      if (row.profile.tenantId !== tenantId || !isAnonymousProfile(row.profile)) continue;
      if (Date.parse(row.profile.expiresAt) < now.getTime()) {
        this.rows.delete(key);
        deleted += 1;
      }
    }
    return Promise.resolve(deleted);
  }

  tenantsWithExpiredProfiles(now: Date): Promise<readonly string[]> {
    const tenants = new Set<string>();
    for (const row of this.rows.values()) {
      if (isAnonymousProfile(row.profile) && Date.parse(row.profile.expiresAt) < now.getTime()) {
        tenants.add(row.profile.tenantId);
      }
    }
    return Promise.resolve([...tenants].sort());
  }
}
