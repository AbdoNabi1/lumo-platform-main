import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Prisma } from "@prisma/client";
import type { ComponentDefinition } from "../domain/component-definition";
import type { ComponentDefinitionRepository } from "../domain/repositories";
import { ComponentDefinitionMapper, type ComponentDefinitionRow } from "./mappers";

export interface PrismaComponentsRepositoriesDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  readonly tenantId: string;
}

/** Production `ComponentDefinitionRepository` on the `components` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaComponentDefinitionRepository implements ComponentDefinitionRepository {
  private readonly deps: PrismaComponentsRepositoriesDeps;

  constructor(deps: PrismaComponentsRepositoriesDeps) {
    this.deps = deps;
  }

  async save(definition: ComponentDefinition, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const id = definition.id.toString();
    const row = ComponentDefinitionMapper.toRow(definition, tenantId);

    if (definition.version === 0) {
      await client.componentDefinition.create({
        data: {
          ...row,
          // `ComponentProperty[]` has no index signature, so it has no structural overlap with
          // `InputJsonValue`'s `InputJsonObject` (comparability fails, not just assignability).
          properties: row.properties as unknown as Prisma.InputJsonValue,
          defaults: row.defaults as Prisma.InputJsonValue,
          slots: row.slots,
          events: row.events,
        },
      });
    } else {
      const updated = await client.componentDefinition.updateMany({
        where: { id, tenantId, version: definition.version },
        data: { status: row.status, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Component definition ${id} was modified concurrently (expected version ${definition.version})`,
        );
      }
    }

    await this.deps.outbox.write(definition.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<ComponentDefinition | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.componentDefinition.findFirst({
      where: { id, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return ComponentDefinitionMapper.toDomain(this.toMapperRow(row));
  }

  async findByKey(key: string, tx?: unknown): Promise<ComponentDefinition | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.componentDefinition.findFirst({
      where: { key, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return ComponentDefinitionMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<ComponentDefinition>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.componentDefinition.findMany({
      where: { tenantId: this.deps.tenantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => ComponentDefinitionMapper.toDomain(this.toMapperRow(row))),
      limit,
      (d) => d.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly key: string;
    readonly name: string;
    readonly properties: unknown;
    readonly defaults: unknown;
    readonly slots: unknown;
    readonly events: unknown;
    readonly responsive: boolean;
    readonly permission: string | null;
    readonly featureFlagKey: string | null;
    readonly status: string;
    readonly version: number;
  }): ComponentDefinitionRow {
    return {
      ...row,
      properties: row.properties as ComponentDefinitionRow["properties"],
      defaults: row.defaults as ComponentDefinitionRow["defaults"],
      slots: row.slots as ComponentDefinitionRow["slots"],
      events: row.events as ComponentDefinitionRow["events"],
    };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaComponentDefinitionRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
