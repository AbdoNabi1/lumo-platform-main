import type { PolicyType } from "@platform/storefront-content";
import type { Menu } from "./menu";
import type { StorePolicy } from "./store-policy";
import type { StorefrontAccess } from "./storefront-access";
import type { StorefrontPreferences } from "./storefront-preferences";
import type { StorefrontTheme, ThemeRelease } from "./storefront-theme";
import type { PreviewTokenRecord } from "./preview-token";

/**
 * ADR-0014: every method takes `tenantId` per call. `get` never returns null: an absent row is the
 * aggregate's defaults with `persisted: false`. `save` requires the unit of work's `tx`, inserts on
 * the first save and is a version-guarded update afterwards; a lost race throws `ConcurrencyError`.
 */
export interface PreferencesRepository {
  get(tenantId: string, tx?: unknown): Promise<StorefrontPreferences>;
  save(preferences: StorefrontPreferences, tenantId: string, tx: unknown): Promise<void>;
}

export interface AccessRepository {
  get(tenantId: string, tx?: unknown): Promise<StorefrontAccess>;
  save(access: StorefrontAccess, tenantId: string, tx: unknown): Promise<void>;
}

export interface ThemeRepository {
  get(tenantId: string, tx?: unknown): Promise<StorefrontTheme>;
  save(theme: StorefrontTheme, tenantId: string, tx: unknown): Promise<void>;
}

export interface ThemeReleaseRepository {
  append(release: ThemeRelease, tenantId: string, tx: unknown): Promise<void>;
  /** Newest first, at most `limit`. */
  list(tenantId: string, limit: number, tx?: unknown): Promise<readonly ThemeRelease[]>;
  get(releaseNumber: number, tenantId: string, tx?: unknown): Promise<ThemeRelease | null>;
  /** Deletes every release older than the newest `keep`; returns how many went. */
  pruneBeyond(keep: number, tenantId: string, tx: unknown): Promise<number>;
}

export interface PreviewTokenRepository {
  insert(record: PreviewTokenRecord, tenantId: string, tx: unknown): Promise<void>;
  /** The unexpired token with this hash IN THIS SHOP, or null. A token of shop A is unknown in B. */
  findActive(tokenHash: string, tenantId: string, now: Date): Promise<PreviewTokenRecord | null>;
  deleteExpired(tenantId: string, now: Date, tx: unknown): Promise<number>;
}

export interface MenuRepository {
  /** Persisted menus only, ordered by handle. */
  list(tenantId: string, tx?: unknown): Promise<readonly Menu[]>;
  get(handle: string, tenantId: string, tx?: unknown): Promise<Menu | null>;
  /** First save inserts (a duplicate handle throws ConcurrencyError); later saves are version-guarded. */
  save(menu: Menu, tenantId: string, tx: unknown): Promise<void>;
  /** True when a row went. */
  remove(handle: string, tenantId: string, tx: unknown): Promise<boolean>;
}

export interface PolicyRepository {
  /** All five, in POLICY_TYPES order; an absent row is `StorePolicy.empty(type)`. */
  list(tenantId: string, tx?: unknown): Promise<readonly StorePolicy[]>;
  get(type: PolicyType, tenantId: string, tx?: unknown): Promise<StorePolicy>;
  save(policy: StorePolicy, tenantId: string, tx: unknown): Promise<void>;
}
