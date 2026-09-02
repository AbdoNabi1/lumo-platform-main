import type { Database, TransactionClient } from "@platform/db";
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
  readonly tenantId: string;
}

export class PrismaLocaleRepository implements LocaleRepository {
  private readonly deps: PrismaLocalizationRepositoriesDeps;

  constructor(deps: PrismaLocalizationRepositoriesDeps) {
    this.deps = deps;
  }

  async save(locale: Locale, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
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

    await this.deps.outbox.write(locale.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Locale | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.locale.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : LocaleMapper.toDomain(row);
  }

  async findByCode(code: string, tx?: unknown): Promise<Locale | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.locale.findFirst({ where: { code, tenantId: this.deps.tenantId } });
    return row === null ? null : LocaleMapper.toDomain(row);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Locale>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.locale.findMany({
      where: { tenantId: this.deps.tenantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(rows.map((row) => LocaleMapper.toDomain(row)), limit, (l) =>
      l.id.toString(),
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

  async save(set: TranslationSet, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
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

    await this.deps.outbox.write(set.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<TranslationSet | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.translationSet.findFirst({
      where: { id, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return TranslationSetMapper.toDomain(this.toMapperRow(row));
  }

  async findByLocaleAndNamespace(
    localeRef: string,
    namespace: string,
    tx?: unknown,
  ): Promise<TranslationSet | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.translationSet.findFirst({
      where: { localeRef, namespace, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return TranslationSetMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<TranslationSet>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.translationSet.findMany({
      where: { tenantId: this.deps.tenantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
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
