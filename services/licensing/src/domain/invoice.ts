import {
  AggregateRoot,
  BusinessRuleError,
  Money,
  isValidCurrencyCode,
  type UniqueEntityId,
} from "@platform/domain";
import { LicensingChanged } from "./events/licensing-changed.event";

export type InvoiceStatus = "draft" | "issued" | "paid" | "failed" | "voided";

const TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["issued", "voided"],
  issued: ["paid", "failed", "voided"],
  paid: [],
  failed: ["issued", "voided"],
  voided: [],
};

/**
 * MONEY UNIT CONVENTION (WP-14, Trap 3): `amountMinor` is an INTEGER count of the invoice
 * currency's minor units (cents, piastres) — the same convention `payments`' `amountMinor` and the
 * shared-kernel `Money` (`@platform/domain`, D-029) already use, so there is one convention in the
 * repo, not a third. Integer addition is exact; the previous `amount: number` in major units summed
 * with float `+` and drifted (0.1 + 0.2). This lives in a JSONB column, so WP-11's Float -> Decimal
 * column migration never reached it. Non-negative: a line is never a discount — a coupon is the
 * separate {@link InvoiceDiscount} beside the lines (T14.3, D-072).
 */
export interface InvoiceLineItem {
  readonly description: string;
  readonly amountMinor: number;
}

/**
 * The single coupon discount on an invoice (T14.3, D-072). `Money` is non-negative, so it is NOT a
 * negative line item: it sits beside the lines, `subtotal` stays the exact sum of the lines, and
 * `total = subtotal.minus(discount)` — `Money.minus` refusing a result below zero is what turns a
 * discount larger than the invoice into a loud refusal instead of a silent floor.
 */
export interface InvoiceDiscount {
  readonly couponRef: string;
  readonly amountMinor: number;
}

/**
 * A discount may only be applied while the invoice is still a `draft`. Once `issued` its total is
 * the number the merchant has been told they owe, and `CollectInvoice`'s `<invoiceId>:<version>:collect`
 * PSP key is derived from a `version` any later mutation would bump — silently minting a NEW key on
 * the one thing standing between Morbeh and a double charge (Paymob has no idempotency key of its own).
 */
const DISCOUNTABLE: readonly InvoiceStatus[] = ["draft"];

interface InvoiceProps {
  readonly tenantRef: string;
  readonly subscriptionRef: string;
  readonly currency: string;
  lineItems: InvoiceLineItem[];
  status: InvoiceStatus;
  paymentReference?: string;
  discount?: InvoiceDiscount;
}

/**
 * Billing invoice (ADR-0018 Sprint-5.5 addendum §B) — collects through the Payments port (ADR-0012;
 * Licensing never talks to a PSP directly) and posts settled amounts to the Finance ledger
 * (ADR-0024). All amounts are integer minor units (see {@link InvoiceLineItem}); a `failed` invoice
 * can be re-issued (`failed -> issued`) for a later retry — the retry SCHEDULE is T14.5's.
 */
export class Invoice extends AggregateRoot<InvoiceProps> {
  static createDraft(
    id: UniqueEntityId,
    tenantRef: string,
    subscriptionRef: string,
    currency: string,
    lineItems: readonly InvoiceLineItem[],
    eventId: string,
    occurredAt: Date,
  ): Invoice {
    Invoice.assertExactMoney(currency, lineItems);
    const invoice = new Invoice(
      { tenantRef, subscriptionRef, currency, lineItems: [...lineItems], status: "draft" },
      id,
    );
    invoice.raise("created", eventId, occurredAt);
    return invoice;
  }

  static reconstitute(
    id: UniqueEntityId,
    tenantRef: string,
    subscriptionRef: string,
    currency: string,
    lineItems: readonly InvoiceLineItem[],
    status: InvoiceStatus,
    version: number,
    paymentReference?: string,
    discount?: InvoiceDiscount,
  ): Invoice {
    const invoice = new Invoice(
      {
        tenantRef,
        subscriptionRef,
        currency,
        lineItems: [...lineItems],
        status,
        paymentReference,
        ...(discount === undefined ? {} : { discount }),
      },
      id,
      version,
    );
    // A persisted discount must still subtract cleanly: a row whose discount exceeds its subtotal
    // (or is in a foreign currency) is corrupt and refused on load rather than charged.
    invoice.assertDiscountConsistent();
    return invoice;
  }

  issue(eventId: string, occurredAt: Date): void {
    this.transition("issued", eventId, occurredAt, "issued");
  }

  /**
   * Applies the invoice's ONE coupon discount. `draft` only ({@link DISCOUNTABLE}); a second discount,
   * a foreign-currency one, or one larger than the subtotal is refused with the invoice unchanged.
   */
  applyDiscount(couponRef: string, amount: Money, eventId: string, occurredAt: Date): void {
    this.assertCanDiscount(amount);
    this.props.discount = { couponRef, amountMinor: amount.amountMinor };
    this.raise("discounted", eventId, occurredAt);
  }

