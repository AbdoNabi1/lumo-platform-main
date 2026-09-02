import type { Clock, IdGenerator } from "@platform/contracts";
import { DomainEvent, UniqueEntityId, type DomainEventProps } from "@platform/domain";
import type {
  EntitlementDecision,
  EntitlementRequest,
  EntitlementTelemetry,
  EnforcementTarget,
} from "@platform/entitlement";
import type {
  IntegrationEventDescriptor,
  IntegrationEventTranslator,
  EventContext,
  OutboxWriter,
} from "@platform/messaging";

/**
 * Canonical integration events for entitlement decisions (P1.3 §6).
 *
 * NOTE (architectural reconciliation): the sprint brief listed 2-segment names (`entitlement.granted`,
 * `quota.exceeded`, `simulation.executed`, …). The frozen event contract (FF-ARCH-07) requires
 * `<context>.<aggregate>.<event>` — 3 segments. To satisfy governance without redesigning anything, these are
 * emitted as their canonical 3-segment forms below (aggregate = `decision` / `quota` / `simulation`).
 */
export type EntitlementEventName =
  | "entitlement.decision.granted"
  | "entitlement.decision.denied"
  | "entitlement.quota.warning"
  | "entitlement.quota.exceeded"
  | "entitlement.simulation.executed";

export interface EntitlementDecisionEventData {
  readonly aggregateId: string;
  readonly aggregate: "decision" | "quota" | "simulation";
  readonly event: EntitlementEventName;
  readonly tenant: string;
  readonly featureKey: string;
  readonly allowed: boolean;
  readonly source: string;
  readonly policy: string;
  readonly target: string;
  readonly quotaState: string;
  readonly decisionId: string;
}

/** PII-free, tenant-aware entitlement fact for the outbox (ADR-0004/0006). */
export class EntitlementDecisionEvent extends DomainEvent {
  readonly eventName = "entitlement.decision";
  readonly data: EntitlementDecisionEventData;
  constructor(props: DomainEventProps, data: EntitlementDecisionEventData) {
    super(props);
    this.data = data;
  }
}

export class EntitlementEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof EntitlementDecisionEvent) {
      return {
        type: event.data.event,
        eventVersion: 1,
        aggregateType: event.data.aggregate,
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** The canonical integration events the entitlement layer publishes (runtime-verified by `entitlementModule`). */
export const ENTITLEMENT_PUBLISHED_EVENTS = [
  "entitlement.decision.granted",
  "entitlement.decision.denied",
  "entitlement.quota.warning",
  "entitlement.quota.exceeded",
  "entitlement.simulation.executed",
] as const;

function eventNameFor(
  decision: EntitlementDecision,
  simulated: boolean,
): { name: EntitlementEventName; aggregate: "decision" | "quota" | "simulation" } {
  if (simulated) return { name: "entitlement.simulation.executed", aggregate: "simulation" };
  if (decision.source === "quota_exceeded")
    return { name: "entitlement.quota.exceeded", aggregate: "quota" };
  if (decision.quota?.state === "warning")
    return { name: "entitlement.quota.warning", aggregate: "quota" };
  return decision.allowed
    ? { name: "entitlement.decision.granted", aggregate: "decision" }
    : { name: "entitlement.decision.denied", aggregate: "decision" };
}

/**
 * Bridges guard decisions to canonical outbox events (P1.3 §6). Wired as the guard's {@link EntitlementTelemetry}
 * sink so every decision (granted/denied/quota/simulation) becomes a replay-safe, PII-free event. The write is
 * fire-and-forget over the outbox; a publish failure never changes a verdict (the guard already recorded the
 * decision + audit).
 */
export class OutboxEntitlementEventEmitter implements EntitlementTelemetry {
  constructor(
    private readonly deps: {
      readonly outbox: OutboxWriter;
      readonly context: EventContext;
      readonly idGenerator: IdGenerator;
      readonly clock: Clock;
      readonly onError?: (error: unknown) => void;
    },
  ) {}

  onDecision(e: {
    decision: EntitlementDecision;
    request: EntitlementRequest;
    target: EnforcementTarget;
    latencyMs: number;
    cacheHit: boolean;
    simulated: boolean;
  }): void {
    const { name, aggregate } = eventNameFor(e.decision, e.simulated);
    const event = new EntitlementDecisionEvent(
      {
        eventId: this.deps.idGenerator.generate(),
        aggregateId: UniqueEntityId.from(e.request.tenant),
        occurredAt: this.deps.clock.now(),
      },
      {
        aggregateId: e.request.tenant,
        aggregate,
        event: name,
        tenant: e.request.tenant,
        featureKey: e.decision.featureKey,
        allowed: e.decision.allowed,
        source: e.decision.source,
        policy: e.decision.policy ?? "allow",
        target: e.target,
        quotaState: e.decision.quota?.state ?? "none",
        decisionId: e.decision.decisionId ?? "",
      },
    );
    void this.deps.outbox
      .write([event], this.deps.context, undefined)
      .catch((error) => this.deps.onError?.(error));
  }
}
