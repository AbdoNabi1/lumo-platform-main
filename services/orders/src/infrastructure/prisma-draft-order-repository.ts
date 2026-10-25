import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import { ConcurrencyError } from "@platform/utils";
import { clampDraftPageSize, type DraftOrder } from "../domain/draft-order";
import type {
  DraftOrderPage,
  DraftOrderQuery,
  DraftOrderRepository,
} from "../domain/draft-order-repository";
import { contentColumns, draftFromRow } from "./draft-order-rows";
import { uuidsOf } from "./order-list-where";
import { escapeLike } from "./prisma-order-annotation-repository";

export interface PrismaDraftOrderRepositoryDeps {
  readonly prisma: Database;
}

const LIVE = ["open", "invoice_sent"];
const EMPTY: DraftOrderPage = { items: [], pageInfo: { hasNextPage: false, endCursor: null } };
const isUuid = (id: string): boolean => uuidsOf([id]).length === 1;

function writeClient(tx: unknown, method: string): TransactionClient {
  if (tx === undefined || tx === null) {
    throw new Error(
      `PrismaDraftOrderRepository.${method} requires the unit of work's transaction client (ADR-0003).`,
    );
  }
  return tx as TransactionClient;
}

/**
 * `orders.draft_orders` (order operations Part 4). Every Prisma `where` names `tenantId` (RLS is inert
 * on the application's connection — ADR-0014 point 6); the one raw read binds `tenant_id` in the
 * statement itself. Ruling 2: content saves are versioned; status, checkout and deletion are guarded
 * `updateMany`s that never bump `version`.
 */
export class PrismaDraftOrderRepository implements DraftOrderRepository {
  private readonly deps: PrismaDraftOrderRepositoryDeps;

  constructor(deps: PrismaDraftOrderRepositoryDeps) {
    this.deps = deps;
  }

  async save(draft: DraftOrder, tenantId: string, tx?: unknown): Promise<void> {
    const client = writeClient(tx, "save");
    const s = draft.snapshot();
    const content = contentColumns(draft);
    if (draft.isNew) {
      await client.draftOrder.create({
        data: {
          id: s.id,
          tenantId,
          draftNumber: s.draftNumber,
          status: s.status,
          currency: s.currency,
          ...content,
          checkoutRef: null,
          checkoutVersion: null,
          orderRef: null,
          invoiceSentAt: null,
          completedAt: null,
          deletedAt: null,
          createdBy: s.createdBy,
          version: 0,
          createdAt: s.createdAt,
        },
      });
      return;
    }
    const { count } = await client.draftOrder.updateMany({
      where: { id: s.id, tenantId, version: s.version, deletedAt: null, status: { in: LIVE } },
      data: { ...content, version: { increment: 1 } },
    });
    if (count === 0) {
      throw new ConcurrencyError(
        "VERSION_CONFLICT: this draft order was changed or closed meanwhile",
      );
    }
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<DraftOrder | null> {
    if (!isUuid(id)) return null;
    const row = await this.read(tenantId, tx, (client) =>
      client.draftOrder.findFirst({ where: { tenantId, id } }),
    );
    return row === null ? null : draftFromRow(row);
  }

  async list(query: DraftOrderQuery, tenantId: string): Promise<DraftOrderPage> {
    if (query.after !== undefined && !isUuid(query.after)) return EMPTY;
    const first = clampDraftPageSize(query.first);
    const after = query.after ?? null;
    const status = query.status ?? null;
    const pattern = query.search === undefined ? null : `%${escapeLike(query.search)}%`;
    return runReadScoped(this.deps.prisma, tenantId, async (client) => {
      const page = await client.$queryRaw<{ id: string }[]>`
        SELECT "id"::text AS "id"
        FROM "orders"."draft_orders"
        WHERE "tenant_id" = ${tenantId}
          AND "deleted_at" IS NULL
          AND (${status}::text IS NULL OR "status" = ${status}::text)
          AND (${after}::uuid IS NULL OR "id" < ${after}::uuid)
          AND (${pattern}::text IS NULL
            OR "draft_number" ILIKE ${pattern} ESCAPE '\\'
            OR "contact_email" ILIKE ${pattern} ESCAPE '\\'
            OR "contact_phone" ILIKE ${pattern} ESCAPE '\\'
            OR "shipping_address"->>'name' ILIKE ${pattern} ESCAPE '\\'
            OR "shipping_address"->>'phone' ILIKE ${pattern} ESCAPE '\\')
        ORDER BY "id" DESC
        LIMIT ${first + 1}`;
      const ids = page.slice(0, first).map((row) => row.id);
      if (ids.length === 0) return EMPTY;
      const rows = await client.draftOrder.findMany({ where: { tenantId, id: { in: ids } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const items = ids.flatMap((id) => {
        const row = byId.get(id);
        return row === undefined ? [] : [draftFromRow(row)];
      });
      return {
        items,
        pageInfo: { hasNextPage: page.length > first, endCursor: items.at(-1)?.id ?? null },
      };
    });
  }

  async markInvoiceSent(id: string, at: Date, tenantId: string, tx?: unknown): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { count } = await writeClient(tx, "markInvoiceSent").draftOrder.updateMany({
      where: { id, tenantId, deletedAt: null, status: { in: LIVE } },
      data: { status: "invoice_sent", invoiceSentAt: at },
    });
    return count > 0;
  }

  async markCompleted(
    id: string,
    completion: { readonly orderRef: string; readonly at: Date },
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { count } = await writeClient(tx, "markCompleted").draftOrder.updateMany({
      where: { id, tenantId, status: { in: LIVE } },
      data: {
        status: "completed",
        orderRef: completion.orderRef,
        completedAt: completion.at,
        deletedAt: null,
      },
    });
    return count > 0;
  }

  async softDelete(id: string, at: Date, tenantId: string, tx?: unknown): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { count } = await writeClient(tx, "softDelete").draftOrder.updateMany({
      where: { id, tenantId, deletedAt: null, status: { in: LIVE } },
      data: { deletedAt: at },
    });
    return count > 0;
  }

  async setCheckout(
    id: string,
    next: { readonly checkoutRef: string; readonly checkoutVersion: number },
    expectedCheckoutRef: string | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { count } = await writeClient(tx, "setCheckout").draftOrder.updateMany({
      where: {
        id,
        tenantId,
        deletedAt: null,
        status: { in: LIVE },
        checkoutRef: expectedCheckoutRef,
      },
      data: { checkoutRef: next.checkoutRef, checkoutVersion: next.checkoutVersion },
    });
    return count > 0;
  }

  private read<T>(
    tenantId: string,
    tx: unknown,
    run: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return tx !== undefined && tx !== null
      ? run(tx as TransactionClient)
      : runReadScoped(this.deps.prisma, tenantId, run);
  }
}
