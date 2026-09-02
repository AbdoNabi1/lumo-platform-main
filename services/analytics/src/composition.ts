import { AnalyticsConsoleController } from "./interfaces/analytics-console.controller";
import { registerFinanceSemantics } from "./infrastructure/finance-semantics";
import { SemanticRegistry } from "./registry/semantic-registry";

export interface WiredAnalytics {
  readonly console: AnalyticsConsoleController;
  /** The governed registry itself — exposed for a future composition root (e.g. a second context
   * registering its own canonical semantics) to extend, never to duplicate. */
  readonly registry: SemanticRegistry;
}

/**
 * Composition root for Analytics' semantic-layer catalog (Phase 9 hardening — this context
 * previously had no composition root at all; `apps/runtime`'s `analyticsModule()` builds its own
 * throwaway `SemanticRegistry` purely for boot verification and discards it). Registers every
 * context's canonical semantics exactly once — today only Finance (D-064) — and fails loudly if
 * registration is broken, the same fail-closed posture `analyticsModule()` already established.
 * Read-model-only, no aggregates, no outbox, no business logic — matches `wirePlatformConsole()`'s
 * own minimal shape for the same reason (a pure read facade).
 */
export function wireAnalytics(): WiredAnalytics {
  const registry = new SemanticRegistry();
  registerFinanceSemantics(registry);
  return { console: new AnalyticsConsoleController({ registry }), registry };
}
