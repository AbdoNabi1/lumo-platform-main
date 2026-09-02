import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import type { Address } from "./address";
import { ConsentRecord } from "./consent-record";
import { ConsentChanged } from "./events/consent-changed.event";
import { CustomerRegistered } from "./events/customer-registered.event";
import type { ConsentScope } from "./value-objects/consent-scope";
import type { Email } from "./value-objects/email";

interface CustomerProps {
  readonly email: Email;
  readonly name: string;
  readonly addresses: Address[];
  readonly consents: ConsentRecord[];
}

/**
 * A customer: identity (email + name), postal addresses, and an append-only consent log. Consent
 * for a scope is **derived** from the latest record. Raises `customer.registered` and
 * `consent.changed`.
 */
export class Customer extends AggregateRoot<CustomerProps> {
  static register(
    id: UniqueEntityId,
    email: Email,
    name: string,
    eventId: string,
    occurredAt: Date,
  ): Customer {
    const customer = new Customer({ email, name, addresses: [], consents: [] }, id);
    customer.addDomainEvent(
      new CustomerRegistered(
        { eventId, aggregateId: customer.id, occurredAt },
        { email: email.value, name },
      ),
    );
    return customer;
  }

  /**
   * Rebuilds a persisted customer exactly as stored — no domain events raised, persisted
   * `version` carried for optimistic locking (ADR-0003, G-12). `consents` must be the full
   * append-only log in occurrence order (consent state derives from the latest per scope).
   */
  static reconstitute(
    id: UniqueEntityId,
    email: Email,
    name: string,
    addresses: readonly Address[],
    consents: readonly ConsentRecord[],
    version: number,
  ): Customer {
    return new Customer(
      { email, name, addresses: [...addresses], consents: [...consents] },
      id,
      version,
    );
  }

  addAddress(address: Address): void {
    this.props.addresses.push(address);
  }

  changeConsent(
    consentId: UniqueEntityId,
    scope: ConsentScope,
    granted: boolean,
    eventId: string,
    occurredAt: Date,
  ): void {
    this.props.consents.push(ConsentRecord.create(consentId, scope, granted, occurredAt));
    this.addDomainEvent(
      new ConsentChanged(
        { eventId, aggregateId: this.id, occurredAt },
        { scope: scope.value, granted },
      ),
    );
  }

  /** Current consent for a scope, derived from the latest matching record (default: not granted). */
  consentFor(scope: ConsentScope): boolean {
    for (let i = this.props.consents.length - 1; i >= 0; i -= 1) {
      const record = this.props.consents[i];
      if (record !== undefined && record.scope.value === scope.value) {
        return record.granted;
      }
    }
    return false;
  }

  get email(): Email {
    return this.props.email;
  }

  get name(): string {
    return this.props.name;
  }

  get addresses(): readonly Address[] {
    return this.props.addresses;
  }

  get consents(): readonly ConsentRecord[] {
    return this.props.consents;
  }
}