  /**
   * Throws unless `amount` can be applied as this invoice's discount, and changes nothing — public for
   * the same reason as `Coupon.assertRedeemable`: check every aggregate before mutating any.
   */
  assertCanDiscount(amount: Money): void {
    if (!DISCOUNTABLE.includes(this.props.status)) {
      throw new BusinessRuleError(
        `A discount can only be applied to a draft invoice, not one that is ${this.props.status}`,
      );
    }
    if (this.props.discount !== undefined) {
      throw new BusinessRuleError("Invoice already has a discount");
    }
    // `minus` throws on a currency mismatch and on a negative result: the refusal, before any state change.
    this.subtotal.minus(amount);
  }

  markPaid(paymentReference: string, eventId: string, occurredAt: Date): void {
    this.props.paymentReference = paymentReference;
    this.transition("paid", eventId, occurredAt, "paid");
  }

  markFailed(eventId: string, occurredAt: Date): void {
    this.transition("failed", eventId, occurredAt, "failed");
  }

  voidInvoice(eventId: string, occurredAt: Date): void {
    this.transition("voided", eventId, occurredAt, "voided");
  }

  /** The exact sum of the line items, before any discount. */
  get subtotal(): Money {
    return Invoice.sum(this.props.currency, this.props.lineItems);
  }

  /** The invoice total as canonical `Money`: the subtotal less the discount, in the invoice currency. */
  get total(): Money {
    const discount = this.props.discount;
    if (discount === undefined) return this.subtotal;
    const amount = Money.create(discount.amountMinor, this.props.currency);
    if (!amount.ok) {
      throw new BusinessRuleError("Invoice discount amountMinor must be a non-negative integer");
    }
    return this.subtotal.minus(amount.value);
  }

  /** The total in integer minor units — what is handed to the PSP and the ledger. */
  get totalMinor(): number {
    return this.total.amountMinor;
  }

  /** Computing the total is the check: `Money.minus` refuses a foreign currency or a negative result. */
  private assertDiscountConsistent(): void {
    if (this.props.discount === undefined) return;
    if (!Number.isSafeInteger(this.total.amountMinor)) {
      throw new BusinessRuleError("Invoice total exceeds the exactly-representable range");
    }
  }

  private static assertExactMoney(currency: string, lineItems: readonly InvoiceLineItem[]): void {
    if (!isValidCurrencyCode(currency)) {
      throw new BusinessRuleError(`Invalid invoice currency "${currency}" (ISO-4217, 3 capitals)`);
    }
    Invoice.sum(currency, lineItems);
  }

  private static sum(currency: string, lineItems: readonly InvoiceLineItem[]): Money {
    let total = Money.zero(currency);
    for (const item of lineItems) {
      const line = Money.create(item.amountMinor, currency);
      if (!line.ok) {
        throw new BusinessRuleError(
          `Invoice line "${item.description}": amountMinor must be a non-negative integer of minor units`,
        );
      }
      total = total.plus(line.value);
      if (!Number.isSafeInteger(total.amountMinor)) {
        throw new BusinessRuleError("Invoice total exceeds the exactly-representable range");
      }
    }
    return total;
  }

  private transition(to: InvoiceStatus, eventId: string, occurredAt: Date, action: string): void {
    if (!TRANSITIONS[this.props.status].includes(to)) {
      throw new BusinessRuleError(`Cannot transition invoice from ${this.props.status} to ${to}`);
    }
    this.props.status = to;
    this.raise(action, eventId, occurredAt);
  }

  private raise(action: string, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new LicensingChanged(
        { eventId, aggregateId: this.id, occurredAt },
        { ref: this.props.tenantRef, family: "invoice", action },
      ),
    );
  }

  get tenantRef(): string {
    return this.props.tenantRef;
  }

  get subscriptionRef(): string {
    return this.props.subscriptionRef;
  }

  get currency(): string {
    return this.props.currency;
  }

  get lineItems(): readonly InvoiceLineItem[] {
    return this.props.lineItems;
  }

  get status(): InvoiceStatus {
    return this.props.status;
  }

  get paymentReference(): string | undefined {
    return this.props.paymentReference;
  }

  get discount(): InvoiceDiscount | undefined {
    return this.props.discount;
  }

  /**
   * True only when a coupon brought a non-zero subtotal to zero — the one case a zero total is a
   * settled invoice rather than a malformed one (`CollectInvoice` still refuses an undiscounted zero).
   */
  get isFullyDiscounted(): boolean {
    return this.props.discount !== undefined && this.totalMinor === 0;
  }
}
