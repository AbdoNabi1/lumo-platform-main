import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import {
  DEFAULT_MENU_HANDLES,
  POLICY_TYPES,
  validateMenuItems,
  type PolicyType,
} from "@platform/storefront-content";
import { ConcurrencyError, logger } from "@platform/utils";
import { menuNeedsId } from "../domain/errors";
import { Menu } from "../domain/menu";
import { StorePolicy } from "../domain/store-policy";
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
import { StorefrontAccess } from "../domain/storefront-access";
import { StorefrontPreferences } from "../domain/storefront-preferences";
import { StorefrontTheme, type ThemeRelease } from "../domain/storefront-theme";
import { documentOf, isUniqueViolation, json, localeOf, localizedTextOf } from "./rows";

export interface PrismaOnlineStoreDeps {
  readonly prisma: Database;
}

function requireTx(tx: unknown, who: string): TransactionClient {
  if (tx === undefined || tx === null) {
    throw new Error(`${who} requires the unit of work's transaction client (ADR-0003).`);
  }
  return tx as TransactionClient;
}

/** ADR-0014: the caller's `tx` when given, else a tenant-scoped read transaction. */
function read<T>(
  prisma: Database,
  tenantId: string,
  tx: unknown,
  fn: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  return tx !== undefined && tx !== null
    ? fn(tx as TransactionClient)
    : runReadScoped(prisma, tenantId, fn);
}

/**
 * The injected clock's value, so a saved `updatedAt` equals the aggregate's (as in memory) instead of
 * the wall clock `@updatedAt` would write. Absent only for an aggregate never modified.
 */
function stampedAt(updatedAt: Date | null): { updatedAt?: Date } {
  return updatedAt === null ? {} : { updatedAt };
}

/** First save inserts (a lost insert race is a ConcurrencyError); later saves are version-guarded. */
async function guardedWrite(
  persisted: boolean,
  insert: () => Promise<unknown>,
  update: () => Promise<{ count: number }>,
  what: string,
): Promise<void> {
  if (!persisted) {
    try {
      await insert();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConcurrencyError(`${what} was created concurrently`);
      throw error;
    }
    return;
  }
  const updated = await update();
  if (updated.count === 0) throw new ConcurrencyError(`${what} was modified concurrently`);
}

export class PrismaPreferencesRepository implements PreferencesRepository {
  constructor(private readonly deps: PrismaOnlineStoreDeps) {}

  async get(tenantId: string, tx?: unknown): Promise<StorefrontPreferences> {
    const row = await read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStorePreferences.findFirst({ where: { tenantId } }),
    );
    if (row === null) return StorefrontPreferences.defaults();
    return StorefrontPreferences.reconstitute({
      homeTitle: localizedTextOf(row.homeTitle),
      homeMetaDescription: localizedTextOf(row.homeMetaDescription),
      shareImageRef: row.shareImageRef,
      defaultLocale: localeOf(row.defaultLocale),
      version: row.version,
      updatedAt: row.updatedAt,
      persisted: true,
    });
  }

  async save(preferences: StorefrontPreferences, tenantId: string, tx: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaPreferencesRepository.save");
    const s = preferences.snapshot();
    const data = {
      homeTitle: json(s.homeTitle),
      homeMetaDescription: json(s.homeMetaDescription),
      shareImageRef: s.shareImageRef,
      defaultLocale: s.defaultLocale,
      ...stampedAt(s.updatedAt),
    };
    await guardedWrite(
      s.persisted,
      () => client.onlineStorePreferences.create({ data: { tenantId, ...data, version: 1 } }),
      () =>
        client.onlineStorePreferences.updateMany({
          where: { tenantId, version: s.version },
          data: { ...data, version: { increment: 1 } },
        }),
      "Storefront preferences",
    );
  }
}

export class PrismaAccessRepository implements AccessRepository {
  constructor(private readonly deps: PrismaOnlineStoreDeps) {}

