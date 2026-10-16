import { describe, expect, it, vi } from "vitest";
import type { IntegrationEvent } from "@platform/domain-events";
import { InMemoryConsentProjectionStore } from "../infrastructure/consent-projection";
import { InMemoryIdentityProjectionStore } from "../infrastructure/identity-projection";
import { ConsentChangedConsumer, type ConsentChangedPayload } from "./consent-changed.consumer";
import {
  IdentityMembershipCreatedConsumer,
  IdentityMembershipRoleChangedConsumer,
  IdentityOrganizationCreatedConsumer,
  IdentityUserCreatedConsumer,
  IdentityUserDeactivatedConsumer,
} from "./identity-projection.consumers";

/**
 * T10.5 case 3 + G-64 — "an event published under A lands in A's projections, never in B's".
 *
 * These consumers used to be built once with a `deps.tenantId` (the deployment tenant) and ignored
 * `event.tenantId`; this file used to pin THAT (A's event landed in the consumer's tenant). G-64
 * flipped it: the row scope is the ENVELOPE's tenant, per message.
 *
 * Direction when the envelope has no tenant (relation-sync.consumer.ts: a skipped write denies, a
 * skipped delete allows — the two paths fail in opposite directions):
 *   - creates and consent GRANTS add standing → REFUSED (nothing written, error logged, acked);
 *   - user deactivation, membership role change and consent WITHDRAWAL take standing away → a
 *     quiet skip would leave the old, wider projection live, so they THROW to the retry/DLQ.
 *
 * Layer: application (event consumer → in-memory projection store). No broker, no RLS.
 */

function envelope<T>(
  type: string,
  tenantId: string | undefined,
  aggregateId: string,
  payload: T,
  occurredAt = "2026-09-26T00:00:00.000Z",
) {
  return {
    messageId: `msg-${type}-${tenantId ?? "none"}`,
    type,
    eventVersion: 1,
    aggregateId,
    aggregateType: "x",
    occurredAt,
    correlationId: "c",
    causationId: "c",
    metadata: {},
    // Off the wire a tenant can be absent even though the type says it is required.
    ...(tenantId === undefined ? {} : { tenantId }),
    payload,
  } as IntegrationEvent<T>;
}

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
const MISSING = [
  ["absent", undefined],
  ["empty", ""],
] as const;

describe("identity projection consumers — the row scope is the envelope tenant", () => {
  it("user.created: each event lands in its own tenant's rows and no other", async () => {
    const store = new InMemoryIdentityProjectionStore();
    const consumer = new IdentityUserCreatedConsumer({ store, logger });
    const payload = { userId: "u1", tenantId: "business-tenant" };

    await consumer.handle(envelope("identity.user.created", "tenant-a", "u1", payload));
    await consumer.handle(
      envelope("identity.user.created", "tenant-b", "u2", { ...payload, userId: "u2" }),
    );

    expect(await store.getUser("u1", "tenant-a")).not.toBeNull();
    expect(await store.getUser("u1", "tenant-b")).toBeNull();
    expect(await store.getUser("u2", "tenant-b")).not.toBeNull();
    expect(await store.getUser("u2", "tenant-a")).toBeNull();
  });

  it("organization.created: lands under the envelope tenant", async () => {
    const store = new InMemoryIdentityProjectionStore();
    const consumer = new IdentityOrganizationCreatedConsumer({ store, logger });
    const payload = { organizationId: "o1", slug: "acme", tenantId: "business-tenant" };
    await consumer.handle(envelope("identity.organization.created", "tenant-a", "o1", payload));
    await consumer.handle(envelope("identity.organization.created", "tenant-b", "o1", payload));
    expect((await store.getOrganization("o1", "tenant-a"))?.slug).toBe("acme");
    expect((await store.getOrganization("o1", "tenant-b"))?.slug).toBe("acme");
    expect(await store.getOrganization("o1", "tenant-c")).toBeNull();
  });

  it("membership.created + role_changed: each tenant's membership changes independently", async () => {
    const store = new InMemoryIdentityProjectionStore();
    const created = new IdentityMembershipCreatedConsumer({ store, logger });
    const roleChanged = new IdentityMembershipRoleChangedConsumer({ store, logger });
    const m = { membershipId: "m1", userId: "u1", organizationId: "o1", role: "member" };

    await created.handle(envelope("identity.membership.created", "tenant-a", "m1", m));
    await created.handle(envelope("identity.membership.created", "tenant-b", "m1", m));
    await roleChanged.handle(
      envelope("identity.membership.role_changed", "tenant-a", "m1", {
        membershipId: "m1",
        role: "owner",
      }),
    );

    expect((await store.listMembershipsByUser("u1", "tenant-a"))[0]?.role).toBe("owner");
    expect((await store.listMembershipsByUser("u1", "tenant-b"))[0]?.role).toBe("member");
  });

  it("user.deactivated: deactivates only the envelope tenant's row", async () => {
    const store = new InMemoryIdentityProjectionStore();
    const created = new IdentityUserCreatedConsumer({ store, logger });
    const deactivated = new IdentityUserDeactivatedConsumer({ store, logger });
    const payload = { userId: "u1", tenantId: "business-tenant" };
    await created.handle(envelope("identity.user.created", "tenant-a", "u1", payload));
    await created.handle(envelope("identity.user.created", "tenant-b", "u1", payload));

    await deactivated.handle(
      envelope("identity.user.deactivated", "tenant-a", "u1", { userId: "u1" }),
    );

    expect((await store.getUser("u1", "tenant-a"))?.status).toBe("deactivated");
    expect((await store.getUser("u1", "tenant-b"))?.status).toBe("active");
  });

  describe("no tenant on the envelope", () => {
    it.each(MISSING)(
      "user.created REFUSES on an %s tenant — writes nothing, does not throw",
      async (_n, tenant) => {
        const store = new InMemoryIdentityProjectionStore();
        const spy = vi.spyOn(store, "upsertUser");
        await expect(
          new IdentityUserCreatedConsumer({ store, logger }).handle(
            envelope("identity.user.created", tenant, "u1", { userId: "u1", tenantId: "t" }),
          ),
        ).resolves.toBeUndefined();
        expect(spy).not.toHaveBeenCalled();
      },
    );

    it.each(MISSING)("organization.created REFUSES on an %s tenant", async (_n, tenant) => {
      const store = new InMemoryIdentityProjectionStore();
      const spy = vi.spyOn(store, "upsertOrganization");
      await expect(
        new IdentityOrganizationCreatedConsumer({ store, logger }).handle(
          envelope("identity.organization.created", tenant, "o1", {
            organizationId: "o1",
            slug: "s",
            tenantId: "t",
          }),
        ),
      ).resolves.toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });

    it.each(MISSING)("membership.created REFUSES on an %s tenant", async (_n, tenant) => {
      const store = new InMemoryIdentityProjectionStore();
      const spy = vi.spyOn(store, "upsertMembership");
      await expect(
        new IdentityMembershipCreatedConsumer({ store, logger }).handle(
          envelope("identity.membership.created", tenant, "m1", {
            membershipId: "m1",
            userId: "u1",
            organizationId: "o1",
            role: "member",
          }),
        ),
      ).resolves.toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });

    it.each(MISSING)(
      "user.deactivated THROWS on an %s tenant — a skipped removal must not ack",
      async (_n, tenant) => {
        const store = new InMemoryIdentityProjectionStore();
        const spy = vi.spyOn(store, "setUserStatus");
        await expect(
          new IdentityUserDeactivatedConsumer({ store, logger }).handle(
            envelope("identity.user.deactivated", tenant, "u1", { userId: "u1" }),
          ),
        ).rejects.toThrow(/tenant/i);
        expect(spy).not.toHaveBeenCalled();
      },
    );

    it.each(MISSING)(
      "membership.role_changed THROWS on an %s tenant — a skipped downgrade must not ack",
      async (_n, tenant) => {
        const store = new InMemoryIdentityProjectionStore();
        const spy = vi.spyOn(store, "setMembershipRole");
        await expect(
          new IdentityMembershipRoleChangedConsumer({ store, logger }).handle(
            envelope("identity.membership.role_changed", tenant, "m1", {
              membershipId: "m1",
              role: "member",
            }),
          ),
        ).rejects.toThrow(/tenant/i);
        expect(spy).not.toHaveBeenCalled();
      },
    );
  });
});

