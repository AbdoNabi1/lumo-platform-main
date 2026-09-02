import type {
  DecisionTrace,
  EnforcementTarget,
  EntitlementExplanation,
  EntitlementGuard,
  EntitlementRequest,
  SimulationResult,
} from "@platform/entitlement";
import { err, ok, type Result } from "@platform/types";
import { AuthorizationError, type DomainError } from "@platform/utils";

/**
 * The single enforcement seam (P1.3 §1) every surface composes — REST, GraphQL, jobs, workflows, CLI, SDK,
 * marketplace, AI, scheduled tasks and admin commands. It holds no logic of its own: it delegates to the one frozen
 * {@link EntitlementGuard} via `enforce(target, …)`, so there is exactly one guard and no duplicated enforcement.
 */
export class EntitlementMiddleware {
  constructor(private readonly guard: EntitlementGuard) {}

  /** REST/API surface (§ transport). */
  api<T>(
    request: EntitlementRequest,
    run: () => Promise<Result<T, DomainError>>,
  ): Promise<Result<T, DomainError>> {
    return this.guard.enforce("api", request, run);
  }

  /** GraphQL resolvers. */
  graphql<T>(
    request: EntitlementRequest,
    run: () => Promise<Result<T, DomainError>>,
  ): Promise<Result<T, DomainError>> {
    return this.guard.enforce("graphql", request, run);
  }

  /** Background jobs (§15 workers). */
  job<T>(
    request: EntitlementRequest,
    run: () => Promise<Result<T, DomainError>>,
  ): Promise<Result<T, DomainError>> {
    return this.guard.enforce("background_job", request, run);
  }

  /** Workflow activities — evaluated before execution (§14). */
  workflow<T>(
    request: EntitlementRequest,
    run: () => Promise<Result<T, DomainError>>,
  ): Promise<Result<T, DomainError>> {
    return this.guard.enforce("workflow", request, run);
  }

  /** Scheduled tasks — evaluated before execution (§15). */
  scheduled<T>(
    request: EntitlementRequest,
    run: () => Promise<Result<T, DomainError>>,
  ): Promise<Result<T, DomainError>> {
    return this.guard.enforce("scheduled_task", request, run);
  }

  /** CLI commands — evaluated before execution (§16). */
  cli<T>(
    request: EntitlementRequest,
    run: () => Promise<Result<T, DomainError>>,
  ): Promise<Result<T, DomainError>> {
    return this.guard.enforce("cli", request, run);
  }

  /** Marketplace extensions/plugins — no bypass (§12). */
  marketplace<T>(
    request: EntitlementRequest,
    run: () => Promise<Result<T, DomainError>>,
  ): Promise<Result<T, DomainError>> {
    return this.guard.enforce("marketplace_operation", request, run);
  }

  /** AI agents — never bypass; also expose `simulate()`/`why()` via the guard (§13). */
  ai<T>(
    request: EntitlementRequest,
    run: () => Promise<Result<T, DomainError>>,
  ): Promise<Result<T, DomainError>> {
    return this.guard.enforce("ai_request", request, run);
  }

  /**
   * Admin commands (§17) — require **both** RBAC and entitlement. `authorized` is the RBAC verdict (from the admin
   * `AccessControl` guard); the command runs only when RBAC allows **and** the feature is entitled. Fail-closed: a
   * false RBAC verdict denies before entitlement is even consulted.
   */
  async admin<T>(
    request: EntitlementRequest,
    authorized: boolean,
    run: () => Promise<Result<T, DomainError>>,
  ): Promise<Result<T, DomainError>> {
    if (!authorized)
      return err(
        new AuthorizationError("RBAC denied", {
          context: { featureKey: request.featureKey, target: "admin_action" },
        }),
      );
    return this.guard.enforce("admin_action", request, run);
  }

  /* --------- non-mutating read surface, shared by SDK / AI / Marketplace / Workflow design-time --------- */

  can(request: EntitlementRequest): Promise<boolean> {
    return this.guard.can(request);
  }
  why(request: EntitlementRequest): Promise<EntitlementExplanation> {
    return this.guard.why(request);
  }
  trace(request: EntitlementRequest): Promise<DecisionTrace> {
    return this.guard.trace(request);
  }
  simulate(
    request: EntitlementRequest,
    target: EnforcementTarget = "command",
  ): Promise<SimulationResult> {
    return this.guard.simulate(request, target);
  }
}

/** A tiny ok/err helper re-export so surfaces need not import `@platform/types` directly for guarded results. */
export { ok, err };
