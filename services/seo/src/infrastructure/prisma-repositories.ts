import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
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
}

export class PrismaSeoProfileRepository implements SeoProfileRepository {
  private readonly deps: PrismaSeoRepositoriesDeps;

  constructor(deps: PrismaSeoRepositoriesDeps) {
    this.deps = deps;
  }

  async save(profile: SeoProfile, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
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

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<SeoProfile | null> {
    const run = (client: TransactionClient) =>
      client.seoProfile.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : SeoProfileMapper.toDomain(row);
  }

  async findByPageRef(pageRef: string, tenantId: string, tx?: unknown): Promise<SeoProfile | null> {
    const run = (client: TransactionClient) =>
      client.seoProfile.findFirst({ where: { pageRef, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : SeoProfileMapper.toDomain(row);
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<SeoProfile>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.seoProfile.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return buildPaginatedPage(
      rows.map((row) => SeoProfileMapper.toDomain(row)),
      limit,
      (p) => p.id.toString(),
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

  async save(redirect: Redirect, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
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

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Redirect | null> {
    const run = (client: TransactionClient) =>
      client.redirect.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : RedirectMapper.toDomain(row as RedirectRow);
  }

  async findByFromPath(fromPath: string, tenantId: string, tx?: unknown): Promise<Redirect | null> {
    const run = (client: TransactionClient) =>
      client.redirect.findFirst({ where: { fromPath, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : RedirectMapper.toDomain(row as RedirectRow);
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Redirect>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.redirect.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
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

  async save(sitemap: Sitemap, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
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

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Sitemap | null> {
    const run = (client: TransactionClient) =>
      client.sitemap.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : SitemapMapper.toDomain(row as SitemapRow);
  }

  async findByName(name: string, tenantId: string, tx?: unknown): Promise<Sitemap | null> {
    const run = (client: TransactionClient) =>
      client.sitemap.findFirst({ where: { name, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : SitemapMapper.toDomain(row as SitemapRow);
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Sitemap>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.sitemap.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
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

  async save(policy: RobotsPolicy, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
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

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<RobotsPolicy | null> {
    const run = (client: TransactionClient) =>
      client.robotsPolicy.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    if (row === null) return null;
    // `rules: JsonValue` on the Prisma row has no structural overlap with `RobotsPolicyRow`'s
    // `readonly RobotsRule[]` (comparability fails, not just assignability).
    return RobotsPolicyMapper.toDomain(row as unknown as RobotsPolicyRow);
  }

  async findByUserAgent(
    userAgent: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<RobotsPolicy | null> {
    const run = (client: TransactionClient) =>
      client.robotsPolicy.findFirst({ where: { userAgent, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    if (row === null) return null;
    // `rules: JsonValue` on the Prisma row has no structural overlap with `RobotsPolicyRow`'s
    // `readonly RobotsRule[]` (comparability fails, not just assignability).
    return RobotsPolicyMapper.toDomain(row as unknown as RobotsPolicyRow);
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<RobotsPolicy>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.robotsPolicy.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
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
