import {
  AggregateRoot,
  BusinessRuleError,
  type Money,
  type ProductRef,
  type UniqueEntityId,
} from "@platform/domain";
import { PriceChanged } from "./events/price-changed.event";
import { PricePublished } from "./events/price-published.event";

export type PriceStatus = "draft" | "published";

export interface PriceChangeOptions {
  readonly compareAt?: Money;
  readonly cost?: Money;
}

interface PriceProps {
  readonly priceListId: string;
  readonly product: ProductRef;
  amount: Money;
  compareAt?: Money;
  cost?: Money;
  effectiveFrom?: Date;
  effectiveTo?: Date;
  taxClassRef?: string;
  status: PriceStatus;
  deleted: boolean;
}

/**
 * A product's price within a price list. Determination + publication only — never a checkout
 * discount/total (Sprint 4.4 §3). Emits `price.changed` when the amount changes and
 * `price.published` when a draft is published.
 */
export class Price extends AggregateRoot<PriceProps> {
  static create(
    id: UniqueEntityId,
    priceListId: string,
    product: ProductRef,
    amount: Money,
    options: PriceChangeOptions = {},
  ): Price {
    Price.assertBaseCurrency(amount, options);
    return new Price(
      {
        priceListId,
        product,
        amount,
        compareAt: options.compareAt,
        cost: options.cost,
        status: "draft",
        deleted: false,
      },
      id,
    );
  }

  /** Rebuilds a persisted price - no events, persisted `version` carried (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    priceListId: string,
    product: ProductRef,
    amount: Money,
    version: number,
    extra: {
      readonly compareAt?: Money;
      readonly cost?: Money;
      readonly effectiveFrom?: Date;
      readonly effectiveTo?: Date;
      readonly taxClassRef?: string;
      readonly status?: PriceStatus;
      readonly deleted?: boolean;
    } = {},
  ): Price {
    return new Price(
      {
        priceListId,
        product,
        amount,
        compareAt: extra.compareAt,
        cost: extra.cost,
        effectiveFrom: extra.effectiveFrom,
        effectiveTo: extra.effectiveTo,
        taxClassRef: extra.taxClassRef,
        status: extra.status ?? "draft",
        deleted: extra.deleted ?? false,
      },
      id,
      version,
    );
  }

  change(amount: Money, eventId: string, occurredAt: Date, options: PriceChangeOptions = {}): void {
    Price.assertBaseCurrency(amount, options);
    this.props.amount = amount;
    this.props.compareAt = options.compareAt;
    this.props.cost = options.cost;
    this.addDomainEvent(
      new PriceChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          priceListId: this.props.priceListId,
          productId: this.props.product.value,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          compareAtMinor: options.compareAt?.amountMinor,
          costMinor: options.cost?.amountMinor,
        },
      ),
    );
  }

  /** Sets or clears the effective-date window. Both bounds are optional; if both are set, `effectiveFrom` must precede `effectiveTo`. */
  setEffectiveWindow(effectiveFrom: Date | undefined, effectiveTo: Date | undefined): void {
    if (effectiveFrom !== undefined && effectiveTo !== undefined && effectiveFrom >= effectiveTo) {
      throw new BusinessRuleError("effectiveFrom must precede effectiveTo");
    }
    this.props.effectiveFrom = effectiveFrom;
    this.props.effectiveTo = effectiveTo;
  }

  assignTaxClass(taxClassRef: string | undefined): void {
    this.props.taxClassRef = taxClassRef;
  }

  publish(eventId: string, occurredAt: Date): void {
    if (this.props.status === "published") {
      throw new BusinessRuleError("Price is already published");
    }
    this.props.status = "published";
    this.addDomainEvent(
      new PricePublished(
        { eventId, aggregateId: this.id, occurredAt },
        { priceListId: this.props.priceListId, productId: this.props.product.value },
      ),
    );
  }

  /** Plain state transition back to draft — no dedicated integration event (none named in any sprint report). */
  unpublish(): void {
    this.props.status = "draft";
  }

  /** Whether this price's effective window has not yet started, relative to `now`. */
  isScheduled(now: Date): boolean {
    return this.props.effectiveFrom !== undefined && this.props.effectiveFrom > now;
  }

  /** Soft-delete (Sprint 7.0) — plain state transition, no dedicated integration event. */
  delete(): void {
    if (this.props.deleted) {
      throw new BusinessRuleError("Price is already deleted");
    }
    this.props.deleted = true;
  }

  get priceListId(): string {
    return this.props.priceListId;
  }

  get product(): ProductRef {
    return this.props.product;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get compareAt(): Money | undefined {
    return this.props.compareAt;
  }

  get cost(): Money | undefined {
    return this.props.cost;
  }

  get effectiveFrom(): Date | undefined {
    return this.props.effectiveFrom;
  }

  get effectiveTo(): Date | undefined {
    return this.props.effectiveTo;
  }

  get taxClassRef(): string | undefined {
    return this.props.taxClassRef;
  }

  get status(): PriceStatus {
    return this.props.status;
  }

  get deleted(): boolean {
    return this.props.deleted;
  }

  private static assertBaseCurrency(amount: Money, options: PriceChangeOptions): void {
    if (options.compareAt !== undefined && options.compareAt.currency !== amount.currency) {
      throw new BusinessRuleError("compareAt must be in the same currency as amount");
    }
    if (options.cost !== undefined && options.cost.currency !== amount.currency) {
      throw new BusinessRuleError("cost must be in the same currency as amount");
    }
  }
}
