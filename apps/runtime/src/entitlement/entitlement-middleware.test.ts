import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@platform/utils";
import { EntitlementMiddleware, ok } from "./entitlement-middleware";

function middleware() {
  const guard = {
    enforce: vi.fn(async (_target: string, _request: unknown, run: () => Promise<unknown>) =>
      run(),
    ),
    can: vi.fn(async () => true),
    why: vi.fn(async () => ({ explanation: "plan" })),
    trace: vi.fn(async () => ({ steps: [] })),
    simulate: vi.fn(async () => ({ allowed: true })),
  };
  return { mw: new EntitlementMiddleware(guard as never), guard };
}

const request = { tenant: "tenant-a", featureKey: "discounts.automatic" } as never;
const run = async () => ok("ran");

describe("EntitlementMiddleware", () => {
  it.each([
    ["api", "api"],
    ["graphql", "graphql"],
    ["job", "background_job"],
    ["workflow", "workflow"],
    ["scheduled", "scheduled_task"],
    ["cli", "cli"],
    ["marketplace", "marketplace_operation"],
    ["ai", "ai_request"],
  ] as const)(
    "routes the %s surface through the one guard as target %s",
    async (surface, target) => {
      const { mw, guard } = middleware();
      const result = await mw[surface](request, run);
      expect(result).toEqual(ok("ran"));
      expect(guard.enforce).toHaveBeenCalledWith(target, request, run);
    },
  );

  it("runs an admin command only when RBAC allows, via the admin_action target", async () => {
    const { mw, guard } = middleware();
    expect(await mw.admin(request, true, run)).toEqual(ok("ran"));
    expect(guard.enforce).toHaveBeenCalledWith("admin_action", request, run);
  });

  it("denies an admin command RBAC refused without consulting entitlement or running it", async () => {
    const { mw, guard } = middleware();
    const command = vi.fn(run);
    const result = await mw.admin(request, false, command);

    expect(result.ok).toBe(false);
    const error = (result as { error: AuthorizationError }).error;
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error.message).toBe("RBAC denied");
    expect(guard.enforce).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });

  it("delegates the read-only surface to the guard", async () => {
    const { mw, guard } = middleware();
    expect(await mw.can(request)).toBe(true);
    expect(await mw.why(request)).toEqual({ explanation: "plan" });
    expect(await mw.trace(request)).toEqual({ steps: [] });
    await mw.simulate(request);
    await mw.simulate(request, "api");
    expect(guard.simulate.mock.calls).toEqual([
      [request, "command"],
      [request, "api"],
    ]);
  });
});
