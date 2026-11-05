import { POLICY_TYPES, type PolicyType } from "@platform/storefront-content";
import { ConcurrencyError } from "@platform/utils";
import { menuNeedsId } from "../domain/errors";
import { Menu, type MenuSnapshot } from "../domain/menu";
import { StorePolicy, type PolicySnapshot } from "../domain/store-policy";
import type {
  AccessRepository,
  MenuRepository,
  PolicyRepository,
  PreferencesRepository,
  PreviewTokenRepository,
  ThemeReleaseRepository,
  ThemeRepository,
} from "../domain/repositories";
import type { PreviewTokenRecord } from "../domain/preview-token";
import { StorefrontAccess, type AccessSnapshot } from "../domain/storefront-access";
import { StorefrontPreferences, type PreferencesSnapshot } from "../domain/storefront-preferences";
import { StorefrontTheme, type ThemeRelease, type ThemeSnapshot } from "../domain/storefront-theme";

/** A single-row-per-shop store with the Prisma repository's insert/guarded-update semantics. */
class Rows<S extends { readonly version: number; readonly persisted: boolean }> {
  private readonly rows = new Map<string, S>();

  get(tenantId: string): S | undefined {
    return this.rows.get(tenantId);
  }

  save(tenantId: string, snapshot: S, what: string): void {
    const current = this.rows.get(tenantId);
    if (!snapshot.persisted) {
      if (current !== undefined) throw new ConcurrencyError(`${what} was created concurrently`);
      this.rows.set(tenantId, { ...snapshot, version: 1, persisted: true });
      return;
    }
    if (current === undefined || current.version !== snapshot.version) {
      throw new ConcurrencyError(`${what} was modified concurrently`);
    }
    this.rows.set(tenantId, { ...snapshot, version: snapshot.version + 1 });
  }
}

export class InMemoryPreferencesRepository implements PreferencesRepository {
  private readonly rows = new Rows<PreferencesSnapshot>();
  async get(tenantId: string): Promise<StorefrontPreferences> {
    const row = this.rows.get(tenantId);
    return row === undefined
      ? StorefrontPreferences.defaults()
      : StorefrontPreferences.reconstitute(row);
  }
  async save(p: StorefrontPreferences, tenantId: string): Promise<void> {
    this.rows.save(tenantId, p.snapshot(), "Storefront preferences");
  }
}

export class InMemoryAccessRepository implements AccessRepository {
  private readonly rows = new Rows<AccessSnapshot>();
  async get(tenantId: string): Promise<StorefrontAccess> {
    const row = this.rows.get(tenantId);
    return row === undefined ? StorefrontAccess.defaults() : StorefrontAccess.reconstitute(row);
  }
  async save(a: StorefrontAccess, tenantId: string): Promise<void> {
    this.rows.save(tenantId, a.snapshot(), "Storefront access");
  }
}

export class InMemoryThemeRepository implements ThemeRepository {
  private readonly rows = new Rows<ThemeSnapshot>();
  async get(tenantId: string): Promise<StorefrontTheme> {
    const row = this.rows.get(tenantId);
    return row === undefined ? StorefrontTheme.initial() : StorefrontTheme.reconstitute(row);
  }
  async save(t: StorefrontTheme, tenantId: string): Promise<void> {
    this.rows.save(tenantId, t.snapshot(), "Storefront theme");
  }
}

export class InMemoryThemeReleaseRepository implements ThemeReleaseRepository {
  private readonly rows: { tenantId: string; release: ThemeRelease }[] = [];
  async append(release: ThemeRelease, tenantId: string): Promise<void> {
    if (
      this.rows.some(
        (r) => r.tenantId === tenantId && r.release.releaseNumber === release.releaseNumber,
      )
    ) {
      throw new ConcurrencyError("Release number already used");
    }
    this.rows.push({ tenantId, release });
  }
  async list(tenantId: string, limit: number): Promise<readonly ThemeRelease[]> {
    return this.rows
      .filter((r) => r.tenantId === tenantId)
      .map((r) => r.release)
      .sort((a, b) => b.releaseNumber - a.releaseNumber)
      .slice(0, limit);
  }
  async get(releaseNumber: number, tenantId: string): Promise<ThemeRelease | null> {
    return (
      this.rows.find((r) => r.tenantId === tenantId && r.release.releaseNumber === releaseNumber)
        ?.release ?? null
    );
  }
  async pruneBeyond(keep: number, tenantId: string): Promise<number> {
    const kept = new Set((await this.list(tenantId, keep)).map((r) => r.id));
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      const row = this.rows[i];
      if (row !== undefined && row.tenantId === tenantId && !kept.has(row.release.id))
        this.rows.splice(i, 1);
    }
    return before - this.rows.length;
  }
}

