import type { Result } from "@platform/types";
import { type DomainError, toErrorEnvelope } from "@platform/utils";

export interface ControllerResponse {
  readonly status: number;
  readonly body: unknown;
}

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  VALIDATION: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CONCURRENCY: 409,
  BUSINESS_RULE: 409,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
};

/**
 * Maps a use-case `Result` to a transport-neutral response (the framework-agnostic boundary; no
 * HTTP server). Errors become the uniform API error envelope (docs/architecture/04) with a status
 * derived from the domain error code.
 */
export function present<T>(
  result: Result<T, DomainError>,
  successStatus: number,
): ControllerResponse {
  if (result.ok) {
    return { status: successStatus, body: result.value };
  }
  return { status: STATUS_BY_CODE[result.error.code] ?? 422, body: toErrorEnvelope(result.error) };
}
