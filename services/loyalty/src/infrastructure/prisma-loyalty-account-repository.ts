import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
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
  /** The tier ladder — composition-root config, not persisted per-row. */
  readonly tiers: readonly RewardTier[];
}

/** Production `LoyaltyAccountRepository` on the `loyalty` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaLoyaltyAccountRepository implements LoyaltyAccountRepository {
  private readonly deps: PrismaLoyaltyAccountRepositoryDeps;

  constructor(deps: PrismaLoyaltyAccountRepositoryDeps) {
    this.deps = deps;
  }

  async save(account: LoyaltyAccount, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
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

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<LoyaltyAccount | null> {
    const run = (client: TransactionClient) =>
      client.loyaltyAccount.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null
      ? null
      : LoyaltyAccountMapper.toDomain(this.toMapperRow(row), this.deps.tiers);
  }

  async findByCustomerRef(
    customerRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<LoyaltyAccount | null> {
    const run = (client: TransactionClient) =>
      client.loyaltyAccount.findFirst({ where: { customerRef, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null
      ? null
      : LoyaltyAccountMapper.toDomain(this.toMapperRow(row), this.deps.tiers);
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<LoyaltyAccount>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.loyaltyAccount.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
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
