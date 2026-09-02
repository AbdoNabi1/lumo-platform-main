import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import type { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { CheckoutSessionMapper } from "./checkout-session.mapper";

export interface PrismaCheckoutSessionRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/**
 * Production `CheckoutSessionRepository` on the `checkout` schema. Optimistic locking +
 * same-transaction outbox per ADR-0003. Snapshot columns (items/addresses/selections/totals) are
 * JSONB — `{}` means unset, never `null` (Sprint 4.6's own mapper convention).
 */
export class PrismaCheckoutSessionRepository implements CheckoutSessionRepository {
  private readonly deps: PrismaCheckoutSessionRepositoryDeps;

  constructor(deps: PrismaCheckoutSessionRepositoryDeps) {
    this.deps = deps;
  }

  async save(session: CheckoutSession, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const row = CheckoutSessionMapper.toRow(session, tenantId);

    if (session.version === 0) {
      await client.checkoutSession.create({ data: row });
    } else {
      const updated = await client.checkoutSession.updateMany({
        where: { id: session.id.toString(), tenantId, version: session.version },
        data: {
          customerRef: row.customerRef,
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
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `CheckoutSession ${session.id.toString()} was modified concurrently (expected version ${session.version})`,
        );
      }
    }

    await this.deps.outbox.write(session.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<CheckoutSession | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.checkoutSession.findFirst({
      where: { id, tenantId: this.deps.tenantId },
    });
    return row === null
      ? null
      : CheckoutSessionMapper.toDomain({
          ...row,
          // `CheckoutSessionRowItems` is an array of closed object shapes without an index
          // signature, so it has no structural overlap with Prisma's `JsonValue` union.
          items: row.items as unknown as CheckoutSessionRowItems,
          billingAddress: row.billingAddress as Record<string, never>,
          shippingAddress: row.shippingAddress as Record<string, never>,
          shippingSelection: row.shippingSelection as Record<string, never>,
          paymentSelection: row.paymentSelection as Record<string, never>,
          totals: row.totals as Record<string, never>,
        });
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

type CheckoutSessionRowItems = readonly {
  readonly productRef: string;
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
  readonly currency: string;
}[];
