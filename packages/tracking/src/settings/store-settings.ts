/**
 * Per-store tracking settings (Tracking P2-D1): the consent policy the server stamps on every event, and whether the
 * storefront shows its cookie notice. One row per store in `tracking.store_tracking_settings`; a store with no row
 * has the defaults (`notice_only`, notice shown), so nothing needs saving for tracking to work.
 *
 * ## Reads on the hot path
 *
 * The ingest runtime asks {@link TrackingSettingsService.consentPolicyFor} for every event, so the answer is cached
 * per store for 30 seconds (an edit through this instance shows at once; another instance sees it within the TTL).
 * It **fails open**: a settings row that cannot be read is `notice_only` — the Egypt/MENA norm — because losing a
 * store's conversions to a database blip costs more than forwarding under the default rule for half a minute. The
 * failure is reported through `onError` at most once a minute per store, with no data in it.
 *
 * The admin read ({@link TrackingSettingsService.get}) does NOT swallow errors: a settings page that showed the
 * defaults while the database was down would invite a save over a real row.
 */

import { DEFAULT_CONSENT_POLICY, type ConsentPolicy } from "../envelope/consent";

/** How long a read is reused. */
export const SETTINGS_CACHE_TTL_MS = 30_000;
/** At most one report of an unreadable settings row per store in this window. */
const ERROR_REPORT_WINDOW_MS = 60_000;

export interface TrackingStoreSettings {
  readonly tenantId: string;
  readonly consentPolicy: ConsentPolicy;
  readonly cookieNoticeEnabled: boolean;
  /** 0 = never saved (the defaults); the first save creates version 1. */
  readonly version: number;
  /** ISO-8601 instant of the last save, `null` for the defaults. */
  readonly updatedAt: string | null;
}

export function defaultTrackingSettings(tenantId: string): TrackingStoreSettings {
  return {
    tenantId,
    consentPolicy: DEFAULT_CONSENT_POLICY,
    cookieNoticeEnabled: true,
    version: 0,
    updatedAt: null,
  };
}

export interface TrackingSettingsSave {
  readonly tenantId: string;
  readonly consentPolicy: ConsentPolicy;
  readonly cookieNoticeEnabled: boolean;
  /** 0 ⇒ create (version 1); n ⇒ update the row only if it is still at version n. */
  readonly expectedVersion: number;
  readonly updatedAt: string;
}

/** The port a database adapter implements. */
export interface TrackingSettingsStore {
  get(tenantId: string): Promise<TrackingStoreSettings | null>;
  /** The saved row, or `null` when the row is not at `expectedVersion` (or a first save lost a race). */
  save(input: TrackingSettingsSave): Promise<TrackingStoreSettings | null>;
}

export interface TrackingSettingsInput {
  readonly consentPolicy: ConsentPolicy;
  readonly cookieNoticeEnabled: boolean;
  readonly expectedVersion: number;
}

export type TrackingSettingsUpdate =
  | { readonly status: "saved"; readonly settings: TrackingStoreSettings }
  | { readonly status: "conflict"; readonly current: TrackingStoreSettings };

/** What the ingest runtime needs: the policy a store's events are forwarded under. */
export interface ConsentPolicyPort {
  consentPolicyFor(tenantId: string): Promise<ConsentPolicy>;
}

export interface TrackingSettingsServiceDeps {
  readonly store: TrackingSettingsStore;
  readonly clock: { now(): Date };
  readonly cacheTtlMs?: number;
  /** A failure that was swallowed (fail open). Receives no settings and no tenant data. */
  readonly onError?: (error: unknown) => void;
}

interface CachedSettings {
  readonly settings: TrackingStoreSettings;
  readonly expiresAt: number;
}

export class TrackingSettingsService implements ConsentPolicyPort {
  private readonly cache = new Map<string, CachedSettings>();
  private readonly lastReport = new Map<string, number>();
  private readonly ttl: number;

  constructor(private readonly deps: TrackingSettingsServiceDeps) {
    this.ttl = deps.cacheTtlMs ?? SETTINGS_CACHE_TTL_MS;
  }

  /** The store's settings, the defaults when it never saved any. Errors surface (this is the admin read). */
  async get(tenantId: string): Promise<TrackingStoreSettings> {
    return (await this.deps.store.get(tenantId)) ?? defaultTrackingSettings(tenantId);
  }

  /** Saves the whole document. A stale `expectedVersion` is a conflict carrying what is stored now. */
  async update(tenantId: string, input: TrackingSettingsInput): Promise<TrackingSettingsUpdate> {
    const saved = await this.deps.store.save({
      tenantId,
      consentPolicy: input.consentPolicy,
      cookieNoticeEnabled: input.cookieNoticeEnabled,
      expectedVersion: input.expectedVersion,
      updatedAt: this.deps.clock.now().toISOString(),
    });
    this.cache.delete(tenantId);
    if (saved === null) return { status: "conflict", current: await this.get(tenantId) };
    return { status: "saved", settings: saved };
  }

  /** The policy this store's events are forwarded under. Cached; fails open to `notice_only`. */
  async consentPolicyFor(tenantId: string): Promise<ConsentPolicy> {
    return (await this.readCached(tenantId)).consentPolicy;
  }

  /** Whether the storefront shows its cookie notice. Cached; fails open to `true` (the default). */
  async cookieNoticeEnabledFor(tenantId: string): Promise<boolean> {
    return (await this.readCached(tenantId)).cookieNoticeEnabled;
  }

  private async readCached(tenantId: string): Promise<TrackingStoreSettings> {
    const nowMs = this.deps.clock.now().getTime();
    const cached = this.cache.get(tenantId);
    if (cached !== undefined && cached.expiresAt > nowMs) return cached.settings;

    let settings: TrackingStoreSettings;
    try {
      settings = await this.get(tenantId);
    } catch (error) {
      this.report(tenantId, nowMs, error);
      settings = defaultTrackingSettings(tenantId);
    }
    this.cache.set(tenantId, { settings, expiresAt: nowMs + this.ttl });
    return settings;
  }

  private report(tenantId: string, nowMs: number, error: unknown): void {
    const last = this.lastReport.get(tenantId);
    if (last !== undefined && nowMs - last < ERROR_REPORT_WINDOW_MS) return;
    this.lastReport.set(tenantId, nowMs);
    this.deps.onError?.(error);
  }
}

/** In-memory twin of the Postgres store, for unit tests of the service, the routes and the ingest runtime. */
export class InMemoryTrackingSettingsStore implements TrackingSettingsStore {
  private readonly rows = new Map<string, TrackingStoreSettings>();
  /** Test seam: make every call fail (the fail-open path). */
  failWith: Error | undefined;

  get(tenantId: string): Promise<TrackingStoreSettings | null> {
    if (this.failWith !== undefined) return Promise.reject(this.failWith);
    return Promise.resolve(this.rows.get(tenantId) ?? null);
  }

  save(input: TrackingSettingsSave): Promise<TrackingStoreSettings | null> {
    if (this.failWith !== undefined) return Promise.reject(this.failWith);
    const existing = this.rows.get(input.tenantId);
    if ((existing?.version ?? 0) !== input.expectedVersion) return Promise.resolve(null);
    const next: TrackingStoreSettings = {
      tenantId: input.tenantId,
      consentPolicy: input.consentPolicy,
      cookieNoticeEnabled: input.cookieNoticeEnabled,
      version: input.expectedVersion + 1,
      updatedAt: input.updatedAt,
    };
    this.rows.set(input.tenantId, next);
    return Promise.resolve(next);
  }
}
