import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import { BusinessRuleError } from "@platform/utils";
import type { Address } from "./address";
import { ConsentRecord } from "./consent-record";
import { ConsentChanged } from "./events/consent-changed.event";
import { CustomerRegistered } from "./events/customer-registered.event";
import type { ConsentScope } from "./value-objects/consent-scope";
import type { Email } from "./value-objects/email";

interface CustomerProps {
  readonly email: Email;
  name: string;
  readonly addresses: Address[];
  readonly consents: ConsentRecord[];
  /**
   * Created by guest checkout (WP-1, G-52) rather than by registering: no password, no verified
   * email, no consent given. Lets Customer 360 and Notifications tell the two apart, and a later
   * registration upgrade it (G-72, {@link Customer.upgradeFromGuest}).
   */
  isGuest: boolean;
  /** Set only by {@link upgradeFromGuest} — proof the shopper opened the emailed signup link (G-72). */
  emailVerifiedAt: Date | null;
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
    return Customer.raiseRegistered(id, email, name, false, eventId, occurredAt);
  }

  /**
   * A customer created on the fly from a guest checkout's contact email (WP-1). Identical to
   * {@link register} except it carries the guest marker. Consent is deliberately left empty —
   * placing an order is a transaction, not an opt-in.
   */
  static registerGuest(
    id: UniqueEntityId,
    email: Email,
    name: string,
    eventId: string,
    occurredAt: Date,
  ): Customer {
    return Customer.raiseRegistered(id, email, name, true, eventId, occurredAt);
  }

  private static raiseRegistered(
    id: UniqueEntityId,
    email: Email,
    name: string,
    isGuest: boolean,
    eventId: string,
    occurredAt: Date,
  ): Customer {
    const customer = new Customer(
      { email, name, addresses: [], consents: [], isGuest, emailVerifiedAt: null },
      id,
    );
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
    isGuest = false,
    emailVerifiedAt: Date | null = null,
  ): Customer {
    return new Customer(
      { email, name, addresses: [...addresses], consents: [...consents], isGuest, emailVerifiedAt },
      id,
      version,
    );
  }

  addAddress(address: Address): void {
    this.props.addresses.push(address);
  }

  /**
   * Upgrades a guest-checkout customer to a real, login-capable account (G-72) — the shopper has
   * just proven ownership of the email by opening a single-use signup-completion link
   * (`CompleteSignup`). Sets `isGuest` false and `emailVerifiedAt`; also takes the name from the
   * completion form (the guest's checkout name may not be what they want on the account). No
   * domain event is raised: nothing downstream needs to react to this transition — the customer id
   * is unchanged, which is what lets Customer 360 and every other reader keep stitching by id.
   */
  upgradeFromGuest(name: string, occurredAt: Date): void {
    if (!this.props.isGuest) {
      throw new BusinessRuleError("Only a guest customer can be upgraded");
    }
    this.props.isGuest = false;
    this.props.emailVerifiedAt = occurredAt;
    this.props.name = name;
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

  get isGuest(): boolean {
    return this.props.isGuest;
  }

  get emailVerifiedAt(): Date | null {
    return this.props.emailVerifiedAt;
  }

  get addresses(): readonly Address[] {
    return this.props.addresses;
  }

  get consents(): readonly ConsentRecord[] {
    return this.props.consents;
  }
}
