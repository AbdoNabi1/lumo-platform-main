import { isAppError } from "./errors";
import { DomainError, ValidationError, type FieldIssue } from "./domain-errors";

/** Uniform API error envelope (docs/architecture/04 §2). */
export interface ErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly fields: readonly FieldIssue[];
  readonly traceId?: string;
}

/**
 * Maps any thrown value to the uniform error envelope. Never leaks stack traces or internal
 * details for unknown errors. `traceId` is injected by the transport edge, not derived here.
 */
export function toErrorEnvelope(error: unknown, traceId?: string): ErrorEnvelope {
  if (error instanceof ValidationError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      fields: error.fields,
      traceId,
    };
  }
  if (error instanceof DomainError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      fields: [],
      traceId,
    };
  }
  if (isAppError(error)) {
    return { code: error.code, message: error.message, retryable: false, fields: [], traceId };
  }
  return {
    code: "UNEXPECTED",
    message: "An unexpected error occurred",
    retryable: true,
    fields: [],
    traceId,
  };
}
