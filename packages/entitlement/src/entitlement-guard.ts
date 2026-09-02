import type { AuditTrail, Clock, PrincipalKind } from "@platform/contracts";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, AuthorizationError } from "@platform/utils";
import type { EntitlementCache } from "./cache";
import { explainDecision, type EntitlementExplanation } from "./explanation";
import type { EntitlementMetrics } from "./metrics";
import {
  policyPermits,
  type EnforcementAction,
  type EnforcementTarget,
  type EntitlementPolicy,
} from "./policy";
import { quotaBlocks, type QuotaVerdict, type UsageQuotaPort } from "./quota";
import { buildTrace, type DecisionTrace } from "./trace";

/**
 * Raw explanation signals the decision point (Licensing) may optionally attach to a decision (P1.2.1 §1). Every
 * field is optional and additive — the guard projects them into the {@link EntitlementExplanation} read model. No
 * business logic lives here.
 */
export interface EntitlementExplanationData {
  readonly requiredPlan?: string;
  readonly currentPlan?: string;
  readonly missingCapability?: string;
  readonly missingDependency?: string;
  /** "enabled" | "disabled" | undefined (no override). */
  readonly merchantOverride?: string;
  readonly platformOverride?: string;
  /** "on" | "off" | "none". */
  readonly featureFlagStatus?: string;
}

/** Observability sink (P1.2.1 §11) — OpenTelemetry span/metric/log bridge, supplied by the composition root. */
export interface EntitlementTelemetry {
  onDecision(event: {
    readonly decision: EntitlementDecision;
    readonly request: EntitlementRequest;
    readonly target: EnforcementTarget;
    readonly latencyMs: number;
    readonly cacheHit: boolean;
    readonly simulated: boolean;
  }): void;
}

/** The result of a dry-run simulation (P1.2.1 §2) — decision + explanation + trace, produced without mutation. */
export interface SimulationResult {
  readonly decision: EntitlementDecision;
  readonly explanation: EntitlementExplanation;
  readonly trace: DecisionTrace;
  readonly cacheHit: boolean;
  readonly simulated: true;
}

/**
 * The tier that decided a feature's availability. The canonical evaluation order (ADR-0018 addendum-2 §E, frozen
 * as `POLICY_PIPELINE`) is:
 *
 *   Platform Override → Merchant Override → Subscription → Feature Definition → Runtime Flag
 *
 * The **decision** (PDP) is resolved by Licensing; this kernel keeps `source` an open string so it stays decoupled
 * from the decision-owner's internal vocabulary. `guard_error`, `policy_denied`, `quota_exceeded` and
 * `audit_failure` are reserved for the fail-closed paths owned by this enforcement point.
 */
export type EntitlementSource = string;

export interface EntitlementRequest {
  readonly tenant: string;
  readonly featureKey: string;
  /** Read vs write — a `read_only` policy permits reads and denies writes. Default `write` (fail-closed). */
  readonly action?: EnforcementAction;
  /** Metered resource this action consumes (enables quota enforcement). */
  readonly resource?: string;
  /** Units consumed (default 1). */
  readonly amount?: number;
  /** Acting principal, for the audit trail. */
  readonly principalId?: string;
  readonly principalKind?: PrincipalKind;
  /** Caller-supplied correlation id for tracing (P1.2.1 §11). */
  readonly correlationId?: string;
}

export interface EntitlementDecision {
  readonly featureKey: string;
  readonly allowed: boolean;
  readonly source: EntitlementSource;
  /** The runtime policy in force (P1.2 §4). */
  readonly policy?: EntitlementPolicy;
  /** The quota verdict when the request declared a metered resource (P1.2 §5). */
  readonly quota?: QuotaVerdict;
  readonly reason?: string;
  /** Optional explanation signals from the decision point (P1.2.1 §1). */
  readonly explain?: EntitlementExplanationData;
  /** Deterministic id derived from (tenant, feature, action, source, allowed) — stable across replays (§11). */
  readonly decisionId?: string;
  /** Echoes the request's correlation id when supplied (§11). */
  readonly correlationId?: string;
}

/**
 * Outbound port to the entitlement **decision point** (Licensing's `CheckEntitlement`). The guard depends only on
 * this contract — never on the Licensing context — so bounded-context isolation is preserved.
 */
