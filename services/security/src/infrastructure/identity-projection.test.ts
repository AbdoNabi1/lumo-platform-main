import { describe, expect, it } from "vitest";
import type { IntegrationEvent } from "@platform/domain-events";
import type { Logger } from "@platform/utils";
import { InMemoryIdentityProjectionStore } from "./identity-projection";
import {
  IdentityMembershipCreatedConsumer,
  IdentityMembershipRoleChangedConsumer,
  IdentityOrganizationCreatedConsumer,
  IdentityUserCreatedConsumer,
  IdentityUserDeactivatedConsumer,
} from "../interfaces/identity-projection.consumers";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

function evt<T>(
  type: string,
  aggregateId: string,
  payload: T,
  occurredAt: string,
): IntegrationEvent<T> {
  return {
    messageId: `${aggregateId}-${occurredAt}`,
    type,
    eventVersion: 1,
    aggregateId,
    aggregateType: "x",
    occurredAt,
    correlationId: "c",
    causationId: "c",
    payload,
    metadata: {},
  };
}

describe("identity projection (H-2)", () => {
  it("projects a user then a deactivation (status transition, LWW)", async () => {
    const store = new InMemoryIdentityProjectionStore();
    const created = new IdentityUserCreatedConsumer({ store, logger: silent });
    const deactivated = new IdentityUserDeactivatedConsumer({ store, logger: silent });

    await created.handle(
      evt(
        "identity.user.created",
        "u1",
        { userId: "u1", tenantId: "t1" },
        "2026-07-18T00:00:00.000Z",
      ),
    );
    expect(await store.getUser("u1")).toMatchObject({
      userId: "u1",
      userTenant: "t1",
      status: "active",
    });

    await deactivated.handle(
      evt("identity.user.deactivated", "u1", { userId: "u1" }, "2026-07-18T01:00:00.000Z"),
    );
    const u = await store.getUser("u1");
    expect(u?.status).toBe("deactivated");
    expect(u?.userTenant).toBe("t1"); // preserved across a status-only event
  });

  it("is last-writer-wins: an older redelivered create never regresses a newer deactivation", async () => {
    const store = new InMemoryIdentityProjectionStore();
    await new IdentityUserDeactivatedConsumer({ store, logger: silent }).handle(
      evt("identity.user.deactivated", "u1", { userId: "u1" }, "2026-07-18T02:00:00.000Z"),
    );
    await new IdentityUserCreatedConsumer({ store, logger: silent }).handle(
      evt(
        "identity.user.created",
        "u1",
        { userId: "u1", tenantId: "t1" },
        "2026-07-18T01:00:00.000Z",
      ),
    );
    expect((await store.getUser("u1"))?.status).toBe("deactivated"); // newer deactivation wins
  });

  it("projects organizations and memberships and updates a role", async () => {
    const store = new InMemoryIdentityProjectionStore();
    await new IdentityOrganizationCreatedConsumer({ store, logger: silent }).handle(
      evt(
        "identity.organization.created",
        "org1",
        { organizationId: "org1", slug: "acme", tenantId: "t1" },
        "2026-07-18T00:00:00.000Z",
      ),
    );
    await new IdentityMembershipCreatedConsumer({ store, logger: silent }).handle(
      evt(
        "identity.membership.created",
        "m1",
        { membershipId: "m1", userId: "u1", organizationId: "org1", role: "member" },
        "2026-07-18T00:10:00.000Z",
      ),
    );

    expect((await store.getOrganization("org1"))?.slug).toBe("acme");
    const before = await store.listMembershipsByUser("u1");
    expect(before).toHaveLength(1);
    expect(before[0]?.role).toBe("member");

    await new IdentityMembershipRoleChangedConsumer({ store, logger: silent }).handle(
      evt(
        "identity.membership.role_changed",
        "m1",
        { membershipId: "m1", role: "admin" },
        "2026-07-18T00:20:00.000Z",
      ),
    );
    expect((await store.listMembershipsByUser("u1"))[0]?.role).toBe("admin");
  });

  it("ignores a role change for an unknown membership (create precedes mutate)", async () => {
    const store = new InMemoryIdentityProjectionStore();
    await new IdentityMembershipRoleChangedConsumer({ store, logger: silent }).handle(
      evt(
        "identity.membership.role_changed",
        "ghost",
        { membershipId: "ghost", role: "admin" },
        "2026-07-18T00:00:00.000Z",
      ),
    );
    expect(await store.listMembershipsByUser("u1")).toHaveLength(0);
  });
});
