import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import {
  clampAbandonedPageSize,
  normalizeAbandonedSearch,
  type AbandonedCheckoutPage,
  type AbandonedCheckoutQueries,
  type AbandonedCheckoutQuery,
  type CheckoutSessionRecord,
} from "../domain/abandoned-checkouts";
import type { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { CheckoutSessionMapper } from "./checkout-session.mapper";
import { isUuid } from "./uuid";

export interface PrismaCheckoutSessionRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

type SessionRow = NonNullable<
  Awaited<ReturnType<TransactionClient["checkoutSession"]["findFirst"]>>
>;

type CheckoutSessionRowItems = readonly {
  readonly productRef: string;
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
  readonly currency: string;
}[];

function toDomain(row: SessionRow): CheckoutSession {
  return CheckoutSessionMapper.toDomain({
    ...row,
    // `CheckoutSessionRowItems` is an array of closed object shapes without an index
    // signature, so it has no structural overlap with Prisma's `JsonValue` union.
    items: row.items as unknown as CheckoutSessionRowItems,
    billingAddress: row.billingAddress as Record<string, never>,
    shippingAddress: row.shippingAddress as Record<string, never>,
    shippingSelection: row.shippingSelection as Record<string, never>,
    paymentSelection: row.paymentSelection as Record<string, never>,
    totals: row.totals as Record<string, never>,
    discounts: row.discounts as Record<string, never>,
  });
}

function toRecord(row: SessionRow): CheckoutSessionRecord {
  return { session: toDomain(row), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** `LIKE` treats `%`, `_` and `\` specially; a typed search must match literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

const EMPTY_PAGE: AbandonedCheckoutPage = {
  items: [],
  pageInfo: { hasNextPage: false, endCursor: null },
};

/**
 * Production `CheckoutSessionRepository` on the `checkout` schema. Optimistic locking +
 * same-transaction outbox per ADR-0003. Snapshot columns (items/addresses/selections/totals) are
 * JSONB — `{}` means unset, never `null` (Sprint 4.6's own mapper convention).
 */
export class PrismaCheckoutSessionRepository
  implements CheckoutSessionRepository, AbandonedCheckoutQueries
{
  private readonly deps: PrismaCheckoutSessionRepositoryDeps;

  constructor(deps: PrismaCheckoutSessionRepositoryDeps) {
    this.deps = deps;
  }

  async save(session: CheckoutSession, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const row = CheckoutSessionMapper.toRow(session, tenantId);

    if (session.version === 0) {
      await client.checkoutSession.create({ data: row });
    } else {
      const updated = await client.checkoutSession.updateMany({
        where: { id: session.id.toString(), tenantId, version: session.version },
        data: {
          customerRef: row.customerRef,
          contactEmail: row.contactEmail,
          state: row.state,
          orderRef: row.orderRef,
          items: row.items,
          billingAddress: row.billingAddress,
          shippingAddress: row.shippingAddress,
          shippingSelection: row.shippingSelection,
          paymentSelection: row.paymentSelection,
          taxMinor: row.taxMinor,
          discountMinor: row.discountMinor,
          totals: row.totals,
          discounts: row.discounts,
          recoveredOrderRef: row.recoveredOrderRef,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `CheckoutSession ${session.id.toString()} was modified concurrently (expected version ${session.version})`,
        );
      }
    }

    await this.deps.outbox.write(
      session.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<CheckoutSession | null> {
    const row = await this.findRow(id, tenantId, tx);
    return row === null ? null : toDomain(row);
  }

  async findRecord(
    id: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<CheckoutSessionRecord | null> {
    if (!isUuid(id)) return null;
    const row = await this.findRow(id, tenantId, tx);
    return row === null ? null : toRecord(row);
  }

  /**
   * The abandoned definition (`isAbandonedCheckout`) in SQL: one tenant-filtered id page (raw SQL is
   * outside the Prisma where-guard, so `tenant_id` is filtered in the statement itself), then the rows.
   */
  async listAbandoned(
    query: AbandonedCheckoutQuery,
    tenantId: string,
  ): Promise<AbandonedCheckoutPage> {
    if (query.after !== undefined && !isUuid(query.after)) return EMPTY_PAGE;
    const after = query.after ?? null;
    const first = clampAbandonedPageSize(query.first);
    const search = normalizeAbandonedSearch(query.search);
    const pattern = search === undefined ? null : `%${escapeLike(search)}%`;
    const recovery = query.recovery ?? null;
    const olderThan = query.olderThan.toISOString();

    return runReadScoped(this.deps.prisma, tenantId, async (client) => {
      const page = await client.$queryRaw<{ id: string }[]>`
        SELECT "id"::text AS "id"
        FROM "checkout"."checkout_sessions"
        WHERE "tenant_id" = ${tenantId}
          AND (
            "recovered_order_ref" IS NOT NULL
            OR (
              "state" IN ('started', 'locked')
              AND "updated_at" < (${olderThan}::timestamptz AT TIME ZONE 'UTC')
              AND "items" <> '[]'::jsonb
              AND ("contact_email" IS NOT NULL OR "shipping_address"->>'phone' IS NOT NULL)
            )
          )
          AND (${recovery}::text IS NULL
            OR (${recovery}::text = 'recovered') = ("recovered_order_ref" IS NOT NULL))
          AND (${after}::uuid IS NULL OR "id" < ${after}::uuid)
          AND (${pattern}::text IS NULL
            OR "contact_email" ILIKE ${pattern} ESCAPE '\\'
            OR "shipping_address"->>'name' ILIKE ${pattern} ESCAPE '\\'
            OR "shipping_address"->>'phone' ILIKE ${pattern} ESCAPE '\\')
        ORDER BY "id" DESC
        LIMIT ${first + 1}`;
      const ids = page.slice(0, first).map((row) => row.id);
      if (ids.length === 0) return EMPTY_PAGE;
      const rows = await client.checkoutSession.findMany({ where: { tenantId, id: { in: ids } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const items = ids.flatMap((id) => {
        const row = byId.get(id);
        return row === undefined ? [] : [toRecord(row)];
      });
      return {
        items,
        pageInfo: {
          hasNextPage: page.length > first,
          endCursor: items.at(-1)?.session.id.toString() ?? null,
        },
      };
    });
  }

  private async findRow(id: string, tenantId: string, tx?: unknown): Promise<SessionRow | null> {
    const run = (client: TransactionClient) =>
      client.checkoutSession.findFirst({ where: { id, tenantId } });
    return tx !== undefined && tx !== null
      ? run(tx as TransactionClient)
      : runReadScoped(this.deps.prisma, tenantId, run);
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaCheckoutSessionRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