  async get(tenantId: string, tx?: unknown): Promise<StorefrontAccess> {
    const row = await read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStoreAccess.findFirst({ where: { tenantId } }),
    );
    if (row === null) return StorefrontAccess.defaults();
    return StorefrontAccess.reconstitute({
      locked: row.locked,
      passwordHash: row.passwordHash,
      passwordUpdatedAt: row.passwordUpdatedAt,
      message: localizedTextOf(row.message),
      accessVersion: row.accessVersion,
      version: row.version,
      updatedAt: row.updatedAt,
      persisted: true,
    });
  }

  async save(access: StorefrontAccess, tenantId: string, tx: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaAccessRepository.save");
    const s = access.snapshot();
    const data = {
      locked: s.locked,
      passwordHash: s.passwordHash,
      passwordUpdatedAt: s.passwordUpdatedAt,
      message: json(s.message),
      accessVersion: s.accessVersion,
      ...stampedAt(s.updatedAt),
    };
    await guardedWrite(
      s.persisted,
      () => client.onlineStoreAccess.create({ data: { tenantId, ...data, version: 1 } }),
      () =>
        client.onlineStoreAccess.updateMany({
          where: { tenantId, version: s.version },
          data: { ...data, version: { increment: 1 } },
        }),
      "Storefront access",
    );
  }
}

export class PrismaThemeRepository implements ThemeRepository {
  constructor(private readonly deps: PrismaOnlineStoreDeps) {}

  async get(tenantId: string, tx?: unknown): Promise<StorefrontTheme> {
    const row = await read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStoreTheme.findFirst({ where: { tenantId } }),
    );
    if (row === null) return StorefrontTheme.initial();
    return StorefrontTheme.reconstitute({
      draft: documentOf(row.draft),
      draftRevision: row.draftRevision,
      draftSavedAt: row.draftSavedAt,
      published: row.published === null ? null : documentOf(row.published),
      publishedDraftRevision: row.publishedDraftRevision,
      releaseNumber: row.releaseNumber,
      publishedAt: row.publishedAt,
      publishedBy: row.publishedBy,
      version: row.version,
      persisted: true,
    });
  }

  async save(theme: StorefrontTheme, tenantId: string, tx: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaThemeRepository.save");
    const s = theme.snapshot();
    // `published` only ever goes from null to a document, so a null is never written (Ruling: no DbNull).
    const data = {
      draft: json(s.draft),
      draftRevision: s.draftRevision,
      ...(s.draftSavedAt === null ? {} : { draftSavedAt: s.draftSavedAt }),
      ...(s.published === null ? {} : { published: json(s.published) }),
      publishedDraftRevision: s.publishedDraftRevision,
      releaseNumber: s.releaseNumber,
      publishedAt: s.publishedAt,
      publishedBy: s.publishedBy,
    };
    await guardedWrite(
      s.persisted,
      () => client.onlineStoreTheme.create({ data: { tenantId, ...data, version: 1 } }),
      () =>
        client.onlineStoreTheme.updateMany({
          where: { tenantId, version: s.version },
          data: { ...data, version: { increment: 1 } },
        }),
      "Storefront theme",
    );
  }
}

function releaseOf(row: {
  id: string;
  releaseNumber: number;
  document: unknown;
  publishedAt: Date;
  publishedBy: string;
}): ThemeRelease {
  return {
    id: row.id,
    releaseNumber: row.releaseNumber,
    document: documentOf(row.document),
    publishedAt: row.publishedAt,
    publishedBy: row.publishedBy,
  };
}

export class PrismaThemeReleaseRepository implements ThemeReleaseRepository {
  constructor(private readonly deps: PrismaOnlineStoreDeps) {}

