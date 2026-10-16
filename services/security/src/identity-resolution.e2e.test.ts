import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { IntegrationEvent } from "@platform/domain-events";
import type { Logger } from "@platform/utils";
import { wireSecurity } from "./composition";
import { InMemoryIdentityProjectionStore } from "./infrastructure/identity-projection";
import {
  IdentityMembershipCreatedConsumer,
  IdentityOrganizationCreatedConsumer,
  IdentityUserCreatedConsumer,
} from "./interfaces/identity-projection.consumers";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-07-18T00:00:00.000Z") };
const body = <T>(r: { body: unknown }): T => r.body as T;

function evt<T>(type: string, aggregateId: string, payload: T): IntegrationEvent<T> {
  return {
    messageId: `${type}-${aggregateId}`,
    type,
    eventVersion: 1,
    aggregateId,
    aggregateType: "x",
    occurredAt: "2026-07-18T00:00:00.000Z",
    correlationId: "c",
    causationId: "c",
    tenantId: "tenant-a",
    payload,
    metadata: {},
  };
}

/**
 * H-2 (G-SEC-4) — live identity **resolution** across the frozen ownership boundary, through the wired
 * context. Identity events (owned + emitted by Identity) are projected by the same consumers production
 * runs; Security resolves a principal → Identity user + memberships + organizations, and its own
 * machine-identity governance — without re-owning any Identity fact.
 */
describe("H-2 identity resolution (end to end)", () => {
  it("resolves a principal to its Identity user + memberships + organizations", async () => {
    const identityProjection = new InMemoryIdentityProjectionStore();
    const app = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      knownSubjects: ["kratos-7"],
      clock,
      identityProjection,
    });

    // Identity emits — Security projects (owned by Identity).
    await new IdentityUserCreatedConsumer({
      store: identityProjection,
      logger: silent,
    }).handle(
      evt("identity.user.created", "kratos-7", { userId: "kratos-7", tenantId: "tenant-1" }),
    );
    await new IdentityOrganizationCreatedConsumer({
      store: identityProjection,
      logger: silent,
    }).handle(
      evt("identity.organization.created", "org-1", {
        organizationId: "org-1",
        slug: "acme",
        tenantId: "tenant-1",
      }),
    );
    await new IdentityMembershipCreatedConsumer({
      store: identityProjection,
      logger: silent,
    }).handle(
      evt("identity.membership.created", "mem-1", {
        membershipId: "mem-1",
        userId: "kratos-7",
        organizationId: "org-1",
        role: "admin",
      }),
    );

    // Security owns the principal (references Identity via subjectRef).
    await app.security.registerPrincipal({
      tenantId: "tenant-a",
      externalId: "admin-1",
      kind: "human",
      displayName: "Admin",
      subjectRef: "kratos-7",
      tenantRef: "tenant-1",
    });

    const resolved = body<{
      principal: { externalId: string } | null;
      identityUser: { status: string } | null;
      memberships: { organizationId: string; role: string; organizationSlug: string | null }[];
    }>(await app.security.resolvePrincipal({ tenantId: "tenant-a", subjectRef: "kratos-7" }));
    expect(resolved.principal?.externalId).toBe("admin-1");
    expect(resolved.identityUser?.status).toBe("active");
    expect(resolved.memberships).toHaveLength(1);
    expect(resolved.memberships[0]).toMatchObject({
      organizationId: "org-1",
      role: "admin",
      organizationSlug: "acme",
    });

    const membership = body<{ memberships: unknown[] }>(
      await app.security.resolveMembership({ tenantId: "tenant-a", userId: "kratos-7" }),
    );
    expect(membership.memberships).toHaveLength(1);

    const org = body<{ slug: string }>(
      await app.security.resolveOrganization({ tenantId: "tenant-a", organizationId: "org-1" }),
    );
    expect(org.slug).toBe("acme");
  });

  it("resolves a Security-owned machine identity's governance profile", async () => {
    const app = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
    });
    await app.security.registerPrincipal({
      tenantId: "tenant-a",
      externalId: "svc-1",
      kind: "service_account",
      displayName: "CI",
      tenantRef: "tenant-1",
    });
    await app.security.governMachineIdentity({
      tenantId: "tenant-a",
      principalExternalId: "svc-1",
      config: {
        owner: "platform",
        purpose: "ci",
        allowedScopes: ["ci:read"],
        allowedEnvironments: ["prod"],
      },
    });

    const resolved = body<{ status: string; owner: string; allowedScopes: string[] }>(
      await app.security.resolveMachineIdentity({
        tenantId: "tenant-a",
        principalExternalId: "svc-1",
      }),
    );
    expect(resolved.status).toBe("active");
    expect(resolved.owner).toBe("platform");
    expect(resolved.allowedScopes).toContain("ci:read");

    // A human principal has no machine-identity profile.
    await app.security.registerPrincipal({
      tenantId: "tenant-a",
      externalId: "human-1",
      kind: "human",
      displayName: "H",
      subjectRef: "kratos-9",
      tenantRef: "tenant-1",
    });
    expect(
      (
        await app.security.resolveMachineIdentity({
          tenantId: "tenant-a",
          principalExternalId: "human-1",
        })
      ).status,
    ).toBe(404);
  });
});
