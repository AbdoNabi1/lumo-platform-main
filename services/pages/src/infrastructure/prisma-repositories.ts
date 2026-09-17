import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Page } from "../domain/page";
import type { PageRepository, TemplateRepository } from "../domain/repositories";
import type { Template } from "../domain/template";
import { PageMapper, TemplateMapper } from "./mappers";

export interface PrismaPagesRepositoriesDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

export class PrismaPageRepository implements PageRepository {
  private readonly deps: PrismaPagesRepositoriesDeps;

  constructor(deps: PrismaPagesRepositoriesDeps) {
    this.deps = deps;
  }

  async save(page: Page, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const id = page.id.toString();
    const row = PageMapper.toRow(page, tenantId);

    if (page.version === 0) {
      await client.page.create({ data: row });
    } else {
      const updated = await client.page.updateMany({
        where: { id, tenantId, version: page.version },
        data: { status: row.status, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Page ${id} was modified concurrently (expected version ${page.version})`,
        );
      }
    }

    await this.deps.outbox.write(page.pullDomainEvents(), this.deps.context, client);
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Page | null> {
    const run = (client: TransactionClient) => client.page.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : PageMapper.toDomain(row);
  }

  async findByRoutePath(routePath: string, tenantId: string, tx?: unknown): Promise<Page | null> {
    const run = (client: TransactionClient) =>
      client.page.findFirst({ where: { routePath, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : PageMapper.toDomain(row);
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Page>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.page.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return buildPaginatedPage(
      rows.map((row) => PageMapper.toDomain(row)),
      limit,
      (p) => p.id.toString(),
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaPageRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}

export class PrismaTemplateRepository implements TemplateRepository {
  private readonly deps: PrismaPagesRepositoriesDeps;

  constructor(deps: PrismaPagesRepositoriesDeps) {
    this.deps = deps;
  }

  async save(template: Template, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const id = template.id.toString();
    const row = TemplateMapper.toRow(template, tenantId);

    if (template.version === 0) {
      await client.template.create({ data: row });
    } else {
      const updated = await client.template.updateMany({
        where: { id, tenantId, version: template.version },
        data: { status: row.status, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Template ${id} was modified concurrently (expected version ${template.version})`,
        );
      }
    }

    await this.deps.outbox.write(template.pullDomainEvents(), this.deps.context, client);
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Template | null> {
    const run = (client: TransactionClient) =>
      client.template.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : TemplateMapper.toDomain(row);
  }

  async findByName(name: string, tenantId: string, tx?: unknown): Promise<Template | null> {
    const run = (client: TransactionClient) =>
      client.template.findFirst({ where: { name, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : TemplateMapper.toDomain(row);
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Template>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.template.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return buildPaginatedPage(
      rows.map((row) => TemplateMapper.toDomain(row)),
      limit,
      (t) => t.id.toString(),
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaTemplateRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
