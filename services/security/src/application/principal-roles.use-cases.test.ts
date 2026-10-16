import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSecurity } from "../composition";

const clock: Clock = { now: () => new Date("2026-10-07T00:00:00.000Z") };

function wire() {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  return wireSecurity({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    knownSubjects: ["staff-1"],
  });
}

describe("ListPrincipalRoleKeys (Plan 1B-2)", () => {
  it("lists the principal's active role keys; unknown principals have none", async () => {
    const { security } = wire();
    await security.defineRole({
      tenantId: "t",
      key: "operator",
      name: "Operator",
      permissions: ["orders:*"],
    });
    await security.registerPrincipal({
      tenantId: "t",
      externalId: "staff-1",
      kind: "human",
      displayName: "staff-1",
      subjectRef: "staff-1",
    });
    await security.assignRole({
      tenantId: "t",
      principalExternalId: "staff-1",
      roleKey: "operator",
      grantedBy: "test",
    });
    const listed = await security.listPrincipalRoleKeys({
      tenantId: "t",
      principalExternalId: "staff-1",
    });
    expect(listed).toEqual({ status: 200, body: { roleKeys: ["operator"] } });
    const unknown = await security.listPrincipalRoleKeys({
      tenantId: "t",
      principalExternalId: "nobody",
    });
    expect(unknown.body).toEqual({ roleKeys: [] });
  });

  it("does not leak another tenant's assignments", async () => {
    const { security } = wire();
    await security.defineRole({
      tenantId: "t",
      key: "operator",
      name: "Operator",
      permissions: ["orders:*"],
    });
    await security.registerPrincipal({
      tenantId: "t",
      externalId: "staff-1",
      kind: "human",
      displayName: "s",
      subjectRef: "staff-1",
    });
    await security.assignRole({
      tenantId: "t",
      principalExternalId: "staff-1",
      roleKey: "operator",
      grantedBy: "test",
    });
    const other = await security.listPrincipalRoleKeys({
      tenantId: "other",
      principalExternalId: "staff-1",
    });
    expect(other.body).toEqual({ roleKeys: [] });
  });
});
