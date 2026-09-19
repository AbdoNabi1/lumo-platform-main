import { describe, expect, it } from "vitest";
import type { Principal } from "@platform/contracts";
import type { AccessDecisionOutput, EvaluateAccessInput } from "@platform/security";
import { EdgeZeroTrustEvaluator, type ZeroTrustDecider } from "./edge-zero-trust";
import {
  aiGovernanceMiddleware,
  authenticationMiddleware,
  authorizationMiddleware,
  policyMiddleware,
  SecurityPermissionGuard,
  type AiActionChecker,
  type EdgeAuthenticator,
} from "./edge-middleware";
import type { SecurityInstrumentation } from "./security-instrumentation";

const stubInstrumentation = {
  authorization: (_ctx: unknown, fn: (span: unknown) => Promise<unknown>) => fn(undefined),
} as SecurityInstrumentation;
const silent = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
} as never;
// `PrincipalKind` is a branded/opaque type — a plain `"user"` literal has no structural overlap
// with it (comparability fails), so the `unknown` hop is needed to build this test fixture.
const principal: Principal = { id: "p-1", kind: "user", roles: [] } as unknown as Principal;

function evaluatorReturning(
  effect: AccessDecisionOutput["effect"],
  allowed: boolean,
  reasons: string[] = [],
): EdgeZeroTrustEvaluator {
  const decider: ZeroTrustDecider = {
    authorize: async (_input: EvaluateAccessInput): Promise<AccessDecisionOutput> => ({
      effect,
      allowed,
      reasons,
      matchedRuleIds: [],
      policyKey: null,
      policyVersion: null,
      risk: 0,
      trust: 0,
      roleKeys: [],
      auditId: "a",
    }),
  };
  return new EdgeZeroTrustEvaluator({
    decider,
    instrumentation: stubInstrumentation,
    logger: silent,
  });
}

describe("SecurityPermissionGuard (@platform/http seam)", () => {
  it("allows (returns null) on an allow decision", async () => {
    const guard = new SecurityPermissionGuard(evaluatorReturning("allow", true));
    expect(await guard.ensure(principal, "orders:read", { tenantId: "tenant-a" })).toBeNull();
  });

  it("denies with 403 FORBIDDEN", async () => {
    const guard = new SecurityPermissionGuard(
      evaluatorReturning("block", false, ["no-permission"]),
    );
    const response = await guard.ensure(principal, "orders:write", {
      tenantId: "tenant-a",
    });
    expect(response?.status).toBe(403);
    expect((response?.body as { code: string }).code).toBe("FORBIDDEN");
  });

  it("challenges with 401 STEP_UP_REQUIRED", async () => {
    const guard = new SecurityPermissionGuard(evaluatorReturning("challenge", false));
    const response = await guard.ensure(principal, "orders:write", {
      tenantId: "tenant-a",
    });
    expect(response?.status).toBe(401);
    expect((response?.body as { code: string }).code).toBe("STEP_UP_REQUIRED");
  });
});

describe("named middleware factories", () => {
  it("authenticationMiddleware yields the principal or 401", async () => {
    const ok: EdgeAuthenticator = {
      authenticate: async () => ({ authenticated: true, principalId: "p-9" }),
    };
    const bad: EdgeAuthenticator = {
      authenticate: async () => ({ authenticated: false, reason: "bad-credential" }),
    };
    expect(
      await authenticationMiddleware(ok)({ method: "password", identifier: "u" }),
    ).toMatchObject({ allowed: true, principalId: "p-9" });
    expect(
      await authenticationMiddleware(bad)({ method: "password", identifier: "u" }),
    ).toMatchObject({ allowed: false, status: 401, reasons: ["bad-credential"] });
  });

  it("authorizationMiddleware + policyMiddleware map decisions", async () => {
    expect(
      await authorizationMiddleware(evaluatorReturning("allow", true))({
        tenantId: "tenant-a",
        principalId: "p",
        permission: "x:y",
      }),
    ).toMatchObject({ allowed: true });
    expect(
      await policyMiddleware(
        evaluatorReturning("block", false, ["denied"]),
        "prod",
      )({ tenantId: "tenant-a", principalId: "p", permission: "x:y" }),
    ).toMatchObject({ allowed: false, status: 403, reasons: ["denied"] });
  });

  it("aiGovernanceMiddleware gates AI actions", async () => {
    const allow: AiActionChecker = { check: async () => ({ allowed: true }) };
    const deny: AiActionChecker = {
      check: async () => ({ allowed: false, reason: "budget-exceeded" }),
    };
    expect(
      await aiGovernanceMiddleware(allow)({ principalId: "ai-1", tool: "search" }),
    ).toMatchObject({ allowed: true });
    expect(
      await aiGovernanceMiddleware(deny)({ principalId: "ai-1", tool: "search" }),
    ).toMatchObject({
      allowed: false,
      status: 403,
      code: "AI_ACTION_DENIED",
      reasons: ["budget-exceeded"],
    });
  });
});
