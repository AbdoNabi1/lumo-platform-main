import type { EntitlementMetricsSnapshot } from "@platform/entitlement";
import type { EntitlementDecisionEventData } from "./entitlement-events";

/**
 * Read models for the Platform Console (P1.3 §10). **Read side only** — a deterministic projection over the
 * canonical entitlement events + the metrics snapshot. It owns no business logic and no state beyond the rolling
 * projection; the Platform Console consumes these shapes (it does not compute entitlement decisions).
 */
export interface EntitlementConsoleView {
  readonly metrics: EntitlementMetricsSnapshot | null;
  readonly decisionHistory: readonly EntitlementDecisionEventData[];
  readonly quotaHistory: readonly EntitlementDecisionEventData[];
  readonly topDeniedFeatures: readonly { readonly featureKey: string; readonly count: number }[];
  readonly topGrantedFeatures: readonly { readonly featureKey: string; readonly count: number }[];
  readonly simulationHistory: readonly EntitlementDecisionEventData[];
}

/** A bounded, deterministic projection of entitlement events into the console read model. */
export class EntitlementConsoleProjection {
  private readonly decisions: EntitlementDecisionEventData[] = [];
  private readonly quota: EntitlementDecisionEventData[] = [];
  private readonly simulations: EntitlementDecisionEventData[] = [];
  private readonly denied = new Map<string, number>();
  private readonly granted = new Map<string, number>();
  private metrics: EntitlementMetricsSnapshot | null = null;

  constructor(private readonly historyLimit = 500) {}

  /** Projects one canonical entitlement event (idempotent per unique event; deterministic ordering). */
  project(data: EntitlementDecisionEventData): void {
    if (data.aggregate === "simulation") {
      this.push(this.simulations, data);
      return;
    }
    if (data.aggregate === "quota") {
      this.push(this.quota, data);
    }
    this.push(this.decisions, data);
    if (data.allowed)
      this.granted.set(data.featureKey, (this.granted.get(data.featureKey) ?? 0) + 1);
    else this.denied.set(data.featureKey, (this.denied.get(data.featureKey) ?? 0) + 1);
  }

  setMetrics(snapshot: EntitlementMetricsSnapshot): void {
    this.metrics = snapshot;
  }

  view(): EntitlementConsoleView {
    return {
      metrics: this.metrics,
      decisionHistory: [...this.decisions],
      quotaHistory: [...this.quota],
      simulationHistory: [...this.simulations],
      topDeniedFeatures: EntitlementConsoleProjection.top(this.denied),
      topGrantedFeatures: EntitlementConsoleProjection.top(this.granted),
    };
  }

  private push(list: EntitlementDecisionEventData[], data: EntitlementDecisionEventData): void {
    list.push(data);
    if (list.length > this.historyLimit) list.shift();
  }

  private static top(
    counts: Map<string, number>,
  ): readonly { featureKey: string; count: number }[] {
    return [...counts.entries()]
      .map(([featureKey, count]) => ({ featureKey, count }))
      .sort((a, b) => b.count - a.count || a.featureKey.localeCompare(b.featureKey))
      .slice(0, 10);
  }
}