export class InMemoryPreviewTokenRepository implements PreviewTokenRepository {
  private readonly rows: { tenantId: string; record: PreviewTokenRecord }[] = [];
  async insert(record: PreviewTokenRecord, tenantId: string): Promise<void> {
    this.rows.push({ tenantId, record });
  }
  async findActive(
    tokenHash: string,
    tenantId: string,
    now: Date,
  ): Promise<PreviewTokenRecord | null> {
    return (
      this.rows.find(
        (r) =>
          r.tenantId === tenantId && r.record.tokenHash === tokenHash && r.record.expiresAt > now,
      )?.record ?? null
    );
  }
  async deleteExpired(tenantId: string, now: Date): Promise<number> {
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      const row = this.rows[i];
      if (row !== undefined && row.tenantId === tenantId && row.record.expiresAt <= now)
        this.rows.splice(i, 1);
    }
    return before - this.rows.length;
  }
  /** Test seam: every stored record, across shops (to assert only hashes are stored). */
  all(): readonly PreviewTokenRecord[] {
    return this.rows.map((r) => r.record);
  }
}

/** Plain JSON data only (menu items, localized text): a copy shares nothing with the aggregate. */
const copyOf = <T>(value: T): T => structuredClone(value);

/**
 * Many rows per shop, keyed by a natural key within the shop, with the Prisma repositories'
 * insert/guarded-update semantics. Maps all the way down: a key such as `__proto__` is only a key.
 */
class KeyedRows<S extends { readonly version: number; readonly persisted: boolean }> {
  private readonly shops = new Map<string, Map<string, S>>();

  get(tenantId: string, key: string): S | undefined {
    return this.shops.get(tenantId)?.get(key);
  }

  all(tenantId: string): S[] {
    return [...(this.shops.get(tenantId)?.values() ?? [])];
  }

  save(tenantId: string, key: string, snapshot: S, what: string): void {
    let rows = this.shops.get(tenantId);
    const current = rows?.get(key);
    if (!snapshot.persisted) {
      if (current !== undefined) throw new ConcurrencyError(`${what} was created concurrently`);
      if (rows === undefined) {
        rows = new Map();
        this.shops.set(tenantId, rows);
      }
      rows.set(key, copyOf({ ...snapshot, version: 1, persisted: true }));
      return;
    }
    if (rows === undefined || current === undefined || current.version !== snapshot.version) {
      throw new ConcurrencyError(`${what} was modified concurrently`);
    }
    rows.set(key, copyOf({ ...snapshot, version: snapshot.version + 1 }));
  }

  remove(tenantId: string, key: string): boolean {
    return this.shops.get(tenantId)?.delete(key) ?? false;
  }
}

export class InMemoryMenuRepository implements MenuRepository {
  private readonly rows = new KeyedRows<MenuSnapshot>();

  async list(tenantId: string): Promise<readonly Menu[]> {
    return this.rows
      .all(tenantId)
      .sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0))
      .map((row) => Menu.reconstitute(copyOf(row)));
  }

  async get(handle: string, tenantId: string): Promise<Menu | null> {
    const row = this.rows.get(tenantId, handle);
    return row === undefined ? null : Menu.reconstitute(copyOf(row));
  }

  async save(menu: Menu, tenantId: string): Promise<void> {
    const snapshot = menu.snapshot();
    if (snapshot.id === null) throw menuNeedsId();
    const current = this.rows.get(tenantId, snapshot.handle);
    // A menu deleted and re-created under this handle is another row (the Prisma where names the id).
    if (snapshot.persisted && current !== undefined && current.id !== snapshot.id) {
      throw new ConcurrencyError("Menu was modified concurrently");
    }
    this.rows.save(tenantId, snapshot.handle, snapshot, "Menu");
  }

  async remove(handle: string, tenantId: string): Promise<boolean> {
    return this.rows.remove(tenantId, handle);
  }
}

export class InMemoryPolicyRepository implements PolicyRepository {
  private readonly rows = new KeyedRows<PolicySnapshot>();

  async list(tenantId: string): Promise<readonly StorePolicy[]> {
    return POLICY_TYPES.map((type) => this.read(type, tenantId));
  }

  async get(type: PolicyType, tenantId: string): Promise<StorePolicy> {
    return this.read(type, tenantId);
  }

  async save(policy: StorePolicy, tenantId: string): Promise<void> {
    const snapshot = policy.snapshot();
    this.rows.save(tenantId, snapshot.type, snapshot, "Policy");
  }

  private read(type: PolicyType, tenantId: string): StorePolicy {
    const row = this.rows.get(tenantId, type);
    return row === undefined ? StorePolicy.empty(type) : StorePolicy.reconstitute(copyOf(row));
  }
}
