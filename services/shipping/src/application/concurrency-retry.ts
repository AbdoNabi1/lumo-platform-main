import { ConcurrencyError } from "@platform/utils";

/**
 * Bounded retry on optimistic-lock conflicts only (Phase A.15, reusing the shape Payments'
 * `withConcurrencyRetry` established in Phase A.4/A.8; one copy per context by convention, shared
 * by every shipping use case). `PrismaShipmentRepository.save` throws `ConcurrencyError` when a
 * concurrent writer already advanced the row's `version` — that is expected/recoverable (two racing
 * attempts for the same shipment), so the read-check-write attempt is retried from scratch against
 * the now-current row. Any other error propagates immediately.
 */
export async function withConcurrencyRetry<T>(
  maxAttempts: number,
  attempt: () => Promise<T>,
): Promise<T> {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof ConcurrencyError) || i === maxAttempts) {
        throw error;
      }
    }
  }
  throw new Error("unreachable");
}
