import { describe, expect, it, vi } from "vitest";
import type { Principal } from "@platform/contracts";
import type { SenderDomainController } from "@platform/notifications";
import { SenderDomainAdminController } from "./sender-domain.admin-controller";

const principal: Principal = { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: "t1" };

function build(allow: boolean) {
  const inner = {
    get: vi.fn(() => Promise.resolve({ status: 200, body: {} })),
    start: vi.fn(() => Promise.resolve({ status: 200, body: {} })),
    verify: vi.fn(() => Promise.resolve({ status: 200, body: {} })),
  };
  const guard = {
    ensure: vi.fn((_principal: Principal, _permission: string) =>
      Promise.resolve(allow ? null : { status: 403, body: { code: "FORBIDDEN" } }),
    ),
  };
  const controller = new SenderDomainAdminController({
    senderDomain: inner as unknown as SenderDomainController,
    guard: guard as never,
  });
  return { controller, inner, guard };
}

describe("SenderDomainAdminController", () => {
  it("reads need settings:read, starting and verifying need settings:update", async () => {
    expect.hasAssertions();
    const { controller, guard, inner } = build(true);
    await controller.get(principal, { tenantId: "t1" });
    await controller.start(principal, { tenantId: "t1" });
    await controller.verify(principal, { tenantId: "t1" });
    expect(guard.ensure.mock.calls.map((call) => call[1])).toEqual([
      "settings:read",
      "settings:update",
      "settings:update",
    ]);
    expect(inner.start).toHaveBeenCalledWith({ tenantId: "t1" });
  });

  it("does nothing when the guard refuses", async () => {
    expect.hasAssertions();
    const { controller, inner } = build(false);
    expect((await controller.get(principal, { tenantId: "t1" })).status).toBe(403);
    expect((await controller.start(principal, { tenantId: "t1" })).status).toBe(403);
    expect((await controller.verify(principal, { tenantId: "t1" })).status).toBe(403);
    expect(inner.get).not.toHaveBeenCalled();
    expect(inner.start).not.toHaveBeenCalled();
    expect(inner.verify).not.toHaveBeenCalled();
  });
});
