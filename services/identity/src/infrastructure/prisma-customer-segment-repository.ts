import { runReadScoped, type Database, type Prisma, type TransactionClient } from "@platform/db";
import { UniqueEntityId } from "@platform/domain";
import { ConcurrencyError, ConflictError, UnexpectedError } from "@platform/utils";
import { CustomerSegment, parseSegmentConditions } from "../domain/customer-segment";
import type { CustomerSegmentRepository } from "../domain/customer-segment-repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = {
  id: string;
  name: string;
  conditions: unknown;
  version: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};
function hydrate(row: Row): CustomerSegment {
  const conditions = parseSegmentConditions(row.conditions);
  if (!conditions.ok) throw new UnexpectedError("Corrupt identity row: invalid segment conditions");
  return CustomerSegment.reconstitute(
    UniqueEntityId.from(row.id),
    row.name,
    conditions.value,
    row.version,
    row.createdBy,
    row.createdAt,
    row.updatedAt,
  );
}
export class PrismaCustomerSegmentRepository implements CustomerSegmentRepository {
  constructor(private readonly deps: { prisma: Database }) {}
  private required(tx: unknown, method: string): TransactionClient {
    if (tx == null)
      throw new Error(
        `PrismaCustomerSegmentRepository.${method} requires the unit of work's transaction client (ADR-0003).`,
      );
    return tx as TransactionClient;
  }
  private read<T>(
    tenantId: string,
    tx: unknown,
    fn: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return tx == null ? runReadScoped(this.deps.prisma, tenantId, fn) : fn(tx as TransactionClient);
  }
  async list(tenantId: string, tx?: unknown): Promise<readonly CustomerSegment[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.customerSegment.findMany({ where: { tenantId }, orderBy: { nameKey: "asc" } }),
    );
    return rows.map(hydrate);
  }
  async findById(id: string, tenantId: string, tx?: unknown): Promise<CustomerSegment | null> {
    if (!UUID.test(id)) return null;
    const row = await this.read(tenantId, tx, (c) =>
      c.customerSegment.findFirst({ where: { id, tenantId } }),
    );
    return row === null ? null : hydrate(row);
  }
  async count(tenantId: string, tx?: unknown): Promise<number> {
    return this.read(tenantId, tx, (c) => c.customerSegment.count({ where: { tenantId } }));
  }
  async save(segment: CustomerSegment, tenantId: string, tx?: unknown): Promise<number> {
    const client = this.required(tx, "save");
    const data = {
      name: segment.name,
      nameKey: segment.nameKey,
      conditions: segment.conditions as unknown as Prisma.InputJsonValue,
      updatedAt: segment.updatedAt,
    };
    try {
      if (segment.version === 0) {
        await client.customerSegment.create({
          data: {
            ...data,
            id: segment.id.toString(),
            tenantId,
            version: 1,
            createdBy: segment.createdBy,
            createdAt: segment.createdAt,
          },
        });
      } else {
        const result = await client.customerSegment.updateMany({
          where: { id: segment.id.toString(), tenantId, version: segment.version },
          data: { ...data, version: { increment: 1 } },
        });
        if (result.count === 0) throw new ConcurrencyError("Segment was modified concurrently");
      }
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
        throw new ConflictError("A segment with this name already exists", { cause: error });
      throw error;
    }
    return segment.version + 1;
  }
  async delete(
    id: string,
    expectedVersion: number,
    tenantId: string,
    tx?: unknown,
  ): Promise<"deleted" | "not_found" | "stale"> {
    const client = this.required(tx, "delete");
    if (!UUID.test(id)) return "not_found";
    const result = await client.customerSegment.deleteMany({
      where: { id, tenantId, version: expectedVersion },
    });
    if (result.count > 0) return "deleted";
    const row = await client.customerSegment.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    return row ? "stale" : "not_found";
  }
  async withTenantSegmentsLock<T>(
    tenantId: string,
    fn: () => Promise<T>,
    tx?: unknown,
  ): Promise<T> {
    const client = this.required(tx, "withTenantSegmentsLock");
    await client.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      "identity.customer_segments:" + tenantId,
    );
    return fn();
  }
}
