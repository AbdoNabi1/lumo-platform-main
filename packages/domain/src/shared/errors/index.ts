/**
 * Domain errors REUSE the shared kernel (`@platform/utils`) — the single source of truth.
 * Nothing is redefined here; this is a curated re-export so domain code has one import surface.
 * New bounded-context-specific errors extend these (e.g. `class OutOfStockError extends BusinessRuleError`).
 */
export {
  AppError,
  type AppErrorOptions,
  DomainError,
  ValidationError,
  type FieldIssue,
  NotFoundError,
  ConflictError,
  ConcurrencyError,
  BusinessRuleError,
  UnexpectedError,
  isAppError,
  isDomainError,
} from "@platform/utils";
