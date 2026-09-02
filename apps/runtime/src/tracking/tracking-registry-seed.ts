/**
 * Registry seeding (M6.6.2).
 *
 * `SEED_DESTINATIONS` and `SEED_MAPPING_PROFILES` are exactly what their names say: seed values, a
 * starting point for an operator. They were never a registry. This module is the one-way door
 * between them — it writes them into the durable registry once, after which the Registry owns them
 * and an operator may version, deprecate or roll them back with no deployment.
 *
 * Seeding is a deliberate, explicit operation, **not** something boot does when it finds the
 * registry empty. An automatic seed-on-empty would silently resurrect nine advertising destinations
 * against a tenant whose operator had deliberately retired them — for instance after a restore from
 * a backup taken before the retirement. The registry loader fails closed on an empty registry
 * instead, and this runs on purpose.
 */

import { Expr } from "@platform/expression";
import type { Rule, RuleSet } from "@platform/rules";
import {
  SEED_DESTINATIONS,
  SEED_MAPPING_PROFILES,
  SEED_PROFILE_KEYS,
  type DestinationKey,
} from "@platform/tracking";

import type { PrismaTrackingRegistryStore } from "./tracking-registry";

/** Registry key of the routing rule set the ingest runtime resolves. */
export const DEFAULT_RULE_SET_KEY = "tracking.routing.default";

/**
 * The starting routing policy.
 *
 * Deliberately narrow: commerce events only, one rule per destination, `all_matches` so an event
 * fans out to every destination whose rule matches. It is **not** an attempt to guess a merchant's
 * marketing strategy — that is theirs to author, and every rule here is editable in the registry
 * without a deployment.
 *
 * Two things it does not do, because other layers already do them and duplicating a gate is how the
 * two copies drift apart:
 *
 * - It does not check consent. `route()` enforces consent per destination, against that
 *   destination's declared purpose, which is stricter than anything a rule could express here.
 * - It does not check environment. The ingest runtime refuses non-production events outright, so a
 *   rule permitting one would be unreachable and misleading.
 */
export function defaultRoutingRuleSet(
  destinations: readonly { readonly key: DestinationKey }[] = SEED_DESTINATIONS,
): RuleSet<DestinationKey> {
  const rules: Rule<DestinationKey>[] = destinations.map((destination, index) => ({
    id: `route.${destination.key}`,
    priority: index + 1,
    when: Expr.where("event.category", "eq", "commerce"),
    then: destination.key,
    description: `Forward commerce events to ${destination.key}`,
  }));

  return {
    id: DEFAULT_RULE_SET_KEY,
    version: 1,
    mode: "all_matches",
    rules,
    // Explicit rather than relying on the default: a routing rule that cannot be evaluated must not
    // read as "no match", which would silently stop forwarding to that destination.
    onError: "fail_closed",
  };
}

export interface SeedResult {
  readonly destinations: number;
  readonly mappings: number;
  readonly ruleSets: number;
}

/**
 * Writes the seed definitions as version 1 of each key.
 *
 * Refuses to run against a non-empty registry. Appending version 1 again would collide on the
 * unique constraint anyway; failing first gives the operator the real reason rather than a
 * constraint violation, and prevents a partial write that leaves destinations seeded and mappings
 * missing — a state in which every event renders no payload and is recorded as `blocked`.
 */
export async function seedTrackingRegistry(input: {
  readonly store: PrismaTrackingRegistryStore;
  readonly tenantId: string;
  readonly at: Date;
}): Promise<SeedResult> {
  const existing = await input.store.count(input.tenantId);
  if (existing > 0) {
    throw new Error(
      `tracking: registry for tenant "${input.tenantId}" already holds ${String(existing)} ` +
        `definition(s) — seeding would duplicate them; register new versions instead`,
    );
  }

  // Integrity check before any write: a destination whose mapping profile is absent renders no
  // payload, so it would be recorded as blocked for every event. Caught here, where it is a typo,
  // rather than in production, where it is a silent forwarding outage.
  for (const destination of SEED_DESTINATIONS) {
    if (!SEED_PROFILE_KEYS.includes(destination.mappingProfileKey)) {
      throw new Error(
        `tracking: destination "${destination.key}" references unknown mapping profile ` +
          `"${destination.mappingProfileKey}"`,
      );
    }
  }

  for (const mapping of SEED_MAPPING_PROFILES) {
    await input.store.append({
      tenantId: input.tenantId,
      kind: "mapping",
      key: mapping.key,
      version: 1,
      status: "active",
      value: mapping,
      at: input.at,
    });
  }

  for (const destination of SEED_DESTINATIONS) {
    await input.store.append({
      tenantId: input.tenantId,
      kind: "destination",
      key: destination.key,
      version: 1,
      status: "active",
      value: destination,
      at: input.at,
    });
  }

  await input.store.append({
    tenantId: input.tenantId,
    kind: "rule_set",
    key: DEFAULT_RULE_SET_KEY,
    version: 1,
    status: "active",
    value: defaultRoutingRuleSet(),
    at: input.at,
  });

  return {
    destinations: SEED_DESTINATIONS.length,
    mappings: SEED_MAPPING_PROFILES.length,
    ruleSets: 1,
  };
}
