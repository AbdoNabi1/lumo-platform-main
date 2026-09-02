import type { FiscalPeriod } from "../fiscal-period";

/** Orchestrates closing a {@link FiscalPeriod}; the actual invariant lives on the aggregate. */
export class FiscalClosingService {
  static close(period: FiscalPeriod, eventId: string, occurredAt: Date): void {
    period.close(eventId, occurredAt);
  }
}
