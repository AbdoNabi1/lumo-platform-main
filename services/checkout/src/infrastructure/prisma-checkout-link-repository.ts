import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import { CheckoutLink, type CheckoutLinkPurpose } from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";
import { newestFirst } from "./in-memory-checkout-link-repository";
import { isUuid } from "./uuid";

export interface PrismaCheckoutLinkRepositoryDeps {
  readonly prisma: Database;
}

type LinkRow = NonNullable<Awaited<ReturnType<TransactionClient["checkoutLink"]["findFirst"]>>>;

function toDomain(row: LinkRow): CheckoutLink {
  return CheckoutLink.reconstitute({
    id: row.id,
    purpose: row.purpose as CheckoutLinkPurpose,
    tokenHash: row.tokenHash,
    checkoutSessionId: row.checkoutSessionId,
    draftOrderRef: row.draftOrderRef,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    claimCount: row.claimCount,
    lastClaimedAt: row.lastClaimedAt,
    resultCheckoutRef: row.resultCheckoutRef,
  });
}

/**
 * `checkout.checkout_links` (order operations Part 3). Every read and write names `tenantId` in its
 * `where` (RLS is inert on the application's connection — ADR-0014 point 6), so a token hash from
 * another shop is unknown here.
 */
export class PrismaCheckoutLinkRepository implements CheckoutLinkRepository {
  private readonly deps: PrismaCheckoutLinkRepositoryDeps;

  constructor(deps: PrismaCheckoutLinkRepositoryDeps) {
    this.deps = deps;
  }

  async save(link: CheckoutLink, tenantId: string, tx?: unknown): Promise<void> {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaCheckoutLinkRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    const client = tx as TransactionClient;
    const s = link.snapshot();
    if (link.isNew) {
      await client.checkoutLink.create({
        data: {
          id: s.id,
          tenantId,
          purpose: s.purpose,
          tokenHash: s.tokenHash,
          checkoutSessionId: s.checkoutSessionId,
          draftOrderRef: s.draftOrderRef,
          expiresAt: s.expiresAt,
          revokedAt: s.revokedAt,
          createdBy: s.createdBy,
          createdAt: s.createdAt,
          claimCount: s.claimCount,
          lastClaimedAt: s.lastClaimedAt,
          resultCheckoutRef: s.resultCheckoutRef,
        },
      });
      return;
    }
    await client.checkoutLink.updateMany({
      where: { id: s.id, tenantId },
      data: {
        revokedAt: s.revokedAt,
        claimCount: s.claimCount,
        lastClaimedAt: s.lastClaimedAt,
        resultCheckoutRef: s.resultCheckoutRef,
      },
    });
  }

  /**
   * One guarded `UPDATE … SET claim_count = claim_count + 1 WHERE … AND revoked_at IS NULL AND
   * expires_at > now`: Postgres row-locks the link, and a concurrent claim waits and re-checks the
   * guard on the updated row, so no increment is lost. The count is then read back in the same `tx`.
   */
  async recordClaim(
    id: string,
    tenantId: string,
    now: Date,
    resultCheckoutRef: string,
    tx?: unknown,
  ): Promise<number | null> {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaCheckoutLinkRepository.recordClaim requires the unit of work's transaction client (ADR-0003).",
      );
    }
    if (!isUuid(id)) return null;
    const client = tx as TransactionClient;
    const { count } = await client.checkoutLink.updateMany({
      where: { id, tenantId, revokedAt: null, expiresAt: { gt: now } },
      data: { claimCount: { increment: 1 }, lastClaimedAt: now, resultCheckoutRef },
    });
    if (count === 0) return null;
    const row = await client.checkoutLink.findFirst({ where: { tenantId, id } });
    return row === null ? null : row.claimCount;
  }

  async findByTokenHash(
    tokenHash: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<CheckoutLink | null> {
    const row = await this.read(tenantId, tx, (client) =>
      client.checkoutLink.findFirst({ where: { tenantId, tokenHash } }),
    );
    return row === null ? null : toDomain(row);
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<CheckoutLink | null> {
    if (!isUuid(id)) return null;
    const row = await this.read(tenantId, tx, (client) =>
      client.checkoutLink.findFirst({ where: { tenantId, id } }),
    );
    return row === null ? null : toDomain(row);
  }

  async listForSessions(
    checkoutSessionIds: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly CheckoutLink[]> {
    const ids = [...new Set(checkoutSessionIds)].filter(isUuid);
    if (ids.length === 0) return [];
    const rows = await this.read(tenantId, tx, (client) =>
      client.checkoutLink.findMany({ where: { tenantId, checkoutSessionId: { in: ids } } }),
    );
    return newestFirst(rows.map(toDomain));
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