describe("consent projection consumer — the row scope is the envelope tenant", () => {
  const type = "identity.customer.consent_changed";
  const has = (store: InMemoryConsentProjectionStore, tenant: string) =>
    store.get("c1", "marketing", tenant).then((r) => r?.granted === true);

  it("each event lands in its own tenant's consent rows and no other", async () => {
    const store = new InMemoryConsentProjectionStore();
    const consumer = new ConsentChangedConsumer({ store, logger });
    await consumer.handle(
      envelope<ConsentChangedPayload>(type, "tenant-a", "c1", {
        scope: "marketing",
        granted: true,
      }),
    );

    expect(await has(store, "tenant-a")).toBe(true);
    expect(await has(store, "tenant-b")).toBe(false);
  });

  it("a withdrawal under B leaves A's grant untouched", async () => {
    const store = new InMemoryConsentProjectionStore();
    const consumer = new ConsentChangedConsumer({ store, logger });
    const grant = { scope: "marketing", granted: true };
    await consumer.handle(envelope<ConsentChangedPayload>(type, "tenant-a", "c1", grant));
    await consumer.handle(envelope<ConsentChangedPayload>(type, "tenant-b", "c1", grant));
    await consumer.handle(
      envelope<ConsentChangedPayload>(
        type,
        "tenant-b",
        "c1",
        { scope: "marketing", granted: false },
        "2026-09-26T01:00:00.000Z",
      ),
    );
    expect(await has(store, "tenant-a")).toBe(true);
    expect(await has(store, "tenant-b")).toBe(false);
  });

  it.each(MISSING)(
    "a GRANT REFUSES on an %s tenant — writes nothing, does not throw",
    async (_n, tenant) => {
      const store = new InMemoryConsentProjectionStore();
      const spy = vi.spyOn(store, "upsert");
      await expect(
        new ConsentChangedConsumer({ store, logger }).handle(
          envelope<ConsentChangedPayload>(type, tenant, "c1", {
            scope: "marketing",
            granted: true,
          }),
        ),
      ).resolves.toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it.each(MISSING)(
    "a WITHDRAWAL THROWS on an %s tenant — a skipped withdrawal would leave consent live",
    async (_n, tenant) => {
      const store = new InMemoryConsentProjectionStore();
      const spy = vi.spyOn(store, "upsert");
      await expect(
        new ConsentChangedConsumer({ store, logger }).handle(
          envelope<ConsentChangedPayload>(type, tenant, "c1", {
            scope: "marketing",
            granted: false,
          }),
        ),
      ).rejects.toThrow(/tenant/i);
      expect(spy).not.toHaveBeenCalled();
    },
  );
});
