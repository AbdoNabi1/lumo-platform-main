import type { Permission, Principal } from "@platform/contracts";
import type { GuardRequestContext, PermissionGuard, TransportResponse } from "@platform/http";
import type { EdgeRequest, EdgeZeroTrustEvaluator } from "./edge-zero-trust";
import type { SecurityPropagationContext } from "./security-context-propagation";

/**
 * Composition-layer **security middleware** for `@platform/http` (H-4 / G-SEC-3). These bind the Security
 * context's zero-trust decision into the HTTP edge **by composition only** — no service-to-service import:
 * the app injects the wired evaluator/checkers. {@link SecurityPermissionGuard} satisfies the framework's
 * existing `PermissionGuard` seam (so it drops into `createHttpServer` as *the* authorization point), and
 * the named middleware factories (authentication / authorization / policy / AI governance) produce
 * framework-agnostic decision functions for edge/gateway pipelines. Every decision is made by the context;
 * the middleware only maps it to an HTTP outcome.
 */
export interface MiddlewareResult {
  readonly allowed: boolean;
  /** HTTP status to enforce: 200 allow · 401 authn/step-up · 403 deny. */
  readonly status: number;
  readonly code: string;
  readonly reasons: readonly string[];
}

const ALLOW: MiddlewareResult = { allowed: true, status: 200, code: "OK", reasons: [] };

/**
 * The security **authorization** guard — the `@platform/http` policy-enforcement seam. Reuses the edge
 * zero-trust evaluator (which reuses `EvaluateAccess`); returns `null` to allow, or a `TransportResponse`
 * (403 deny / 401 step-up) to short-circuit. This is the ONE authorization point when mounted.
 */
export class SecurityPermissionGuard implements PermissionGuard {
  constructor(private readonly evaluator: EdgeZeroTrustEvaluator) {}

  async ensure(
    principal: Principal,
    permission: Permission,
    context?: GuardRequestContext,
  ): Promise<TransportResponse | null> {
    // The transport resolves the tenant before any guard runs; a guard invoked without one fails closed.
    if (context?.tenantId === undefined) {
      return {
        status: 403,
        body: {
          code: "FORBIDDEN",
          message: "Access denied: no tenant resolved for this request",
          retryable: false,
          fields: [],
          reasons: ["no tenant resolved"],
        },
      };
    }
    const request: EdgeRequest = {
      tenantId: context.tenantId,
      principalId: principal.id,
      permission,
      ...(context?.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
      ...(context?.ip !== undefined ? { ip: context.ip } : {}),
      ...(context?.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
      ...(context?.deviceRef !== undefined ? { deviceRef: context.deviceRef } : {}),
    };
    const decision = await this.evaluator.evaluate(request);
    if (decision.allowed) return null;
    return {
      status: decision.status,
      body: {
        code: decision.effect === "challenge" ? "STEP_UP_REQUIRED" : "FORBIDDEN",
        message:
          decision.effect === "challenge"
            ? "Step-up authentication required"
            : "Access denied by zero-trust policy",
        retryable: false,
        fields: [],
        reasons: decision.reasons,
      },
    };
  }
}

/** An authentication provider the middleware calls (composition adapts `SecuritySdk.authenticate`). */
export interface EdgeAuthenticator {
  authenticate(input: {
    readonly method: string;
    readonly identifier: string;
    readonly credential?: string;
  }): Promise<{
    readonly authenticated: boolean;
    readonly principalId?: string;
    readonly reason?: string;
  }>;
}

/** An AI-action checker the middleware calls (composition adapts `CheckAiAction`). */
export interface AiActionChecker {
  check(input: {
    readonly principalId: string;
    readonly tool: string;
    readonly resource?: string;
  }): Promise<{ readonly allowed: boolean; readonly reason?: string }>;
}

/** Authentication middleware — verifies a credential, yielding the principal id or a 401. */
export function authenticationMiddleware(authenticator: EdgeAuthenticator) {
  return async (input: {
    readonly method: string;
    readonly identifier: string;
    readonly credential?: string;
  }): Promise<MiddlewareResult & { readonly principalId?: string }> => {
    const outcome = await authenticator.authenticate(input);
    if (outcome.authenticated && outcome.principalId !== undefined)
      return { ...ALLOW, principalId: outcome.principalId };
    return {
      allowed: false,
      status: 401,
      code: "UNAUTHENTICATED",
      reasons: outcome.reason !== undefined ? [outcome.reason] : [],
    };
  };
}

/** Authorization middleware — full request-trust zero-trust evaluation for an edge/gateway pipeline. */
export function authorizationMiddleware(evaluator: EdgeZeroTrustEvaluator) {
  return async (
    request: EdgeRequest,
    context?: SecurityPropagationContext,
  ): Promise<MiddlewareResult> => {
    const decision = await evaluator.evaluate(request, context);
    if (decision.allowed) return ALLOW;
    return {
      allowed: false,
      status: decision.status,
      code: decision.effect === "challenge" ? "STEP_UP_REQUIRED" : "FORBIDDEN",
      reasons: decision.reasons,
    };
  };
}

/** Policy middleware — authorization pinned to an explicit policy key (policy-scoped evaluation). */
export function policyMiddleware(evaluator: EdgeZeroTrustEvaluator, environment: string) {
  return async (
    request: EdgeRequest,
    context?: SecurityPropagationContext,
  ): Promise<MiddlewareResult> => {
    const decision = await evaluator.evaluate({ ...request, environment }, context);
    if (decision.allowed) return ALLOW;
    return {
      allowed: false,
      status: decision.status,
      code: decision.effect === "challenge" ? "STEP_UP_REQUIRED" : "FORBIDDEN",
      reasons: decision.reasons,
    };
  };
}

/** AI-governance middleware — gates a non-human/AI principal's tool+resource action (reuses CheckAiAction). */
export function aiGovernanceMiddleware(checker: AiActionChecker) {
  return async (input: {
    readonly principalId: string;
    readonly tool: string;
    readonly resource?: string;
  }): Promise<MiddlewareResult> => {
    const outcome = await checker.check(input);
    if (outcome.allowed) return ALLOW;
    return {
      allowed: false,
      status: 403,
      code: "AI_ACTION_DENIED",
      reasons: outcome.reason !== undefined ? [outcome.reason] : [],
    };
  };
}
