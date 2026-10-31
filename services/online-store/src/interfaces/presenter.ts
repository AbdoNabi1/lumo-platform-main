import type { Result } from "@platform/types";
import { toErrorEnvelope, type DomainError } from "@platform/utils";
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

/** Ruling 9: the specific code (message prefix `CODE:`) becomes `body.code`. */
export function present<T>(
  result: Result<T, DomainError>,
  successStatus: number,
): ControllerResponse {
  if (result.ok) return { status: successStatus, body: result.value };
  const envelope = toErrorEnvelope(result.error);
  const specific = CODE_PATTERN.exec(result.error.message)?.[1];
  return {
    status: STATUS_BY_CODE[result.error.code] ?? 422,
    body: { ...envelope, code: specific ?? envelope.code },
  };
}

export function plainError(status: number, code: string, message: string): ControllerResponse {
  return { status, body: { code, message, retryable: false, fields: [] } };
}
