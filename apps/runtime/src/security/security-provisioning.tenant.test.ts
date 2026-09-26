import type { IntegrationEvent } from "@platform/domain-events";
import { describe, expect, it, vi } from "vitest";
import {
  AssignRoleOnMembershipCreated,
  DisablePrincipalOnUserDeactivated,
  ProvisionPrincipalOnUserCreated,
} from "./security-provisioning.consumers";

/**
 * G-64: the three provisioning consumers route by the ENVELOPE's tenant.
 *
 * Direction with no tenant (a skipped write denies, a skipped delete allows):
 *   - registering a principal and assigning a role GRANT standing → REFUSED (nothing provisioned);
 *   - disabling a principal on deactivation REMOVES standing → THROWS to the DLQ, because acking a
 *     skipped disable would leave a deactivated user's principal live.
 */

function envelope<T>(type: string, tenantId: string | undefined, payload: T): IntegrationEvent<T> {
  return {
    messageId: `m-${type}-${tenantId ?? "none"}`,
    type,
    eventVersion: 1,
    aggregateId: "agg",
    aggregateType: "x",
    occurredAt: "2026-09-26T00:00:00.000Z",
    correlationId: "c",
    causationId: "c",
    metadata: {},
    ...(tenantId === undefined ? {} : { tenantId }),
    payload,
  } as IntegrationEvent<T>;
}

const ok = { status: 200, body: {} };
function deps() {
  const security = {
    registerPrincipal: vi.fn(async (_input: { tenantId: string }) => ok),
    transitionPrincipal: vi.fn(async (_input: { tenantId: string }) => ok),
    assignRole: vi.fn(async (_input: { tenantId: string }) => ok),
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { security, logger, d: { security: security as never, logger: logger as never } };
}
const MISSING = [
  ["absent", undefined],
  ["empty", ""],
] as const;

describe("security provisioning consumers — envelope tenant (G-64)", () => {
  it("registerPrincipal runs under each event's own tenant", async () => {
    const { security, d } = deps();
    const consumer = new ProvisionPrincipalOnUserCreated(d);
    const payload = { userId: "u1", tenantId: "business-tenant" };
    await consumer.handle(envelope("identity.user.created", "tenant-a", payload));
    await consumer.handle(envelope("identity.user.created", "tenant-b", payload));
    expect(security.registerPrincipal.mock.calls.map((c) => c[0].tenantId)).toEqual([
      "tenant-a",
      "tenant-b",
    ]);
  });

  it("transitionPrincipal(disabled) runs under each event's own tenant", async () => {
    const { security, d } = deps();
    const consumer = new DisablePrincipalOnUserDeactivated(d);
    await consumer.handle(envelope("identity.user.deactivated", "tenant-a", { userId: "u1" }));
    await consumer.handle(envelope("identity.user.deactivated", "tenant-b", { userId: "u1" }));
    expect(security.transitionPrincipal.mock.calls.map((c) => c[0].tenantId)).toEqual([
      "tenant-a",
      "tenant-b",
    ]);
  });

  it("assignRole runs under each event's own tenant", async () => {
    const { security, d } = deps();
    const consumer = new AssignRoleOnMembershipCreated(d);
    const payload = { membershipId: "m1", userId: "u1", organizationId: "o1", role: "admin" };
    await consumer.handle(envelope("identity.membership.created", "tenant-a", payload));
    await consumer.handle(envelope("identity.membership.created", "tenant-b", payload));
    expect(security.assignRole.mock.calls.map((c) => c[0].tenantId)).toEqual([
      "tenant-a",
      "tenant-b",
    ]);
  });

  it.each(MISSING)(
    "user.created REFUSES on an %s tenant — no principal is registered",
    async (_n, tenant) => {
      const { security, logger, d } = deps();
      await expect(
        new ProvisionPrincipalOnUserCreated(d).handle(
          envelope("identity.user.created", tenant, { userId: "u1", tenantId: "t" }),
        ),
      ).resolves.toBeUndefined();
      expect(security.registerPrincipal).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    },
  );

  it.each(MISSING)(
    "membership.created REFUSES on an %s tenant — no role is assigned",
    async (_n, tenant) => {
      const { security, d } = deps();
      await expect(
        new AssignRoleOnMembershipCreated(d).handle(
          envelope("identity.membership.created", tenant, {
            membershipId: "m1",
            userId: "u1",
            organizationId: "o1",
            role: "admin",
          }),
        ),
      ).resolves.toBeUndefined();
      expect(security.assignRole).not.toHaveBeenCalled();
    },
  );

  it.each(MISSING)(
    "user.deactivated THROWS on an %s tenant — a skipped disable must not ack",
    async (_n, tenant) => {
      const { security, d } = deps();
      await expect(
        new DisablePrincipalOnUserDeactivated(d).handle(
          envelope("identity.user.deactivated", tenant, { userId: "u1" }),
        ),
      ).rejects.toThrow(/tenant/i);
      expect(security.transitionPrincipal).not.toHaveBeenCalled();
    },
  );
});
