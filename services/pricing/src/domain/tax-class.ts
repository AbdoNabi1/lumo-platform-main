import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { TaxClassCreated } from "./events/tax-class-created.event";

interface TaxClassProps {
  readonly code: string;
  name: string;
  deleted: boolean;
}

/** A named tax classification a price can be assigned to (classification only — Pricing computes no tax, ADR-0024). `code` is unique per tenant. */
export class TaxClass extends AggregateRoot<TaxClassProps> {
  static create(
    id: UniqueEntityId,
    code: string,
    name: string,
    eventId: string,
    occurredAt: Date,
  ): TaxClass {
    const taxClass = new TaxClass({ code, name, deleted: false }, id);
    taxClass.addDomainEvent(
      new TaxClassCreated({ eventId, aggregateId: taxClass.id, occurredAt }, { code, name }),
    );
    return taxClass;
  }

  static reconstitute(
    id: UniqueEntityId,
    code: string,
    name: string,
    deleted: boolean,
    version: number,
  ): TaxClass {
    return new TaxClass({ code, name, deleted }, id, version);
  }

  rename(name: string): void {
    this.props.name = name;
  }

  /** Soft-delete (Sprint 7.0) — plain state transition, no dedicated integration event (none named for it in any sprint report). */
  delete(): void {
    if (this.props.deleted) {
      throw new BusinessRuleError("Tax class is already deleted");
    }
    this.props.deleted = true;
  }

  get code(): string {
    return this.props.code;
  }

  get name(): string {
    return this.props.name;
  }

  get deleted(): boolean {
    return this.props.deleted;
  }
}
