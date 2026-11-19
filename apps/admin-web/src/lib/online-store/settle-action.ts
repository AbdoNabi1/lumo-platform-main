import { unstable_rethrow } from "next/navigation";

/**
 * Runs one server-action call from a client component. A call that never answers (offline, or
 * the action itself crashed) rejects: the caller gets `fallback` (its own localised error state),
 * never silence, so a pending button always comes back. Next's own control flow (`redirect`,
 * `notFound`) is rethrown so navigation still happens (Task 10 review).
 */
export async function settleAction<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await call();
  } catch (error) {
    unstable_rethrow(error);
    return fallback;
  }
}