  async append(release: ThemeRelease, tenantId: string, tx: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaThemeReleaseRepository.append");
    try {
      await client.onlineStoreThemeRelease.create({
        data: {
          id: release.id,
          tenantId,
          releaseNumber: release.releaseNumber,
          document: json(release.document),
          publishedAt: release.publishedAt,
          publishedBy: release.publishedBy,
        },
      });
    } catch (error) {
      // (tenant_id, release_number) is unique: the in-memory repository throws the same class.
      if (isUniqueViolation(error)) throw new ConcurrencyError("Release number already used");
      throw error;
    }
  }

  async list(tenantId: string, limit: number, tx?: unknown): Promise<readonly ThemeRelease[]> {
    const rows = await read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStoreThemeRelease.findMany({
        where: { tenantId },
        orderBy: { releaseNumber: "desc" },
        take: limit,
      }),
    );
    // Sorted again here: the order is the contract, not an accident of the driver.
    return rows
      .map(releaseOf)
      .sort((a, b) => b.releaseNumber - a.releaseNumber)
      .slice(0, limit);
  }

  async get(releaseNumber: number, tenantId: string, tx?: unknown): Promise<ThemeRelease | null> {
    const row = await read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStoreThemeRelease.findFirst({ where: { tenantId, releaseNumber } }),
    );
    return row === null ? null : releaseOf(row);
  }

  async pruneBeyond(keep: number, tenantId: string, tx: unknown): Promise<number> {
    const client = requireTx(tx, "PrismaThemeReleaseRepository.pruneBeyond");
    const rows = await client.onlineStoreThemeRelease.findMany({
      where: { tenantId },
      select: { releaseNumber: true },
    });
    const numbers = rows.map((row) => row.releaseNumber).sort((a, b) => b - a);
    if (numbers.length <= keep) return 0;
    const deleted = await client.onlineStoreThemeRelease.deleteMany({
      where: { tenantId, releaseNumber: { in: numbers.slice(keep) } },
    });
    return deleted.count;
  }
}

export class PrismaPreviewTokenRepository implements PreviewTokenRepository {
  constructor(private readonly deps: PrismaOnlineStoreDeps) {}

  async insert(record: PreviewTokenRecord, tenantId: string, tx: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaPreviewTokenRepository.insert");
    await client.onlineStorePreviewToken.create({ data: { ...record, tenantId } });
  }

  async findActive(
    tokenHash: string,
    tenantId: string,
    now: Date,
  ): Promise<PreviewTokenRecord | null> {
    const row = await runReadScoped(this.deps.prisma, tenantId, (client) =>
      client.onlineStorePreviewToken.findFirst({
        where: { tenantId, tokenHash, expiresAt: { gt: now } },
      }),
    );
    return row === null
      ? null
      : {
          id: row.id,
          tokenHash: row.tokenHash,
          expiresAt: row.expiresAt,
          createdBy: row.createdBy,
          createdAt: row.createdAt,
        };
  }

  async deleteExpired(tenantId: string, now: Date, tx: unknown): Promise<number> {
    const client = requireTx(tx, "PrismaPreviewTokenRepository.deleteExpired");
    const deleted = await client.onlineStorePreviewToken.deleteMany({
      where: { tenantId, expiresAt: { lte: now } },
    });
    return deleted.count;
  }
}

/** Items are read back through the write-path validator: a corrupted list is an empty menu. */
function menuOf(row: {
  id: string;
  handle: string;
  title: string;
  items: unknown;
  version: number;
  updatedAt: Date;
}): Menu {
  const items = validateMenuItems(row.items);
  if (!items.ok) {
    // Fail closed (an empty menu), but not silently. Handle and codes only, never item content.
    logger.warn("online-store: stored menu items failed validation, reading an empty menu", {
      handle: row.handle,
      codes: [...new Set(items.issues.map((issue) => issue.code))],
    });
  }
  return Menu.reconstitute({
    id: row.id,
    handle: row.handle,
    title: row.title,
    items: items.ok ? items.value : [],
    version: row.version,
    updatedAt: row.updatedAt,
    persisted: true,
  });
}

