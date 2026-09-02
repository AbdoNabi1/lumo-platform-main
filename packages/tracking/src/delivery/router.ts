/**
 * Destination router (directive §Destination Router).
 *
 * Registry-driven end to end: destinations are **resolved dynamically** by key, and conditional
 * routing is evaluated by the Engine Kernel over a Registry-owned rule set. There is no switch on
 * platform, no hardcoded provider list and no `if (destination === "meta")` anywhere — a new
 * destination is a registry entry.
 *
 * Tracking does not own the rule set. It receives one through `RuleSetRegistryPort` and executes
 * it; persistence, versioning and lifecycle belong to the Registry Engine.
 */

import { evaluateRuleSet, type RuleSet, type RuleSetEvaluation } from "@platform/rules";

import { evaluateConsent, type ConsentDenial } from "../envelope/consent";
import type { EnrichedEnvelope } from "../envelope/envelope";
import {
  toRoutingContext,
  type DestinationDefinition,
  type DestinationKey,
  type DestinationRegistryPort,
} from "./destination";

/** Registry port for routing rule sets. Tracking resolves and executes; it never stores. */
export interface RuleSetRegistryPort {
  resolve(key: string): RuleSet<DestinationKey> | null;
  resolveVersion(key: string, version: number): RuleSet<DestinationKey> | null;
}

/** Why a destination was excluded — every exclusion is explainable in the inspector. */
export type RoutingExclusionReason =
  | { readonly code: "not_registered" }
  | { readonly code: "disabled" }
  | { readonly code: "consent_denied"; readonly denial: ConsentDenial }
  | { readonly code: "rule_not_matched" };

export interface RoutedDestination {
  readonly destination: DestinationDefinition;
}

export interface ExcludedDestination {
  readonly key: DestinationKey;
  readonly reason: RoutingExclusionReason;
}

export interface RoutingDecision {
  readonly routed: readonly RoutedDestination[];
  readonly excluded: readonly ExcludedDestination[];
  /** Full rule trace, so a merchant can see exactly which rule sent an event where. */
  readonly evaluation: RuleSetEvaluation<DestinationKey>;
  /**
   * True when at least one rule could not be evaluated. The caller must treat a degraded routing
   * decision as incomplete rather than authoritative.
   */
  readonly degraded: boolean;
}

export interface RouteInput {
  readonly envelope: EnrichedEnvelope;
  readonly ruleSet: RuleSet<DestinationKey>;
  readonly destinations: DestinationRegistryPort;
}

/**
 * Resolves the destinations an event should reach.
 *
 * Consent is enforced **here, per destination**, not once globally: a single event may legitimately
 * reach an analytics destination while being blocked from every marketing one, and collapsing that
 * into one decision is how consent leaks happen.
 */
export function route(input: RouteInput): RoutingDecision {
  const context = toRoutingContext(input.envelope);
  const evaluation = evaluateRuleSet(input.ruleSet, context);

  const routed: RoutedDestination[] = [];
  const excluded: ExcludedDestination[] = [];
  const seen = new Set<DestinationKey>();

  for (const key of evaluation.outcomes) {
    if (seen.has(key)) continue;
    seen.add(key);

    const destination = input.destinations.resolve(key);

    if (destination === null) {
      excluded.push({ key, reason: { code: "not_registered" } });
      continue;
    }
    if (!destination.enabled) {
      excluded.push({ key, reason: { code: "disabled" } });
      continue;
    }

    const consent = evaluateConsent(input.envelope.consent, destination.consentPurpose);
    if (!consent.allowed) {
      excluded.push({ key, reason: { code: "consent_denied", denial: consent.denial } });
      continue;
    }

    routed.push({ destination });
  }

  // Rules that were considered but did not match are recorded as exclusions too, so the inspector
  // can answer "why did this event NOT go to Pinterest?" — the most common diagnostic question.
  for (const entry of evaluation.trace) {
    if (entry.status !== "not_matched") continue;
    const key = ruleOutcomeKey(input.ruleSet, entry.ruleId);
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    excluded.push({ key, reason: { code: "rule_not_matched" } });
  }

  return { routed, excluded, evaluation, degraded: evaluation.degraded };
}

function ruleOutcomeKey(
  ruleSet: RuleSet<DestinationKey>,
  ruleId: string,
): DestinationKey | undefined {
  return ruleSet.rules.find((rule) => rule.id === ruleId)?.then;
}
