import type { Result } from "@platform/types";
import type { DomainError } from "@platform/utils";

/**
 * Application use-case contract. Returns a `Result`: expected failures are modelled as a
 * `DomainError` in the error channel; unexpected failures are thrown and surface via
 * middleware/transport (docs/architecture/13).
 */
export interface UseCase<TInput, TOutput, TError extends DomainError = DomainError> {
  execute(input: TInput): Promise<Result<TOutput, TError>>;
}
