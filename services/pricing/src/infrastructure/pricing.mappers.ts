import { Money, ProductRef, UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import { Price, type PriceStatus } from "../domain/price";
import { PriceList, type PriceListStatus } from "../domain/price-list";
import { Currency } from "../domain/value-objects/currency";

export interface PriceRow {
  readonly id: string;
  readonly productRef: string;
  readonly priceListRef: string | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly compareAtMinor: number | null;
  readonly costMinor: number | null;
  readonly effectiveFrom: Date | null;
  readonly effectiveTo: Date | null;
  readonly taxClassRef: string | null;
  readonly status: string;
  readonly deletedAt: Date | null;
  readonly version: number;
}
export interface PriceListRow {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly status: string;
  readonly version: number;
}

function must<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) {
    throw new UnexpectedError(`Corrupt pricing row: invalid ${what} (${result.error.message})`);
  }
  return result.value;
}

/** Persistence ↔ aggregate mapping for {@link Price}. Mapping only — no I/O. */
export class PriceMapper {
  static toDomain(row: PriceRow): Price {
    if (row.priceListRef === null) {
      throw new UnexpectedError(`Corrupt pricing row: price ${row.id} has no price list`);
    }
    const amount = must(Money.create(row.amountMinor, row.currency), "amount");
    return Price.reconstitute(
      UniqueEntityId.from(row.id),
      row.priceListRef,
      must(ProductRef.create(row.productRef), "product ref"),
      amount,
      row.version,
      {
        compareAt:
          row.compareAtMinor === null
            ? undefined
            : must(Money.create(row.compareAtMinor, row.currency), "compare-at amount"),
        cost:
          row.costMinor === null
            ? undefined
            : must(Money.create(row.costMinor, row.currency), "cost amount"),
        effectiveFrom: row.effectiveFrom ?? undefined,
        effectiveTo: row.effectiveTo ?? undefined,
        taxClassRef: row.taxClassRef ?? undefined,
        status: row.status as PriceStatus,
        deleted: row.deletedAt !== null,
      },
    );
  }

  static toRow(price: Price, tenantId: string) {
    return {
      id: price.id.toString(),
      tenantId,
      productRef: price.product.value,
      priceListRef: price.priceListId,
      amountMinor: price.amount.amountMinor,
      currency: price.amount.currency,
      compareAtMinor: price.compareAt?.amountMinor ?? null,
      costMinor: price.cost?.amountMinor ?? null,
      effectiveFrom: price.effectiveFrom ?? null,
      effectiveTo: price.effectiveTo ?? null,
      taxClassRef: price.taxClassRef ?? null,
      status: price.status,
      deletedAt: price.deleted ? new Date() : null,
      version: 1,
    };
  }
}

/** Persistence ↔ aggregate mapping for {@link PriceList}. Mapping only — no I/O. */
export class PriceListMapper {
  static toDomain(row: PriceListRow): PriceList {
    return PriceList.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      must(Currency.create(row.currency), "currency"),
      row.status as PriceListStatus,
      row.version,
    );
  }

  static toRow(list: PriceList, tenantId: string) {
    return {
      id: list.id.toString(),
      tenantId,
      name: list.name,
      currency: list.currency.code,
      status: list.status,
      version: 1,
    };
  }
}
