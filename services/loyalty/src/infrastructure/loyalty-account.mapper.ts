import { UniqueEntityId } from "@platform/domain";
import { LoyaltyAccount } from "../domain/loyalty-account";
import { LoyaltyTransaction, type LoyaltyTransactionKind } from "../domain/loyalty-transaction";
import { AccountStatus, type AccountStatusValue } from "../domain/value-objects/account-status";
import { type RewardTier } from "../domain/value-objects/reward-tier";

export interface LoyaltyTransactionJson {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly kind: LoyaltyTransactionKind;
  readonly pointsDelta: number;
  readonly ref?: string;
  readonly occurredAt: string;
}

export interface LoyaltyAccountRow {
  readonly id: string;
  readonly customerRef: string;
  readonly tierName: string;
  readonly balance: number;
  readonly status: string;
  readonly transactions: readonly LoyaltyTransactionJson[];
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link LoyaltyAccount}. Mapping only — no I/O. The tier ladder itself is composition-root config, not persisted per-row. */
export class LoyaltyAccountMapper {
  static toDomain(row: LoyaltyAccountRow, tiers: readonly RewardTier[]): LoyaltyAccount {
    return LoyaltyAccount.reconstitute(
      UniqueEntityId.from(row.id),
      row.customerRef,
      tiers,
      row.tierName,
      row.balance,
      AccountStatus.from(row.status as AccountStatusValue),
      row.version,
      row.transactions.map((t) =>
        LoyaltyTransaction.create(
          UniqueEntityId.from(t.id),
          t.idempotencyKey,
          t.kind,
          t.pointsDelta,
          new Date(t.occurredAt),
          t.ref,
        ),
      ),
    );
  }

  static toRow(account: LoyaltyAccount, tenantId: string) {
    return {
      id: account.id.toString(),
      tenantId,
      customerRef: account.customerRef,
      tierName: account.tierName,
      balance: account.points.balance,
      status: account.status.value,
      transactions: account.transactions.map((t) => ({
        id: t.id.toString(),
        idempotencyKey: t.idempotencyKey,
        kind: t.kind,
        pointsDelta: t.pointsDelta,
        ref: t.ref,
        occurredAt: t.occurredAt.toISOString(),
      })),
      version: 1,
    };
  }
}
