import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { LoyaltyAccount } from "../domain/loyalty-account";
import type { LoyaltyAccountRepository } from "../domain/loyalty-account-repository";
import type { RewardTier } from "../domain/value-objects/reward-tier";
import { LoyaltyAccountMapper, type LoyaltyAccountRow } from "./loyalty-account.mapper";

export interface PrismaLoyaltyAccountRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
  /** The tier ladder — composition-root config, not persisted per-row. */
  readonly tiers: readonly RewardTier[];
}

/** Production `LoyaltyAccountRepository` on the `loyalty` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaLoyaltyAccountRepository implements LoyaltyAccountRepository {
  private readonly deps: PrismaLoyaltyAccountRepositoryDeps;

  constructor(deps: PrismaLoyaltyAccountRepositoryDeps) {
    this.deps = deps;
  }

  async save(account: LoyaltyAccount, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const accountId = account.id.toString();
    const row = LoyaltyAccountMapper.toRow(account, tenantId);

    if (account.version === 0) {
      await client.loyaltyAccount.create({
        data: { ...row, transactions: row.transactions },
      });
    } else {
      const updated = await client.loyaltyAccount.updateMany({
        where: { id: accountId, tenantId, version: account.version },
        data: {
          tierName: row.tierName,
          balance: row.balance,
          status: row.status,
          transactions: row.transactions,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Loyalty account ${accountId} was modified concurrently (expected version ${account.version})`,
        );
      }
    }

    await this.deps.outbox.write(account.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<LoyaltyAccount | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.loyaltyAccount.findFirst({
      where: { id, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return LoyaltyAccountMapper.toDomain(this.toMapperRow(row), this.deps.tiers);
  }

  async findByCustomerRef(customerRef: string, tx?: unknown): Promise<LoyaltyAccount | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.loyaltyAccount.findFirst({
      where: { customerRef, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return LoyaltyAccountMapper.toDomain(this.toMapperRow(row), this.deps.tiers);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<LoyaltyAccount>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.loyaltyAccount.findMany({
      where: {
        tenantId: this.deps.tenantId,
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => LoyaltyAccountMapper.toDomain(this.toMapperRow(row), this.deps.tiers)),
      limit,
      (a) => a.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly customerRef: string;
    readonly tierName: string;
    readonly balance: number;
    readonly status: string;
    readonly transactions: unknown;
    readonly version: number;
  }): LoyaltyAccountRow {
    return { ...row, transactions: row.transactions as LoyaltyAccountRow["transactions"] };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaLoyaltyAccountRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
