import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import {
  BudgetUpdated,
  CashflowUpdated,
  ExpenseCreated,
  LedgerPosted,
  PeriodClosed,
  SnapshotCreated,
  StatementGenerated,
  TaxCalculated,
} from "../domain/events";

/**
 * Maps Finance domain events to PII-free `finance.*` integration events. Published types use the
 * platform's mandatory `<context>.<aggregate>.<event>` dotted form (`@platform/domain-events`
 * `topicFor`) — distinct from the underscore-form internal domain `eventName`s (M5 reconciliation
 * note: e.g. domain `finance.ledger_posted` publishes as `finance.ledger.posted`).
 */
export class FinanceEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof LedgerPosted) {
      return {
        type: "finance.ledger.posted",
        eventVersion: 1,
        aggregateType: "journal",
        payload: event.data,
      };
    }
    if (event instanceof ExpenseCreated) {
      return {
        type: "finance.expense.created",
        eventVersion: 1,
        aggregateType: "expense",
        payload: event.data,
      };
    }
    if (event instanceof BudgetUpdated) {
      return {
        type: "finance.budget.updated",
        eventVersion: 1,
        aggregateType: "budget",
        payload: event.data,
      };
    }
    if (event instanceof PeriodClosed) {
      return {
        type: "finance.period.closed",
        eventVersion: 1,
        aggregateType: "fiscal_period",
        payload: event.data,
      };
    }
    if (event instanceof SnapshotCreated) {
      return {
        type: "finance.snapshot.created",
        eventVersion: 1,
        aggregateType: "financial_snapshot",
        payload: event.data,
      };
    }
    if (event instanceof StatementGenerated) {
      return {
        type: "finance.statement.generated",
        eventVersion: 1,
        aggregateType: "financial_snapshot",
        payload: event.data,
      };
    }
    if (event instanceof CashflowUpdated) {
      return {
        type: "finance.cashflow.updated",
        eventVersion: 1,
        aggregateType: "financial_snapshot",
        payload: event.data,
      };
    }
    if (event instanceof TaxCalculated) {
      return {
        type: "finance.tax.calculated",
        eventVersion: 1,
        aggregateType: "tax_profile",
        payload: event.data,
      };
    }
    return undefined;
  }
}
