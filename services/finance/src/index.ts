export * from "./domain/value-objects/account-type";
export * from "./domain/value-objects/ledger-direction";
export * from "./domain/value-objects/balance";
export * from "./domain/value-objects/tax-rate";
export * from "./domain/value-objects/cost-component";
export * from "./domain/value-objects/journal-line";
export * from "./domain/value-objects/ledger-entry";
export * from "./domain/value-objects/currency";
export * from "./domain/events";
export { Journal } from "./domain/journal";
export { Account } from "./domain/account";
export { CostCenter } from "./domain/cost-center";
export { ExpenseCategory } from "./domain/expense-category";
export { Expense } from "./domain/expense";
export { Budget } from "./domain/budget";
export { ExchangeRate } from "./domain/exchange-rate";
export { FiscalPeriod } from "./domain/fiscal-period";
export { TaxProfile } from "./domain/tax-profile";
export { CogsSnapshot } from "./domain/cogs-snapshot";
export { FinancialSnapshot } from "./domain/financial-snapshot";
export * from "./domain/services";
export * from "./domain/read-model-store";
export * from "./read-models";
export { ClickHouseReadModelStore } from "./infrastructure/clickhouse-read-model-store";
export { wireFinance } from "./composition";
export type { FinanceWiringDeps, WiredFinance } from "./composition";
export { FinanceController } from "./interfaces/finance.controller";
export type { ControllerResponse } from "./interfaces/presenter";
// Task 17b (C-2): the runtime worker registers Finance's `OrdersPaidConsumer` against
// `orders.order.paid` (it had zero callers before), so the consumer, its deps type, the
// `JournalRepository` port and the Prisma-backed ledger repository + translator it needs must be
// reachable from outside this package — `apps/runtime` composes them directly against `core.prisma`
// rather than going through `wireFinance`'s controller (consumers call the application layer only).
export type { JournalRepository, LedgerEntryRepository } from "./domain/repositories";
export { OrdersPaidConsumer, type FinanceConsumerDeps } from "./interfaces/finance-consumers";
// WP-11 (F-11): same reasoning as OrdersPaidConsumer above — `PaymentsCapturedConsumer`/
// `RefundsIssuedConsumer` had zero callers (composition.test.ts's own regression test asserted
// exactly that) until the runtime worker registered them against `payments.payment_intent.
// captured`/`.refunded`.
export { PaymentsCapturedConsumer, RefundsIssuedConsumer } from "./interfaces/finance-consumers";
export {
  PrismaJournalRepository,
  type PrismaJournalDeps,
} from "./infrastructure/prisma-finance-repositories";
export { FinanceEventTranslator } from "./infrastructure/finance-event-translator";
