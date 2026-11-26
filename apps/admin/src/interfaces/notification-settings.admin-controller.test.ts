import { describe, expect, it, vi } from "vitest";
import type { Principal } from "@platform/contracts";
import type { NotificationSettingsController } from "@platform/notifications";
import { NotificationSettingsAdminController } from "./notification-settings.admin-controller";

const principal: Principal = { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: "t1" };

function build(options: { allow?: boolean; actorEmail?: string | null } = {}) {
  const sendTest = vi.fn(() => Promise.resolve({ status: 200, body: { sent: true } }));
  const actorEmail = vi.fn(() => Promise.resolve(options.actorEmail ?? "staff@shop.com"));
  const guard = {
    ensure: vi.fn((_principal: Principal, _permission: string) =>
      Promise.resolve(
        options.allow === false ? { status: 403, body: { code: "FORBIDDEN" } } : null,
      ),
    ),
  };
  const controller = new NotificationSettingsAdminController({
    settings: { sendTest } as unknown as NotificationSettingsController,
    guard: guard as never,
    actorEmail,
  });
  return { controller, sendTest, actorEmail, guard };
}

describe("NotificationSettingsAdminController.sendTest", () => {
  it("resolves the recipient from the signed-in principal, server-side, and requires settings:update", async () => {
    expect.hasAssertions();
    const { controller, sendTest, actorEmail, guard } = build();
    await controller.sendTest(principal, { tenantId: "t1", key: "order_confirmation" });
    expect(guard.ensure).toHaveBeenCalledWith(principal, "settings:update");
    expect(actorEmail).toHaveBeenCalledWith("t1", "staff-1");
    expect(sendTest).toHaveBeenCalledWith({
      tenantId: "t1",
      key: "order_confirmation",
      actorEmail: "staff@shop.com",
    });
  });

  it("cannot be steered to another address by anything in the input", async () => {
    expect.hasAssertions();
    const { controller, sendTest } = build();
    await controller.sendTest(principal, {
      tenantId: "t1",
      key: "order_confirmation",
      ...({ actorEmail: "victim@example.com" } as object),
    });
    const sent = sendTest.mock.calls[0] as unknown as [{ actorEmail: string }];
    expect(sent[0].actorEmail).toBe("staff@shop.com");
  });

  it("sends nothing and looks nothing up when the guard refuses", async () => {
    expect.hasAssertions();
    const { controller, sendTest, actorEmail } = build({ allow: false });
    const response = await controller.sendTest(principal, {
      tenantId: "t1",
      key: "order_confirmation",
    });
    expect(response.status).toBe(403);
    expect(actorEmail).not.toHaveBeenCalled();
    expect(sendTest).not.toHaveBeenCalled();
  });
});
