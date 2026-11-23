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

/** Maps a use-case `Result` to a transport-neutral response (framework-agnostic; no HTTP server). */
export function present<T>(
  result: Result<T, DomainError>,
  successStatus: number,
): ControllerResponse {
  if (result.ok) {
    return { status: successStatus, body: result.value };
  }
  return { status: STATUS_BY_CODE[result.error.code] ?? 422, body: toErrorEnvelope(result.error) };
}
