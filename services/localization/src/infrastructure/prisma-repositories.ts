import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Locale } from "../domain/locale";
import type { LocaleRepository, TranslationSetRepository } from "../domain/repositories";
import type { TranslationSet } from "../domain/translation-set";
import { LocaleMapper, TranslationSetMapper, type TranslationSetRow } from "./mappers";

export interface PrismaLocalizationRepositoriesDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

export class PrismaLocaleRepository implements LocaleRepository {
  private readonly deps: PrismaLocalizationRepositoriesDeps;

  constructor(deps: PrismaLocalizationRepositoriesDeps) {
    this.deps = deps;
  }

  async save(locale: Locale, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const id = locale.id.toString();
    const row = LocaleMapper.toRow(locale, tenantId);

    if (locale.version === 0) {
      await client.locale.create({ data: row });
    } else {
      const updated = await client.locale.updateMany({
        where: { id, tenantId, version: locale.version },
        data: { status: row.status, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Locale ${id} was modified concurrently (expected version ${locale.version})`,
        );
      }
    }

    await this.deps.outbox.write(
      locale.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Locale | null> {
    const run = (client: TransactionClient) => client.locale.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : LocaleMapper.toDomain(row);
  }

  async findByCode(code: string, tenantId: string, tx?: unknown): Promise<Locale | null> {
    const run = (client: TransactionClient) =>
      client.locale.findFirst({ where: { code, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : LocaleMapper.toDomain(row);
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Locale>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.locale.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return buildPaginatedPage(
      rows.map((row) => LocaleMapper.toDomain(row)),
      limit,
      (l) => l.id.toString(),
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaLocaleRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}

export class PrismaTranslationSetRepository implements TranslationSetRepository {
  private readonly deps: PrismaLocalizationRepositoriesDeps;

  constructor(deps: PrismaLocalizationRepositoriesDeps) {
    this.deps = deps;
  }

  async save(set: TranslationSet, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const id = set.id.toString();
    const row = TranslationSetMapper.toRow(set, tenantId);

    if (set.version === 0) {
      await client.translationSet.create({
        data: { ...row, translations: row.translations },
      });
    } else {
      const updated = await client.translationSet.updateMany({
        where: { id, tenantId, version: set.version },
        data: {
          translations: row.translations,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Translation set ${id} was modified concurrently (expected version ${set.version})`,
        );
      }
    }

    await this.deps.outbox.write(
      set.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<TranslationSet | null> {
    const run = (client: TransactionClient) =>
      client.translationSet.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : TranslationSetMapper.toDomain(this.toMapperRow(row));
  }

  async findByLocaleAndNamespace(
    localeRef: string,
    namespace: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<TranslationSet | null> {
    const run = (client: TransactionClient) =>
      client.translationSet.findFirst({ where: { localeRef, namespace, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : TranslationSetMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<TranslationSet>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.translationSet.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return buildPaginatedPage(
      rows.map((row) => TranslationSetMapper.toDomain(this.toMapperRow(row))),
      limit,
      (s) => s.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly localeRef: string;
    readonly namespace: string;
    readonly translations: unknown;
    readonly version: number;
  }): TranslationSetRow {
    return { ...row, translations: row.translations as TranslationSetRow["translations"] };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaTranslationSetRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
