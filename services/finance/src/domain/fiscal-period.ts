import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { PeriodClosed } from "./events/period-closed.event";

interface FiscalPeriodProps {
  readonly startDate: Date;
  readonly endDate: Date;
  closed: boolean;
}

/** A fiscal reporting period (month/quarter/year) that can be opened, then closed once. */
export class FiscalPeriod extends AggregateRoot<FiscalPeriodProps> {
  static open(id: UniqueEntityId, startDate: Date, endDate: Date): FiscalPeriod {
    if (endDate <= startDate) {
      throw new BusinessRuleError("Fiscal period endDate must be after startDate");
    }
    return new FiscalPeriod({ startDate, endDate, closed: false }, id);
  }

  static reconstitute(
    id: UniqueEntityId,
    startDate: Date,
    endDate: Date,
    closed: boolean,
    version: number,
  ): FiscalPeriod {
    return new FiscalPeriod({ startDate, endDate, closed }, id, version);
  }

  close(eventId: string, occurredAt: Date): void {
    if (this.props.closed) {
      throw new BusinessRuleError("Fiscal period is already closed");
    }
    this.props.closed = true;
    this.addDomainEvent(
      new PeriodClosed(
        { eventId, aggregateId: this.id, occurredAt },
        {
          startDate: this.props.startDate.toISOString(),
          endDate: this.props.endDate.toISOString(),
        },
      ),
    );
  }

  get startDate(): Date {
    return this.props.startDate;
  }

  get endDate(): Date {
    return this.props.endDate;
  }

  get closed(): boolean {
    return this.props.closed;
  }
}
