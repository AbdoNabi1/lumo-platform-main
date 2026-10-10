import type { TransactionClient } from "@platform/db";
import { UnexpectedError } from "@platform/utils";
import type { OrderNumberAllocator } from "../application/ports";
import { FIRST_ORDER_NUMBER } from "../domain/value-objects/order-number";

/**
 * Production `OrderNumberAllocator` on `orders.order_number_counters` (one row per shop). A single
 * atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` both creates a new shop's counter at 1001 and
 * bumps an existing one, so two concurrent orders can never read the same number: the second waits
 * on the counter row's lock until the first order commits or rolls back.
 *
 * It REQUIRES the order's own transaction client (ADR-0003): the increment then commits or rolls
 * back with the order, so a failed order creation never burns a number. The tenant is bound in the
 * statement itself — a raw query has no Prisma `where` for the tenant guard to read.
 */
export class PrismaOrderNumberAllocator implements OrderNumberAllocator {
  async next(tenantId: string, tx?: unknown): Promise<string> {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaOrderNumberAllocator.next requires the unit of work's transaction client (ADR-0003).",
      );
    }
    const client = tx as TransactionClient;
    const rows = await client.$queryRaw<Array<{ last_number: number }>>`
      INSERT INTO "orders"."order_number_counters" ("tenant_id", "last_number")
      VALUES (${tenantId}, ${FIRST_ORDER_NUMBER})
      ON CONFLICT ("tenant_id") DO UPDATE
        SET "last_number" = "order_number_counters"."last_number" + 1
      RETURNING "last_number"`;
    const row = rows[0];
    if (row === undefined) {
      throw new UnexpectedError("Could not allocate an order number: the counter returned no row");
    }
    return String(row.last_number);
  }
}
