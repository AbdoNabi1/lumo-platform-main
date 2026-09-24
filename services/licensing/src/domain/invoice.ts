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
 * column migration never reached it. Non-negative: discounts/credits are a later concept (T14.3).
 */
export interface InvoiceLineItem {
  readonly description: string;
  readonly amountMinor: number;
}

interface InvoiceProps {
  readonly tenantRef: string;
  readonly subscriptionRef: string;
  readonly currency: string;
  lineItems: InvoiceLineItem[];
  status: InvoiceStatus;
  paymentReference?: string;
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
  ): Invoice {
    return new Invoice(
      { tenantRef, subscriptionRef, currency, lineItems: [...lineItems], status, paymentReference },
      id,
      version,
    );
  }

  issue(eventId: string, occurredAt: Date): void {
    this.transition("issued", eventId, occurredAt, "issued");
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

  /** The invoice total as canonical `Money` — exact integer addition in the invoice currency. */
  get total(): Money {
    return Invoice.sum(this.props.currency, this.props.lineItems);
  }

  /** The total in integer minor units — what is handed to the PSP and the ledger. */
  get totalMinor(): number {
    return this.total.amountMinor;
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
}
