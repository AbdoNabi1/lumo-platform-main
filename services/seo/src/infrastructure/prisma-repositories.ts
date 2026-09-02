import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Prisma } from "@prisma/client";
import type { Redirect } from "../domain/redirect";
import type {
  RedirectRepository,
  RobotsPolicyRepository,
  SeoProfileRepository,
  SitemapRepository,
} from "../domain/repositories";
import type { RobotsPolicy } from "../domain/robots-policy";
import type { SeoProfile } from "../domain/seo-profile";
import type { Sitemap } from "../domain/sitemap";
import {
  RedirectMapper,
  RobotsPolicyMapper,
  SeoProfileMapper,
  SitemapMapper,
  type RedirectRow,
  type RobotsPolicyRow,
  type SitemapRow,
} from "./mappers";

export interface PrismaSeoRepositoriesDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  readonly tenantId: string;
}

export class PrismaSeoProfileRepository implements SeoProfileRepository {
  private readonly deps: PrismaSeoRepositoriesDeps;

  constructor(deps: PrismaSeoRepositoriesDeps) {
    this.deps = deps;
  }

  async save(profile: SeoProfile, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const id = profile.id.toString();
    const row = SeoProfileMapper.toRow(profile, tenantId);
    if (profile.version === 0) {
      await client.seoProfile.create({ data: row });
    } else {
      const updated = await client.seoProfile.updateMany({
        where: { id, tenantId, version: profile.version },
        data: {
          title: row.title,
          description: row.description,
          canonicalUrl: row.canonicalUrl,
          ogImageRef: row.ogImageRef,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(`SeoProfile ${id} was modified concurrently`);
      }
    }
    await this.deps.outbox.write(profile.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<SeoProfile | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.seoProfile.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : SeoProfileMapper.toDomain(row);
  }

  async findByPageRef(pageRef: string, tx?: unknown): Promise<SeoProfile | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.seoProfile.findFirst({
      where: { pageRef, tenantId: this.deps.tenantId },
    });
    return row === null ? null : SeoProfileMapper.toDomain(row);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<SeoProfile>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.seoProfile.findMany({
      where: { tenantId: this.deps.tenantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(rows.map((row) => SeoProfileMapper.toDomain(row)), limit, (p) =>
      p.id.toString(),
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) throw new Error("requires transaction client (ADR-0003)");
    return tx as TransactionClient;
  }
}

export class PrismaRedirectRepository implements RedirectRepository {
  private readonly deps: PrismaSeoRepositoriesDeps;

  constructor(deps: PrismaSeoRepositoriesDeps) {
    this.deps = deps;
  }

  async save(redirect: Redirect, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const id = redirect.id.toString();
    const row = RedirectMapper.toRow(redirect, tenantId);
    if (redirect.version === 0) {
      await client.redirect.create({ data: row });
    } else {
      const updated = await client.redirect.updateMany({
        where: { id, tenantId, version: redirect.version },
        data: {
          toPath: row.toPath,
          statusCode: row.statusCode,
          active: row.active,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0)
        throw new ConcurrencyError(`Redirect ${id} was modified concurrently`);
    }
    await this.deps.outbox.write(redirect.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Redirect | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.redirect.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : RedirectMapper.toDomain(row as RedirectRow);
  }

  async findByFromPath(fromPath: string, tx?: unknown): Promise<Redirect | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.redirect.findFirst({
      where: { fromPath, tenantId: this.deps.tenantId },
    });
    return row === null ? null : RedirectMapper.toDomain(row as RedirectRow);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Redirect>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.redirect.findMany({
      where: { tenantId: this.deps.tenantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => RedirectMapper.toDomain(row as RedirectRow)),
      limit,
      (r) => r.id.toString(),
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) throw new Error("requires transaction client (ADR-0003)");
    return tx as TransactionClient;
  }
}

export class PrismaSitemapRepository implements SitemapRepository {
  private readonly deps: PrismaSeoRepositoriesDeps;

  constructor(deps: PrismaSeoRepositoriesDeps) {
    this.deps = deps;
  }

  async save(sitemap: Sitemap, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const id = sitemap.id.toString();
    const row = SitemapMapper.toRow(sitemap, tenantId);
    if (sitemap.version === 0) {
      await client.sitemap.create({
        data: { ...row, urls: row.urls },
      });
    } else {
      const updated = await client.sitemap.updateMany({
        where: { id, tenantId, version: sitemap.version },
        data: {
          urls: row.urls,
          lastGeneratedAt: row.lastGeneratedAt,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0)
        throw new ConcurrencyError(`Sitemap ${id} was modified concurrently`);
    }
    await this.deps.outbox.write(sitemap.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Sitemap | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.sitemap.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    if (row === null) return null;
    return SitemapMapper.toDomain(row as SitemapRow);
  }

  async findByName(name: string, tx?: unknown): Promise<Sitemap | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.sitemap.findFirst({ where: { name, tenantId: this.deps.tenantId } });
    if (row === null) return null;
    return SitemapMapper.toDomain(row as SitemapRow);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Sitemap>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.sitemap.findMany({
      where: { tenantId: this.deps.tenantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => SitemapMapper.toDomain(row as SitemapRow)),
      limit,
      (s) => s.id.toString(),
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) throw new Error("requires transaction client (ADR-0003)");
    return tx as TransactionClient;
  }
}

export class PrismaRobotsPolicyRepository implements RobotsPolicyRepository {
  private readonly deps: PrismaSeoRepositoriesDeps;

  constructor(deps: PrismaSeoRepositoriesDeps) {
    this.deps = deps;
  }

  async save(policy: RobotsPolicy, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const id = policy.id.toString();
    const row = RobotsPolicyMapper.toRow(policy, tenantId);
    if (policy.version === 0) {
      // `rules` is `readonly RobotsRule[]` — a closed element shape without an index signature, so
      // it has no structural overlap with `InputJsonValue`'s `InputJsonObject` (comparability fails).
      await client.robotsPolicy.create({
        data: { ...row, rules: row.rules as unknown as Prisma.InputJsonValue },
      });
    } else {
      const updated = await client.robotsPolicy.updateMany({
        where: { id, tenantId, version: policy.version },
        data: { rules: row.rules as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
      });
      if (updated.count === 0)
        throw new ConcurrencyError(`RobotsPolicy ${id} was modified concurrently`);
    }
    await this.deps.outbox.write(policy.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<RobotsPolicy | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.robotsPolicy.findFirst({
      where: { id, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    // `rules: JsonValue` on the Prisma row has no structural overlap with `RobotsPolicyRow`'s
    // `readonly RobotsRule[]` (comparability fails, not just assignability).
    return RobotsPolicyMapper.toDomain(row as unknown as RobotsPolicyRow);
  }

  async findByUserAgent(userAgent: string, tx?: unknown): Promise<RobotsPolicy | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.robotsPolicy.findFirst({
      where: { userAgent, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    // `rules: JsonValue` on the Prisma row has no structural overlap with `RobotsPolicyRow`'s
    // `readonly RobotsRule[]` (comparability fails, not just assignability).
    return RobotsPolicyMapper.toDomain(row as unknown as RobotsPolicyRow);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<RobotsPolicy>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.robotsPolicy.findMany({
      where: { tenantId: this.deps.tenantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      // `rules: JsonValue` has no structural overlap with `RobotsPolicyRow`'s `readonly RobotsRule[]`.
      rows.map((row) => RobotsPolicyMapper.toDomain(row as unknown as RobotsPolicyRow)),
      limit,
      (p) => p.id.toString(),
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) throw new Error("requires transaction client (ADR-0003)");
    return tx as TransactionClient;
  }
}