export class PrismaMenuRepository implements MenuRepository {
  constructor(private readonly deps: PrismaOnlineStoreDeps) {}

  async list(tenantId: string, tx?: unknown): Promise<readonly Menu[]> {
    const rows = await read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStoreMenu.findMany({ where: { tenantId } }),
    );
    // Sorted here: the order is the contract, not an accident of the driver.
    return rows.map(menuOf).sort((a, b) => {
      const [x, y] = [a.snapshot().handle, b.snapshot().handle];
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }

  async get(handle: string, tenantId: string, tx?: unknown): Promise<Menu | null> {
    const row = await read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStoreMenu.findFirst({ where: { tenantId, handle } }),
    );
    return row === null ? null : menuOf(row);
  }

  async countCustom(tenantId: string, tx?: unknown): Promise<number> {
    return read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStoreMenu.count({
        where: { tenantId, handle: { notIn: [...DEFAULT_MENU_HANDLES] } },
      }),
    );
  }

  async save(menu: Menu, tenantId: string, tx: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaMenuRepository.save");
    const s = menu.snapshot();
    const id = s.id;
    if (id === null) throw menuNeedsId();
    const data = { title: s.title, items: json(s.items), ...stampedAt(s.updatedAt) };
    await guardedWrite(
      s.persisted,
      () =>
        client.onlineStoreMenu.create({
          data: { id, tenantId, handle: s.handle, ...data, version: 1 },
        }),
      () =>
        client.onlineStoreMenu.updateMany({
          // The id too: a menu deleted and re-created under this handle is another row.
          where: { id, tenantId, handle: s.handle, version: s.version },
          data: { ...data, version: { increment: 1 } },
        }),
      "Menu",
    );
  }

  async remove(handle: string, tenantId: string, tx: unknown): Promise<boolean> {
    const client = requireTx(tx, "PrismaMenuRepository.remove");
    const deleted = await client.onlineStoreMenu.deleteMany({ where: { tenantId, handle } });
    return deleted.count > 0;
  }
}

function policyOf(
  type: PolicyType,
  row: { body: unknown; updatedBy: string | null; version: number; updatedAt: Date },
): StorePolicy {
  return StorePolicy.reconstitute({
    type,
    body: localizedTextOf(row.body),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    version: row.version,
    persisted: true,
  });
}

export class PrismaPolicyRepository implements PolicyRepository {
  constructor(private readonly deps: PrismaOnlineStoreDeps) {}

  async list(tenantId: string, tx?: unknown): Promise<readonly StorePolicy[]> {
    const rows = await read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStorePolicy.findMany({ where: { tenantId } }),
    );
    // A Map, not an object: the stored type is data, and only the five known types are looked up.
    const byType = new Map(rows.map((row) => [row.type, row] as const));
    return POLICY_TYPES.map((type) => {
      const row = byType.get(type);
      return row === undefined ? StorePolicy.empty(type) : policyOf(type, row);
    });
  }

  async get(type: PolicyType, tenantId: string, tx?: unknown): Promise<StorePolicy> {
    const row = await read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStorePolicy.findFirst({ where: { tenantId, type } }),
    );
    return row === null ? StorePolicy.empty(type) : policyOf(type, row);
  }

  async save(policy: StorePolicy, tenantId: string, tx: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaPolicyRepository.save");
    const s = policy.snapshot();
    const data = { body: json(s.body), updatedBy: s.updatedBy, ...stampedAt(s.updatedAt) };
    await guardedWrite(
      s.persisted,
      () =>
        client.onlineStorePolicy.create({ data: { tenantId, type: s.type, ...data, version: 1 } }),
      () =>
        client.onlineStorePolicy.updateMany({
          where: { tenantId, type: s.type, version: s.version },
          data: { ...data, version: { increment: 1 } },
        }),
      "Policy",
    );
  }
}
