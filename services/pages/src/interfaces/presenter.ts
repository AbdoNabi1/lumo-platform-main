import type { Result } from "@platform/types";
import { type DomainError, toErrorEnvelope } from "@platform/utils";
import { CODE_PATTERN } from "../domain/errors";

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
 * Maps a use-case `Result` to a transport-neutral response (framework-agnostic; no HTTP server).
 * The specific code (message prefix `CODE:`) becomes `body.code` (Ruling 24). This mirrors the
 * online-store presenter on purpose: services cannot import each other.
 */
export function present<T>(
  result: Result<T, DomainError>,
  successStatus: number,
): ControllerResponse {
  if (result.ok) {
    return { status: successStatus, body: result.value };
  }
  const envelope = toErrorEnvelope(result.error);
  const specific = CODE_PATTERN.exec(result.error.message)?.[1];
  return {
    status: STATUS_BY_CODE[result.error.code] ?? 422,
    body: { ...envelope, code: specific ?? envelope.code },
  };
}
