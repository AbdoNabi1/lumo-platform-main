import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSecurity } from "../composition";
import { InMemoryIdentityProjectionStore } from "../infrastructure/identity-projection";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-07-18T00:00:00.000Z") };
const body = <T>(r: { body: unknown }): T => r.body as T;

/** Resolution use-cases at the controller boundary (H-2), independent of the event transport. */
describe("resolution use-cases (H-2)", () => {
  it("resolvePrincipal returns a null principal but the projected user when Security has no principal yet", async () => {
    const identityProjection = new InMemoryIdentityProjectionStore();
    await identityProjection.upsertUser({
      userId: "kratos-1",
      userTenant: "t1",
      status: "active",
      occurredAt: "2026-07-18T00:00:00.000Z",
    });
    const app = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      identityProjection,
    });

    const resolved = body<{ principal: unknown; identityUser: { userId: string } | null }>(
      await app.security.resolvePrincipal({ subjectRef: "kratos-1" }),
    );
    expect(resolved.principal).toBeNull(); // no Security principal registered
    expect(resolved.identityUser?.userId).toBe("kratos-1"); // but the Identity user is projected
  });

  it("resolveOrganization 404s for an unknown org", async () => {
    const app = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
    });
    expect((await app.security.resolveOrganization({ organizationId: "nope" })).status).toBe(404);
  });

  it("resolveMachineIdentity 404s for a principal that is not governed", async () => {
    const app = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
    });
    await app.security.registerPrincipal({
      externalId: "svc-x",
      kind: "service_account",
      displayName: "X",
      tenantRef: "t1",
    });
    expect(
      (await app.security.resolveMachineIdentity({ principalExternalId: "svc-x" })).status,
    ).toBe(404);
  });
});
