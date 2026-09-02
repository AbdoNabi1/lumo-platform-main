import type { ActionDispatcherPort } from "../application/ports";
import type { AutomationAction } from "../domain/value-objects/trigger-action";

/** Offline in-memory stub adapter for `ActionDispatcherPort`. Production swaps this for a real cross-context dispatcher at the composition root (deferred, per the report's own G-39 note). */
export class InMemoryActionDispatcher implements ActionDispatcherPort {
  private readonly dispatched: { actions: readonly AutomationAction[]; triggerId: string }[] = [];

  async dispatch(actions: readonly AutomationAction[], triggerId: string): Promise<void> {
    this.dispatched.push({ actions, triggerId });
  }

  /** Test/demo seam — the dispatches recorded so far. */
  get dispatchedCalls(): readonly { actions: readonly AutomationAction[]; triggerId: string }[] {
    return this.dispatched;
  }
}
