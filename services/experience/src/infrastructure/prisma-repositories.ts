import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Prisma } from "@prisma/client";
import type { Experience } from "../domain/experience";
import type { ExperienceRepository } from "../domain/repositories";
import { ExperienceMapper, type ExperienceRow } from "./mappers";

export interface PrismaExperienceRepositoriesDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

/** Production `ExperienceRepository` on the `experience` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaExperienceRepository implements ExperienceRepository {
  private readonly deps: PrismaExperienceRepositoriesDeps;

  constructor(deps: PrismaExperienceRepositoriesDeps) {
    this.deps = deps;
  }

  async save(experience: Experience, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const id = experience.id.toString();
    const row = ExperienceMapper.toRow(experience, tenantId);

    if (experience.version === 0) {
      await client.experience.create({
        data: {
          ...row,
          // `Section[]`/version-history entries have no index signature, so they have no structural
          // overlap with `InputJsonValue`'s `InputJsonObject` (comparability fails).
          sections: row.sections as unknown as Prisma.InputJsonValue,
          versions: row.versions as unknown as Prisma.InputJsonValue,
        },
      });
    } else {
      const updated = await client.experience.updateMany({
        where: { id, tenantId, version: experience.version },
        data: {
          // `Section[]`/version-history entries have no index signature, so they have no structural
          // overlap with `InputJsonValue`'s `InputJsonObject` (comparability fails).
          sections: row.sections as unknown as Prisma.InputJsonValue,
          status: row.status,
          versions: row.versions as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Experience ${id} was modified concurrently (expected version ${experience.version})`,
        );
      }
    }

    await this.deps.outbox.write(experience.pullDomainEvents(), this.deps.context, client);
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Experience | null> {
    const run = (client: TransactionClient) =>
      client.experience.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : ExperienceMapper.toDomain(this.toMapperRow(row));
  }

  async findByName(name: string, tenantId: string, tx?: unknown): Promise<Experience | null> {
    const run = (client: TransactionClient) =>
      client.experience.findFirst({ where: { name, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : ExperienceMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Experience>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.experience.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return buildPaginatedPage(
      rows.map((row) => ExperienceMapper.toDomain(this.toMapperRow(row))),
      limit,
      (e) => e.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly name: string;
    readonly experienceType: string;
    readonly sections: unknown;
    readonly status: string;
    readonly versions: unknown;
    readonly version: number;
  }): ExperienceRow {
    return {
      ...row,
      sections: row.sections as ExperienceRow["sections"],
      versions: row.versions as ExperienceRow["versions"],
    };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaExperienceRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