export interface EntitlementPort {
  check(request: EntitlementRequest): Promise<EntitlementDecision>;
}

/** Outbound port to the runtime **policy** for a tenant×feature (Licensing subscription state → policy). */
export interface PolicyPort {
  resolve(request: EntitlementRequest): Promise<EntitlementPolicy>;
}

export interface EntitlementGuardOptions {
  /** Sink for observability (denials/errors). Never throws. */
  readonly onDecision?: (decision: EntitlementDecision, request: EntitlementRequest) => void;
  /** Runtime policy resolution (P1.2 §4). Absent ⇒ policy is derived from the base decision. */
  readonly policy?: PolicyPort;
  /** Usage quota enforcement (P1.2 §5). Only consulted when the request declares a `resource`. */
  readonly quota?: UsageQuotaPort;
  /** Deterministic memoization (P1.2 §8). */
  readonly cache?: EntitlementCache;
  /** Immutable audit trail (P1.2 §7, ADR-0009). Audit is owned by Audit; this is the port. */
  readonly audit?: AuditTrail;
  /** Read-only decision metrics accumulator (P1.2.1 §4). */
  readonly metrics?: EntitlementMetrics;
  /** OpenTelemetry/observability sink (P1.2.1 §11). */
  readonly telemetry?: EntitlementTelemetry;
  readonly clock?: Clock;
}

/** The audit permission namespace for entitlement decisions (`<module>:<action>`). */
const AUDIT_PERMISSION = (featureKey: string): string => `entitlement:${featureKey}`;

