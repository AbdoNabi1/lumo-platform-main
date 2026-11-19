import { ConcurrencyError } from "@platform/utils";

/**
 * Bounded retry on optimistic-lock conflicts only. `PrismaFulfillmentOrderRepository.save` throws
 * `ConcurrencyError` when a concurrent writer already advanced the row's `version`; that is
 * expected and recoverable, so the whole read-transition-write attempt is retried from scratch
 * against the now-current row. Any other error (including a Result-channel domain rejection, which
 * is returned not thrown) propagates immediately. One copy for the whole fulfillment context.
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
