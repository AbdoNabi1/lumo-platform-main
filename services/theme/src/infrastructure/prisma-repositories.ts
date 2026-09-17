import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Theme } from "../domain/theme";
import type { ThemeRepository } from "../domain/repositories";
import { ThemeMapper, type ThemeRow } from "./mappers";

export interface PrismaThemeRepositoriesDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

/** Production `ThemeRepository` on the `theme` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaThemeRepository implements ThemeRepository {
  private readonly deps: PrismaThemeRepositoriesDeps;

  constructor(deps: PrismaThemeRepositoriesDeps) {
    this.deps = deps;
  }

  async save(theme: Theme, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const id = theme.id.toString();
    const row = ThemeMapper.toRow(theme, tenantId);

    if (theme.version === 0) {
      await client.theme.create({
        data: {
          ...row,
          colors: row.colors,
          typography: row.typography,
          spacing: row.spacing,
          versions: row.versions,
        },
      });
    } else {
      const updated = await client.theme.updateMany({
        where: { id, tenantId, version: theme.version },
        data: {
          colors: row.colors,
          typography: row.typography,
          spacing: row.spacing,
          status: row.status,
          versions: row.versions,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Theme ${id} was modified concurrently (expected version ${theme.version})`,
        );
      }
    }

    await this.deps.outbox.write(theme.pullDomainEvents(), this.deps.context, client);
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Theme | null> {
    const run = (client: TransactionClient) => client.theme.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : ThemeMapper.toDomain(this.toMapperRow(row));
  }

  async findByName(name: string, tenantId: string, tx?: unknown): Promise<Theme | null> {
    const run = (client: TransactionClient) =>
      client.theme.findFirst({ where: { name, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : ThemeMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Theme>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.theme.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return buildPaginatedPage(
      rows.map((row) => ThemeMapper.toDomain(this.toMapperRow(row))),
      limit,
      (t) => t.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly name: string;
    readonly colors: unknown;
    readonly typography: unknown;
    readonly spacing: unknown;
    readonly status: string;
    readonly versions: unknown;
    readonly version: number;
  }): ThemeRow {
    return {
      ...row,
      colors: row.colors as ThemeRow["colors"],
      typography: row.typography as ThemeRow["typography"],
      spacing: row.spacing as ThemeRow["spacing"],
      versions: row.versions as ThemeRow["versions"],
    };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaThemeRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