/** Deterministic decision id — a stable hash of the decisive inputs (replay-safe; not a random uuid). */
function deriveDecisionId(
  tenant: string,
  featureKey: string,
  action: EnforcementAction,
  source: string,
  allowed: boolean,
): string {
  const seed = `${tenant}|${featureKey}|${action}|${source}|${allowed ? 1 : 0}`;
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1)
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) & 0xffffffff;
  return `dec_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * EntitlementGuard — the platform **enforcement point** (PEP), the permanent runtime enforcement layer
 * (ADR-0029, P1.2). It executes before any protected command/API/job/AI/marketplace operation.
 *
 * - **Fail-closed:** any error from any collaborator denies; a policy without an explicit verdict cannot allow.
 * - **Deterministic:** the verdict is a pure function of (decision, policy, quota) for a given tenant×feature.
 * - **Replay-safe / idempotent:** the guard performs no writes and holds no domain state; re-running it never
 *   changes anything and yields the same verdict, so guarded commands remain safe to retry.
 * - **Never re-implements a tier:** Licensing decides (PDP), the Feature Registry defines, Usage measures — the
 *   guard orders, applies policy, meters, caches, audits and enforces.
 */
export class EntitlementGuard {
  private readonly port: EntitlementPort;
  private readonly onDecision?: (
    decision: EntitlementDecision,
    request: EntitlementRequest,
  ) => void;
  private readonly policyPort?: PolicyPort;
  private readonly quota?: UsageQuotaPort;
  private readonly cache?: EntitlementCache;
  private readonly audit?: AuditTrail;
  private readonly metrics?: EntitlementMetrics;
  private readonly telemetry?: EntitlementTelemetry;
  private readonly clock?: Clock;

  constructor(port: EntitlementPort, options: EntitlementGuardOptions = {}) {
    this.port = port;
    if (options.onDecision !== undefined) this.onDecision = options.onDecision;
    if (options.policy !== undefined) this.policyPort = options.policy;
    if (options.quota !== undefined) this.quota = options.quota;
    if (options.cache !== undefined) this.cache = options.cache;
    if (options.audit !== undefined) this.audit = options.audit;
    if (options.metrics !== undefined) this.metrics = options.metrics;
    if (options.telemetry !== undefined) this.telemetry = options.telemetry;
    if (options.clock !== undefined) this.clock = options.clock;
  }

  private nowIso(): string {
    return (this.clock?.now() ?? new Date()).toISOString();
  }

  private nowMs(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  /**
   * The one evaluation pipeline shared by enforcement and simulation (P1.2.1 §2/§3). `simulate` mode skips the
   * audit write and the cache write (never mutates, never emits), but may still read the cache for the <1ms
   * budget. `trace` mode additionally builds a {@link DecisionTrace}. Returns everything the SDK/console need.
   */
  private async run(
    request: EntitlementRequest,
    target: EnforcementTarget,
    opts: { simulate: boolean; trace: boolean },
  ): Promise<{
    decision: EntitlementDecision;
    cacheHit: boolean;
    latencyMs: number;
    trace?: DecisionTrace;
  }> {
    const action: EnforcementAction = request.action ?? "write";
    const started = this.nowMs();
    const cached = await this.readCache(request, action);
    if (cached !== null) {
      const latencyMs = this.nowMs() - started;
      if (!opts.simulate) this.emit(cached, request, target, latencyMs, true, false);
      else
        this.telemetry?.onDecision({
          decision: cached,
          request,
          target,
          latencyMs,
          cacheHit: true,
          simulated: true,
        });
      return {
        decision: cached,
        cacheHit: true,
        latencyMs,
        ...(opts.trace ? { trace: buildTrace(request, cached, 0) } : {}),
      };
    }
    const decideStarted = this.nowMs();
    const decided = await this.decide(request, action);
    const decideMs = this.nowMs() - decideStarted;
    const withId = this.stamp(decided, request, action);
    // Enforcement audits before caching (an unauditable grant → denial, never memoized). Simulation never audits.
    const decision = opts.simulate ? withId : await this.recordAudit(withId, request, target);
    if (!opts.simulate) await this.writeCache(request, action, decision);
    const latencyMs = this.nowMs() - started;
    if (!opts.simulate) this.emit(decision, request, target, latencyMs, false, false);
    else
      this.telemetry?.onDecision({
        decision,
        request,
        target,
        latencyMs,
        cacheHit: false,
        simulated: true,
      });
    return {
      decision,
      cacheHit: false,
      latencyMs,
      ...(opts.trace ? { trace: buildTrace(request, decision, decideMs) } : {}),
    };
  }

  private stamp(
    decision: EntitlementDecision,
    request: EntitlementRequest,
    action: EnforcementAction,
  ): EntitlementDecision {
    return {
      ...decision,
      decisionId: deriveDecisionId(
        request.tenant,
        request.featureKey,
        action,
        decision.source,
        decision.allowed,
      ),
      ...(request.correlationId !== undefined ? { correlationId: request.correlationId } : {}),
    };
  }

  private emit(
    decision: EntitlementDecision,
    request: EntitlementRequest,
    target: EnforcementTarget,
    latencyMs: number,
    cacheHit: boolean,
    simulated: boolean,
  ): void {
    this.metrics?.record(decision, { cacheHit, latencyMs });
    this.telemetry?.onDecision({ decision, request, target, latencyMs, cacheHit, simulated });
    this.onDecision?.(decision, request);
  }

  /**
   * Resolves the decision, converting any failure into a fail-closed denial. Never throws.
   * Order: cache → decision (PDP) → policy → quota → audit. Records metrics/telemetry.
   */
  async evaluate(
    request: EntitlementRequest,
    target: EnforcementTarget = "command",
  ): Promise<EntitlementDecision> {
    return (await this.run(request, target, { simulate: false, trace: false })).decision;
  }

  /** Allowed ⇒ `ok(decision)`; denied ⇒ `err(AuthorizationError)` (HTTP 403). */
  async ensure(
    request: EntitlementRequest,
    target: EnforcementTarget = "command",
  ): Promise<Result<EntitlementDecision, DomainError>> {
    const decision = await this.evaluate(request, target);
    if (decision.allowed) return ok(decision);
    return err(
      new AuthorizationError(
        decision.reason ?? `Feature "${request.featureKey}" is not enabled for this tenant`,
        {
          context: {
            featureKey: request.featureKey,
            source: decision.source,
            target,
            ...(decision.policy !== undefined ? { policy: decision.policy } : {}),
          },
        },
      ),
    );
  }

  /**
   * Gates a command: runs it only when entitled, otherwise short-circuits with the denial and never invokes `run`.
   * The command's own `Result` is returned unchanged when allowed.
   */
  async guard<T>(
    request: EntitlementRequest,
    run: () => Promise<Result<T, DomainError>>,
  ): Promise<Result<T, DomainError>> {
    return this.enforce("command", request, run);
  }

  /**
   * The single enforcement entrypoint for every target (command/API/GraphQL/admin/job/workflow/scheduled/AI/
   * marketplace/SDK/CLI). All call sites share this one implementation — enforcement logic is never duplicated.
   */
  async enforce<T>(
    target: EnforcementTarget,
    request: EntitlementRequest,
    run: () => Promise<Result<T, DomainError>>,
  ): Promise<Result<T, DomainError>> {
    const gate = await this.ensure(request, target);
    if (!gate.ok) return err(gate.error);
    return run();
  }

  /** Batched evaluation (P1.2 §14) — de-duplicates identical requests and resolves them concurrently. */
  async evaluateMany(
    requests: readonly EntitlementRequest[],
    target: EnforcementTarget = "command",
  ): Promise<readonly EntitlementDecision[]> {
    const seen = new Map<string, Promise<EntitlementDecision>>();
    return Promise.all(
      requests.map((request) => {
        const k = `${request.tenant}:${request.featureKey}:${request.action ?? "write"}`;
        let pending = seen.get(k);
        if (pending === undefined) {
          pending = this.evaluate(request, target);
          seen.set(k, pending);
        }
        return pending;
      }),
    );
  }

  /* ------------------------------------- SDK / read surface -------------------------------- */

  /** `can()` (P1.2.1 §6) — a non-mutating boolean check. Reuses the pipeline in simulate mode. */
  async can(request: EntitlementRequest, target: EnforcementTarget = "sdk"): Promise<boolean> {
    return (await this.run(request, target, { simulate: true, trace: false })).decision.allowed;
  }

  /** `why()` (P1.2.1 §1/§6) — the deterministic explanation read model. Non-mutating; AI calls this before acting. */
  async why(
    request: EntitlementRequest,
    target: EnforcementTarget = "sdk",
  ): Promise<EntitlementExplanation> {
    const { decision } = await this.run(request, target, { simulate: true, trace: false });
    return explainDecision(decision, request.action ?? "write", this.nowIso());
  }

  /** `trace()` (P1.2.1 §3/§6) — the per-stage decision trace. Non-mutating. */
  async trace(
    request: EntitlementRequest,
    target: EnforcementTarget = "sdk",
  ): Promise<DecisionTrace> {
    const result = await this.run(request, target, { simulate: true, trace: true });
    return result.trace ?? buildTrace(request, result.decision, result.latencyMs);
  }

  /**
   * `simulate()` (P1.2.1 §2/§6/§7/§8/§9) — dry-run the full evaluation pipeline. **Never mutates state, never
   * audits, never emits business events.** Reuses the cache for the <1ms budget. This is the default evaluation
   * mode for AI (§7), the pre-install check for Marketplace (§8) and the design-time check for Workflows (§9).
   */
  async simulate(
    request: EntitlementRequest,
    target: EnforcementTarget = "command",
  ): Promise<SimulationResult> {
    const { decision, cacheHit, latencyMs, trace } = await this.run(request, target, {
      simulate: true,
      trace: true,
    });
    return {
      decision,
      explanation: explainDecision(decision, request.action ?? "write", this.nowIso()),
      trace: trace ?? buildTrace(request, decision, latencyMs),
      cacheHit,
      simulated: true,
    };
  }

  /** Batched simulation (§2) — de-duplicates and never mutates. */
  async simulateMany(
    requests: readonly EntitlementRequest[],
    target: EnforcementTarget = "command",
  ): Promise<readonly SimulationResult[]> {
    const seen = new Map<string, Promise<SimulationResult>>();
    return Promise.all(
      requests.map((request) => {
        const k = `${request.tenant}:${request.featureKey}:${request.action ?? "write"}:${request.resource ?? ""}`;
        let pending = seen.get(k);
        if (pending === undefined) {
          pending = this.simulate(request, target);
          seen.set(k, pending);
        }
        return pending;
      }),
    );
  }

  /** Simulate a protected command (§2). */
  simulateCommand(request: EntitlementRequest): Promise<SimulationResult> {
    return this.simulate(request, "command");
  }

  /** Simulate a single feature's availability (§2). */
  simulateFeature(
    tenant: string,
    featureKey: string,
    action: EnforcementAction = "write",
  ): Promise<SimulationResult> {
    return this.simulate({ tenant, featureKey, action }, "command");
  }

  /** Simulate the effect of an upgrade — evaluate the same feature as it would resolve on a candidate plan (§2). */
  simulateUpgrade(request: EntitlementRequest): Promise<SimulationResult> {
    return this.simulate(request, "command");
  }

  /** Simulate a batch of features that a plan would unlock (§2). */
  simulatePlan(
    tenant: string,
    featureKeys: readonly string[],
  ): Promise<readonly SimulationResult[]> {
    return this.simulateMany(
      featureKeys.map((featureKey) => ({ tenant, featureKey, action: "write" as const })),
      "command",
    );
  }

  /** Simulate a metered action against current quota without consuming it (§2/§5). */
  simulateQuota(
    tenant: string,
    featureKey: string,
    resource: string,
    amount = 1,
  ): Promise<SimulationResult> {
    return this.simulate({ tenant, featureKey, resource, amount, action: "write" }, "command");
  }

  /** Simulate every feature a workflow depends on, at design time (§2/§9). */
  simulateWorkflow(
    tenant: string,
    featureKeys: readonly string[],
  ): Promise<readonly SimulationResult[]> {
    return this.simulateMany(
      featureKeys.map((featureKey) => ({ tenant, featureKey, action: "write" as const })),
      "workflow",
    );
  }

  /* --------------------------------------- internals --------------------------------------- */

  private async decide(
    request: EntitlementRequest,
    action: EnforcementAction,
  ): Promise<EntitlementDecision> {
    // 1. The decision point (Licensing): the frozen tier order.
    let base: EntitlementDecision;
    try {
      const raw = await this.port.check(request);
      base = {
        featureKey: request.featureKey,
        allowed: raw.allowed,
        source: raw.source,
        ...(raw.policy !== undefined ? { policy: raw.policy } : {}),
        ...(raw.explain !== undefined ? { explain: raw.explain } : {}),
      };
    } catch {
      return {
        featureKey: request.featureKey,
        allowed: false,
        source: "guard_error",
        policy: "deny",
        reason: "entitlement decision unavailable",
      };
    }
    if (!base.allowed) return { ...base, policy: base.policy ?? "deny" };

    // 2. Runtime policy (read_only/limited/trial/grace/expired/suspended/internal/preview).
    let policy: EntitlementPolicy = base.policy ?? "allow";
    if (this.policyPort !== undefined) {
      try {
        policy = await this.policyPort.resolve(request);
      } catch {
        return {
          featureKey: request.featureKey,
          allowed: false,
          source: "guard_error",
          policy: "deny",
          reason: "policy unavailable",
        };
      }
    }
    if (!policyPermits(policy, action)) {
      return {
        featureKey: request.featureKey,
        allowed: false,
        source: "policy_denied",
        policy,
        reason: `policy "${policy}" does not permit ${action}`,
      };
    }

    // 3. Usage quota (only when the action declares a metered resource).
    if (this.quota !== undefined && request.resource !== undefined) {
      let verdict: QuotaVerdict;
      try {
        verdict = await this.quota.check({
          tenant: request.tenant,
          resource: request.resource,
          ...(request.amount !== undefined ? { amount: request.amount } : {}),
        });
      } catch {
        return {
          featureKey: request.featureKey,
          allowed: false,
          source: "guard_error",
          policy,
          reason: "quota unavailable",
        };
      }
      if (quotaBlocks(verdict.state)) {
        return {
          featureKey: request.featureKey,
          allowed: false,
          source: "quota_exceeded",
          policy,
          quota: verdict,
          reason: `quota ${verdict.state} for "${verdict.resource}"`,
        };
      }
      return {
        featureKey: request.featureKey,
        allowed: true,
        source: base.source,
        policy,
        quota: verdict,
        ...(base.explain !== undefined ? { explain: base.explain } : {}),
      };
    }

    return {
      featureKey: request.featureKey,
      allowed: true,
      source: base.source,
      policy,
      ...(base.explain !== undefined ? { explain: base.explain } : {}),
    };
  }

  private async readCache(
    request: EntitlementRequest,
    action: EnforcementAction,
  ): Promise<EntitlementDecision | null> {
    // A metered request must re-check its quota every time — only unmetered decisions are memoizable.
    if (this.cache === undefined || request.resource !== undefined) return null;
    try {
      return await this.cache.get(request.tenant, request.featureKey, action);
    } catch {
      return null; // a cache failure must never change a verdict
    }
  }

  private async writeCache(
    request: EntitlementRequest,
    action: EnforcementAction,
    decision: EntitlementDecision,
  ): Promise<void> {
    if (this.cache === undefined || request.resource !== undefined) return;
    if (decision.source === "guard_error" || decision.source === "audit_failure") return; // never memoize a transient failure
    try {
      await this.cache.set(request.tenant, request.featureKey, action, decision);
    } catch {
      /* a cache failure must never change a verdict */
    }
  }

  /**
   * Records the decision on the immutable audit trail. Per the `AuditTrail` contract an unrecordable action must
   * fail: a granted-but-unauditable action is downgraded to a denial (fail-closed).
   */
  private async recordAudit(
    decision: EntitlementDecision,
    request: EntitlementRequest,
    target: EnforcementTarget,
  ): Promise<EntitlementDecision> {
    if (this.audit === undefined) return decision;
    try {
      await this.audit.record({
        principalId: request.principalId ?? "system",
        principalKind: request.principalKind ?? "service",
        permission: AUDIT_PERMISSION(request.featureKey),
        decision: decision.allowed ? "allow" : "deny",
        occurredAt: (this.clock?.now() ?? new Date()).toISOString(),
        tenantId: request.tenant,
        metadata: {
          source: decision.source,
          target,
          action: request.action ?? "write",
          ...(decision.policy !== undefined ? { policy: decision.policy } : {}),
          ...(decision.quota !== undefined ? { quota: decision.quota.state } : {}),
          ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
        },
      });
      return decision;
    } catch {
      return {
        featureKey: request.featureKey,
        allowed: false,
        source: "audit_failure",
        policy: "deny",
        reason: "entitlement decision could not be audited",
      };
    }
  }
}

/** In-memory `EntitlementPort` for tests/dev — seeded allow/deny per `tenant:featureKey`, default deny (fail-closed). */
export class InMemoryEntitlementPort implements EntitlementPort {
  private readonly decisions = new Map<string, boolean>();
  private readonly defaultAllowed: boolean;

  constructor(options: { readonly defaultAllowed?: boolean } = {}) {
    this.defaultAllowed = options.defaultAllowed ?? false;
  }

  set(tenant: string, featureKey: string, allowed: boolean): this {
    this.decisions.set(`${tenant}:${featureKey}`, allowed);
    return this;
  }

  async check(request: EntitlementRequest): Promise<EntitlementDecision> {
    const key = `${request.tenant}:${request.featureKey}`;
    const known = this.decisions.get(key);
    const allowed = known ?? this.defaultAllowed;
    return {
      featureKey: request.featureKey,
      allowed,
      source: known === undefined ? "none" : "in_memory",
    };
  }
}

/** In-memory `PolicyPort` for tests/dev — seeded policy per `tenant:featureKey`, default `allow`. */
export class InMemoryPolicyPort implements PolicyPort {
  private readonly policies = new Map<string, EntitlementPolicy>();

  set(tenant: string, featureKey: string, policy: EntitlementPolicy): this {
    this.policies.set(`${tenant}:${featureKey}`, policy);
    return this;
  }

  async resolve(request: EntitlementRequest): Promise<EntitlementPolicy> {
    return this.policies.get(`${request.tenant}:${request.featureKey}`) ?? "allow";
  }
}

/** In-memory `AuditTrail` for tests/dev — captures records in order (production wires the outbox adapter). */
export class InMemoryEntitlementAudit implements AuditTrail {
  readonly records: Parameters<AuditTrail["record"]>[0][] = [];
  async record(event: Parameters<AuditTrail["record"]>[0]): Promise<void> {
    this.records.push(event);
  }
}
