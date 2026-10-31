import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import { ConcurrencyError } from "@platform/utils";
import type {
  AccessRepository,
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
