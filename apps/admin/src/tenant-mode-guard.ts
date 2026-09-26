import type { TenantResolver } from "@platform/http";

/**
 * T10.4 / ADR-0014 Decision point 7 (as widened by Amendment 6): the boot-time assertion that
 * `TENANT_MODE=multi` is actually wired, replacing the flat refusal in `apps/runtime`.
 *
 * Two checks, both run every time and reported together (same shape as `apps/runtime/src/api.ts`'s
 * `assertProduction*` guards — one error naming every failed check):
 *
 *  1. `resolver-chain` — BEHAVIOURAL, not structural. The chain the HTTP surface will actually use
 *     is fed two distinct probe tenants (once as a verified claim, once as the header) and must hand
 *     each back unchanged, and must return `null` for a request that carries no tenant at all. A
 *     pinned resolver (`singleTenantGuardedResolver`) fails the first half; a chain that defaults
 *     fails the second. Probing behaviour means a resolver cannot pass by being labelled correctly.
 *  2. `construction-time-tenant` — walks the composed graph (every repository, adapter, port and
 *     store, Prisma or otherwise — Amendment 6, not just "repositories") and reports every object
 *     that still carries a `tenantId` field. Map/Set contents are data rows, not construction
 *     state, and are not walked.
 *
 * Neither check changes `resolveTenant`, which stays "no default tenant, unresolved is an error".
 */

/**
 * The ONLY context allowed to keep a construction-time tenant under `TENANT_MODE=multi`.
 *
 * Operator decision 2026-09-19. ADR-0014 point 8f: a `Tenant` row is PLATFORM-OPERATOR data, so its
 * scope must be the operator's own — not the tenant the row describes and not a per-request value.
 * That operator identity does not exist yet (points 8a-8d are approved in principle and unbuilt), so
 * `services/tenancy` stays pinned and this assertion would otherwise fail on it.
 *
 * Removing this entry is the work item, not editing it: when 8a-8d land, tenancy reads the
 * operator's fixed scope and this list becomes empty. If you want a SECOND entry, stop — that is a
 * finding to report, not a configuration to add. `tenant-mode-guard.test.ts` fails if this list
 * grows, and the match is on the exact graph key, never a wildcard or a prefix.
 */
export interface TenantPinExemption {
  /** Source location of the context, for humans. */
  readonly context: string;
  /** The exact top-level key of the composed admin graph that this context lives under. */
  readonly graphKey: string;
  readonly reason: string;
}

export const TENANT_PIN_EXEMPTIONS: readonly TenantPinExemption[] = Object.freeze([
  Object.freeze({
    context: "services/tenancy",
    graphKey: "tenancy",
    reason:
      "ADR-0014 point 8f: a Tenant row is platform-operator data, so its scope must be the " +
      "operator's own, and that operator identity (points 8a-8d) does not exist yet. Its routes " +
      "are additionally pinned to the deployment tenant at the HTTP layer under multi mode.",
  }),
]);

const PIN_FIELD = /^(?:_?tenantId|defaultTenantId|pinnedTenantId)$/;

/**
 * Every path in `graph` at which an object carries a construction-time tenant. Paths whose first
 * segment is an exempted graph key are dropped.
 */
export function findConstructionTimeTenants(
  graph: object,
  exemptions: readonly TenantPinExemption[] = TENANT_PIN_EXEMPTIONS,
): string[] {
  const exemptRoots = new Set(exemptions.map((entry) => entry.graphKey));
  const found: string[] = [];
  const seen = new WeakSet<object>();

  const walk = (node: unknown, path: string): void => {
    if (typeof node !== "object" || node === null) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (
      node instanceof Map ||
      node instanceof Set ||
      node instanceof WeakMap ||
      node instanceof WeakSet ||
      node instanceof Date ||
      ArrayBuffer.isView(node)
    ) {
      return;
    }
    for (const key of Object.keys(node)) {
      const value = (node as Record<string, unknown>)[key];
      const childPath = path === "" ? key : `${path}.${key}`;
      if (PIN_FIELD.test(key) && typeof value === "string" && value.length > 0) {
        found.push(childPath);
      } else {
        walk(value, childPath);
      }
    }
  };
  walk(graph, "");

  return found.filter((path) => !exemptRoots.has(path.split(".")[0] ?? ""));
}

const PROBE_TENANTS = ["probe-tenant-a", "probe-tenant-b"] as const;

/** A verified, non-public identity: what a token that carries no `tenant_id` claim looks like. */
const AUTHENTICATED_PROBE_PRINCIPAL = { id: "probe-principal", kind: "staff", roles: [] } as const;

