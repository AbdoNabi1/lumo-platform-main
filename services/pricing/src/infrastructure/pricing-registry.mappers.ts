import { UniqueEntityId } from "@platform/domain";
import { PricingRule, type PricingRuleType } from "../domain/pricing-rule";
import { TaxClass } from "../domain/tax-class";

export interface TaxClassRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly deletedAt: Date | null;
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link TaxClass}. Mapping only — no I/O. */
export class TaxClassMapper {
  static toDomain(row: TaxClassRow): TaxClass {
    return TaxClass.reconstitute(
      UniqueEntityId.from(row.id),
      row.code,
      row.name,
      row.deletedAt !== null,
      row.version,
    );
  }

  static toRow(taxClass: TaxClass, tenantId: string) {
    return {
      id: taxClass.id.toString(),
      tenantId,
      code: taxClass.code,
      name: taxClass.name,
      deletedAt: taxClass.deleted ? new Date() : null,
      version: 1,
    };
  }
}

export interface PricingRuleRow {
  readonly id: string;
  readonly type: string;
  // WP-11 (F-07): `value` is `Decimal` in the schema now (was `Float`) — Prisma returns a
  // `Prisma.Decimal` instance for it at runtime, not a plain `number`. `unknown` here (rather
  // than a convenience-lie `number`) forces `toDomain` below to convert explicitly.
  readonly value: unknown;
  readonly priority: number;
  readonly active: boolean;
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link PricingRule}. Mapping only — no I/O. */
export class PricingRuleMapper {
  static toDomain(row: PricingRuleRow): PricingRule {
    return PricingRule.reconstitute(
      UniqueEntityId.from(row.id),
      row.type as PricingRuleType,
      // `Number(x)` on a `Prisma.Decimal` calls its `valueOf()`/`toString()` (decimal.js),
      // which is the exact decimal string — a correct, one-time, non-accumulating conversion.
      // `PricingRule.value` is read-only after creation (no repeated-increment risk), so unlike
      // `UsageCounter`/`Credit` this domain class does not need its own `Decimal` accumulator.
      Number(row.value),
      row.priority,
      row.active,
      row.version,
    );
  }

  static toRow(rule: PricingRule, tenantId: string) {
    return {
      id: rule.id.toString(),
      tenantId,
      type: rule.type,
      value: rule.value,
      priority: rule.priority,
      active: rule.active,
      version: 1,
    };
  }
}
