import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { LicensingChanged } from "./events/licensing-changed.event";

export type InvoiceStatus = "draft" | "issued" | "paid" | "failed" | "voided";

const TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["issued", "voided"],
  issued: ["paid", "failed", "voided"],
  paid: [],
  failed: ["issued", "voided"],
  voided: [],
};

export interface InvoiceLineItem {
  readonly description: string;
  readonly amount: number;
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
 * (ADR-0024).
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

  get total(): number {
    return this.props.lineItems.reduce((sum, item) => sum + item.amount, 0);
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
