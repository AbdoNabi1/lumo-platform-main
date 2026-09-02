import { AppError } from "./errors";

/**
 * Domain error hierarchy — expected, semantically-typed failures returned via `Result`
 * (docs/architecture/13). Lives in the shared-kernel utils package so the future domain layer
 * can use these without depending on the application layer (Clean Architecture).
 *
 * `retryable` informs the API error envelope (docs/architecture/04). Unexpected failures
 * (e.g. a database outage) are NOT modelled here — they are thrown and surface as `UnexpectedError`.
 */
export abstract class DomainError extends AppError {
  abstract readonly retryable: boolean;
}

export interface FieldIssue {
  readonly field: string;
  readonly message: string;
}

/** Input failed validation. Carries per-field issues for the API envelope. */
export class ValidationError extends DomainError {
  readonly retryable = false;
  readonly fields: readonly FieldIssue[];

  constructor(
    message: string,
    fields: readonly FieldIssue[] = [],
    options: { cause?: unknown } = {},
  ) {
    super(message, { code: "VALIDATION", cause: options.cause });
    this.fields = fields;
  }
}

/** A requested resource does not exist. */
export class NotFoundError extends DomainError {
  readonly retryable = false;

  constructor(
    message = "Resource not found",
    options: { cause?: unknown; context?: Record<string, unknown> } = {},
  ) {
    super(message, { code: "NOT_FOUND", cause: options.cause, context: options.context });
  }
}

/** The operation conflicts with current state (e.g. a uniqueness violation). */
export class ConflictError extends DomainError {
  readonly retryable = false;

  constructor(
    message = "Conflict",
    options: { cause?: unknown; context?: Record<string, unknown> } = {},
  ) {
    super(message, { code: "CONFLICT", cause: options.cause, context: options.context });
  }
}

/** Optimistic-concurrency conflict; the caller may retry with a fresh read. */
export class ConcurrencyError extends DomainError {
  readonly retryable = true;

  constructor(message = "Concurrent modification detected", options: { cause?: unknown } = {}) {
    super(message, { code: "CONCURRENCY", cause: options.cause });
  }
}

/** A business rule/invariant was violated. */
export class BusinessRuleError extends DomainError {
  readonly retryable = false;

  constructor(
    message: string,
    options: { cause?: unknown; context?: Record<string, unknown> } = {},
  ) {
    super(message, { code: "BUSINESS_RULE", cause: options.cause, context: options.context });
  }
}

/** An unexpected failure escaped lower layers; safe to retry. */
export class UnexpectedError extends DomainError {
  readonly retryable = true;

  constructor(message = "An unexpected error occurred", options: { cause?: unknown } = {}) {
    super(message, { code: "UNEXPECTED", cause: options.cause });
  }
}

/** The request lacks valid authentication credentials (maps to HTTP 401). */
export class AuthenticationError extends DomainError {
  readonly retryable = false;

  constructor(message = "Authentication required", options: { cause?: unknown } = {}) {
    super(message, { code: "UNAUTHENTICATED", cause: options.cause });
  }
}

/** The authenticated principal is not permitted to perform the action (maps to HTTP 403). */
export class AuthorizationError extends DomainError {
  readonly retryable = false;

  constructor(
    message = "Not authorized",
    options: { cause?: unknown; context?: Record<string, unknown> } = {},
  ) {
    super(message, { code: "FORBIDDEN", cause: options.cause, context: options.context });
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
