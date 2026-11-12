import type { TransactionClient } from "@platform/db";
import { UnexpectedError } from "@platform/utils";
import type { DraftNumberAllocator } from "../domain/draft-order-repository";
import { FIRST_ORDER_NUMBER } from "../domain/value-objects/order-number";

/**
 * Draft numbers on the shop's existing counter row (spec §4.2 decision): one atomic upsert in the
 * draft's own transaction. A new shop's row is inserted with `last_number = 1000`, so its first ORDER
 * is still #1001. The tenant is bound in the statement itself (raw SQL has no Prisma `where`).
 */
export class PrismaDraftNumberAllocator implements DraftNumberAllocator {
  async next(tenantId: string, tx?: unknown): Promise<string> {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaDraftNumberAllocator.next requires the unit of work's transaction client (ADR-0003).",
      );
    }
    const client = tx as TransactionClient;
    const rows = await client.$queryRaw<Array<{ last_draft_number: number }>>`
      INSERT INTO "orders"."order_number_counters" ("tenant_id", "last_number", "last_draft_number")
      VALUES (${tenantId}, ${FIRST_ORDER_NUMBER - 1}, 1)
      ON CONFLICT ("tenant_id") DO UPDATE
        SET "last_draft_number" = "order_number_counters"."last_draft_number" + 1
      RETURNING "last_draft_number"`;
    const row = rows[0];
    if (row === undefined) {
      throw new UnexpectedError("Could not allocate a draft number: the counter returned no row");
    }
    return `D${row.last_draft_number}`;
  }
}
