import { toErrorEnvelope, type ErrorEnvelope } from "@platform/utils";

/**
 * The single transport-wide map from domain error CODES to HTTP status (mirrors the per-context
 * presenter contract, doc 04 §2 — presenters map use-case `Result`s; this maps errors THROWN at
 * the transport boundary: middleware, validation, unexpected). Unknown codes are 500 with the
 * uniform envelope and no internal detail (`toErrorEnvelope` never leaks stacks).
 */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  VALIDATION: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CONCURRENCY: 409,
  BUSINESS_RULE: 409,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
};

export interface MappedError {
  readonly status: number;
  readonly envelope: ErrorEnvelope;
}

export function mapError(error: unknown, traceId?: string): MappedError {
  const envelope = toErrorEnvelope(error, traceId);
  const status = STATUS_BY_CODE[envelope.code] ?? 500;
  return { status, envelope };
}