function probeInput(overrides: {
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly claims?: Readonly<Record<string, unknown>> | null;
  readonly authenticated?: boolean;
}): Parameters<TenantResolver>[0] {
  return {
    headers: overrides.headers ?? {},
    hostname: "tenant-probe.invalid",
    principal: overrides.authenticated === true ? AUTHENTICATED_PROBE_PRINCIPAL : null,
    claims: overrides.claims ?? null,
  };
}

function firstHit(resolvers: readonly TenantResolver[], input: Parameters<TenantResolver>[0]) {
  for (const resolver of resolvers) {
    const tenantId = resolver(input);
    if (tenantId !== null) return tenantId;
  }
  return null;
}

function resolverChainFailure(resolvers: readonly TenantResolver[]): string | undefined {
  if (resolvers.length === 0) {
    return "resolver-chain: no tenant resolvers are configured — nothing can resolve a tenant per request.";
  }
  const problems: string[] = [];
  for (const tenant of PROBE_TENANTS) {
    const viaClaim = firstHit(resolvers, probeInput({ claims: { tenant_id: tenant } }));
    const viaHeader = firstHit(resolvers, probeInput({ headers: { "x-tenant-id": tenant } }));
    if (viaClaim !== tenant && viaHeader !== tenant) {
      problems.push(
        `probe tenant "${tenant}" resolved to ${JSON.stringify(viaClaim ?? viaHeader)} ` +
          "(a pinned resolver rejects or rewrites every tenant but its own)",
      );
    }
  }
  const unresolved = firstHit(resolvers, probeInput({}));
  if (unresolved !== null) {
    problems.push(
      `a request carrying no tenant resolved to "${unresolved}" — an unresolved tenant must be ` +
        "null (rejected), never defaulted",
    );
  }
  // G-69: the header is client-controlled, so it may name a tenant only where there is no verified
  // identity. An authenticated principal whose token carries no tenant is bound to none.
  const forged = firstHit(
    resolvers,
    probeInput({
      authenticated: true,
      claims: {},
      headers: { "x-tenant-id": PROBE_TENANTS[0] },
    }),
  );
  if (forged !== null) {
    problems.push(
      `an authenticated principal with no tenant claim resolved to "${forged}" from a client-supplied ` +
        "header (G-69) — the header may only name a tenant for an unauthenticated request",
    );
  }
  // A blank value is "no tenant", not a tenant called "".
  const blank = firstHit(
    resolvers,
    probeInput({ claims: { tenant_id: "   " }, headers: { "x-tenant-id": "   " } }),
  );
  if (blank !== null) {
    problems.push(
      `a blank claim/header resolved to ${JSON.stringify(blank)} — a blank tenant must be null (rejected)`,
    );
  }
  if (problems.length === 0) return undefined;
  return `resolver-chain: the configured chain is not a real per-request resolver — ${problems.join("; ")}.`;
}

export interface MultiTenantReadinessInput {
  /** The chain the HTTP surface will actually be built with. */
  readonly resolvers: readonly TenantResolver[];
  /** The composed graph (`wireAdmin`'s result). */
  readonly graph: object;
  /** Defaults to {@link TENANT_PIN_EXEMPTIONS}; overridable only so tests can prove the exemption bites. */
  readonly exemptions?: readonly TenantPinExemption[];
}

/** One message per failed check; empty ⇒ ready. */
export function collectMultiTenantFailures(input: MultiTenantReadinessInput): string[] {
  const failures: string[] = [];
  const chain = resolverChainFailure(input.resolvers);
  if (chain !== undefined) failures.push(chain);
  const pins = findConstructionTimeTenants(input.graph, input.exemptions ?? TENANT_PIN_EXEMPTIONS);
  if (pins.length > 0) {
    failures.push(
      "construction-time-tenant: these objects in the composed graph still carry a tenantId " +
        `fixed at construction (ADR-0014 point 7 / Amendment 6): ${pins.join(", ")}.`,
    );
  }
  return failures;
}

/** Throws one error naming every failed check; returns normally only when multi mode is really wired. */
export function assertMultiTenantReady(input: MultiTenantReadinessInput): void {
  const failures = collectMultiTenantFailures(input);
  if (failures.length === 0) return;
  throw new Error(
    `admin: refusing to boot with TENANT_MODE=multi — ${failures.length} check` +
      `${failures.length === 1 ? "" : "s"} failed:\n\n` +
      failures.map((message, index) => `${index + 1}. ${message}`).join("\n\n"),
  );
}
