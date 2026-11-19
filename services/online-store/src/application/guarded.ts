import { UniqueEntityId, type DomainEventProps } from "@platform/domain";
import { err, type Result } from "@platform/types";
import { ConcurrencyError, type DomainError } from "@platform/utils";
import { versionConflict } from "../domain/errors";
import type { OnlineStoreDeps } from "./deps";

/**
 * Runs a unit of work. A lost race throws ConcurrencyError INSIDE `run` (so the transaction rolls
 * back) and is answered here, outside it, as 409 VERSION_CONFLICT. Every use case validates before
 * its first write, because `run` commits whenever the callback returns — even an `err` Result.
 */
export async function inUnitOfWork<T>(
  deps: Pick<OnlineStoreDeps, "unitOfWork">,
  work: (tx: unknown) => Promise<Result<T, DomainError>>,
): Promise<Result<T, DomainError>> {
  try {
    return await deps.unitOfWork.run(work);
  } catch (error) {
    if (error instanceof ConcurrencyError) return err(versionConflict());
    throw error;
  }
}

export function eventProps(
  deps: Pick<OnlineStoreDeps, "idGenerator" | "clock">,
  tenantId: string,
): DomainEventProps {
  return {
    eventId: deps.idGenerator.generate(),
    aggregateId: UniqueEntityId.from(tenantId),
    occurredAt: deps.clock.now(),
  };
}

export const iso = (date: Date | null): string | null =>
  date === null ? null : date.toISOString();
