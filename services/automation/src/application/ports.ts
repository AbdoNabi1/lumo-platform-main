import type { AutomationAction } from "../domain/value-objects/trigger-action";

/** Outbound seam for dispatching a workflow's actions — Automation never calls another context directly. */
export interface ActionDispatcherPort {
  dispatch(actions: readonly AutomationAction[], triggerId: string): Promise<void>;
}
