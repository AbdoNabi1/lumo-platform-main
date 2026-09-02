import { AggregateRoot, type Money, type UniqueEntityId } from "@platform/domain";
import { ExpenseCreated } from "./events/expense-created.event";

interface ExpenseProps {
  readonly costCenterRef: string;
  readonly categoryRef: string;
  readonly amount: Money;
  readonly description: string;
  readonly incurredAt: Date;
}

/** A merchant-entered expense (salaries, fixed costs, and other non-commerce-event financial data). */
export class Expense extends AggregateRoot<ExpenseProps> {
  static record(
    id: UniqueEntityId,
    costCenterRef: string,
    categoryRef: string,
    amount: Money,
    description: string,
    incurredAt: Date,
    eventId: string,
    occurredAt: Date,
  ): Expense {
    const expense = new Expense(
      { costCenterRef, categoryRef, amount, description, incurredAt },
      id,
    );
    expense.addDomainEvent(
      new ExpenseCreated(
        { eventId, aggregateId: id, occurredAt },
        {
          costCenterRef,
          categoryRef,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
        },
      ),
    );
    return expense;
  }

  static reconstitute(
    id: UniqueEntityId,
    costCenterRef: string,
    categoryRef: string,
    amount: Money,
    description: string,
    incurredAt: Date,
    version: number,
  ): Expense {
    return new Expense(
      { costCenterRef, categoryRef, amount, description, incurredAt },
      id,
      version,
    );
  }

  get costCenterRef(): string {
    return this.props.costCenterRef;
  }

  get categoryRef(): string {
    return this.props.categoryRef;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get description(): string {
    return this.props.description;
  }

  get incurredAt(): Date {
    return this.props.incurredAt;
  }
}
