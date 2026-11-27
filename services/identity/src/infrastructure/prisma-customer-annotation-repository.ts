import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import {
  sortTags,
  type CustomerAnnotationRepository,
  type CustomerAnnotations,
  type CustomerTag,
} from "../domain/customer-annotations";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class PrismaCustomerAnnotationRepository implements CustomerAnnotationRepository {
  constructor(private readonly deps: { prisma: Database }) {}

  async annotationsOf(
    customerIds: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, CustomerAnnotations>> {
    // Each ORIGINAL valid spelling is kept so the result is keyed exactly as requested.
    const requested = [...new Set(customerIds)].filter((id) => UUID.test(id));
    if (requested.length === 0) return new Map();
    const ids = [...new Set(requested.map((id) => id.toLowerCase()))];
    const run = async (client: TransactionClient) => {
      const customers = await client.customer.findMany({
        where: { tenantId, deletedAt: null, id: { in: ids } },
        select: { id: true, note: true },
      });
      const foundIds = customers.map((c) => c.id);
      const tags =
        foundIds.length === 0
          ? []
          : await client.customerTag.findMany({
              where: { tenantId, customerId: { in: foundIds } },
            });
      const byId = new Map<string, CustomerAnnotations>();
      for (const customer of customers) {
        const key = customer.id.toLowerCase();
        byId.set(key, {
          note: customer.note,
          tags: sortTags(
            tags.filter((tag) => tag.customerId.toLowerCase() === key).map((tag) => tag.tag),
          ),
        });
      }
      const result = new Map<string, CustomerAnnotations>();
      for (const id of requested) {
        const found = byId.get(id.toLowerCase());
        if (found !== undefined) result.set(id, found);
      }
      return result;
    };
    return tx != null
      ? run(tx as TransactionClient)
      : runReadScoped(this.deps.prisma, tenantId, run);
  }
  async setNote(
    customerId: string,
    note: string | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean> {
    const client = this.requireTx(tx, "setNote");
    if (!UUID.test(customerId)) return false;
    const result = await client.customer.updateMany({
      where: { id: customerId, tenantId, deletedAt: null },
      data: { note },
    });
    return result.count > 0;
  }
  async replaceTags(
    customerId: string,
    tags: readonly CustomerTag[],
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly string[] | null> {
    const client = this.requireTx(tx, "replaceTags");
    if (!UUID.test(customerId)) return null;
    const locked = await client.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "identity"."customers" WHERE "id" = ${customerId}::uuid AND "tenant_id" = ${tenantId} AND "deleted_at" IS NULL FOR UPDATE`;
    if (locked.length === 0) return null;
    await client.customerTag.deleteMany({ where: { tenantId, customerId } });
    if (tags.length > 0)
      await client.customerTag.createMany({
        data: tags.map(({ tag, tagKey }) => ({ tenantId, customerId, tag, tagKey })),
      });
    const rows = await client.customerTag.findMany({ where: { tenantId, customerId } });
    return sortTags(rows.map((row) => row.tag));
  }
  private requireTx(tx: unknown, method: string): TransactionClient {
    if (tx == null)
      throw new Error(
        `PrismaCustomerAnnotationRepository.${method} requires the unit of work's transaction client (ADR-0003).`,
      );
    return tx as TransactionClient;
  }
}
