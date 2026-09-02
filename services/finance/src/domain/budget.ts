import { AggregateRoot, type Money, type UniqueEntityId } from "@platform/domain";
import { BudgetUpdated } from "./events/budget-updated.event";

interface BudgetProps {
  readonly costCenterRef: string;
  readonly period: string;
  amount: Money;
  revisions: number;
}

/** A planned spend for a cost center over a fiscal period. */
export class Budget extends AggregateRoot<BudgetProps> {
  static create(
    id: UniqueEntityId,
    costCenterRef: string,
    period: string,
    amount: Money,
    eventId: string,
    occurredAt: Date,
  ): Budget {
    const budget = new Budget({ costCenterRef, period, amount, revisions: 0 }, id);
    budget.raiseUpdated(eventId, occurredAt);
    return budget;
  }

  static reconstitute(
    id: UniqueEntityId,
    costCenterRef: string,
    period: string,
    amount: Money,
    revisions: number,
    version: number,
  ): Budget {
    return new Budget({ costCenterRef, period, amount, revisions }, id, version);
  }

  revise(amount: Money, eventId: string, occurredAt: Date): void {
    this.props.amount = amount;
    this.props.revisions += 1;
    this.raiseUpdated(eventId, occurredAt);
  }

  private raiseUpdated(eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new BudgetUpdated(
        { eventId, aggregateId: this.id, occurredAt },
        {
          costCenterRef: this.props.costCenterRef,
          period: this.props.period,
          amountMinor: this.props.amount.amountMinor,
          currency: this.props.amount.currency,
        },
      ),
    );
  }

  get costCenterRef(): string {
    return this.props.costCenterRef;
  }

  get period(): string {
    return this.props.period;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get revisions(): number {
    return this.props.revisions;
  }
}
