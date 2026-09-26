import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSecurity, type SecurityController } from "@platform/security";
import { describe, expect, it, vi } from "vitest";
import { TenantProvisioner } from "./tenant-provisioning";

const clock: Clock = { now: () => new Date("2026-09-26T00:00:00.000Z") };
const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => logger,
};

function world(owners: readonly string[] = ["owner-a", "owner-b"]) {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const wired = wireSecurity({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    knownSubjects: owners,
  });
  return wired;
}

/** Wraps the controller so one named method fails (a non-2xx response) until `heal()` is called. */
function flaky(security: SecurityController, method: keyof SecurityController) {
  let broken = true;
  const proxy = new Proxy(security, {
    get(target, prop, receiver) {
      if (prop === method && broken) {
        return async () => ({ status: 500, body: { message: "injected failure" } });
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { security: proxy, heal: () => (broken = false) };
}

async function sessionFor(security: SecurityController, tenantId: string, principal: string) {
  const res = await security.establishSession({
    tenantId,
    principalExternalId: principal,
    refreshFingerprint: "fp",
    ttlSeconds: 3600,
  });
  return (res.body as { id: string }).id;
}

describe("TenantProvisioner (T10.6, Gap 2)", () => {
  it("yields an administrable tenant: baseline roles exist and the admin's permission check passes", async () => {
    const { security } = world();
    const p = new TenantProvisioner({ security, logger: logger as never });
    const report = await p.provision("t-1", { ownerExternalId: "owner-a" });
    expect(report.complete).toBe(true);
    expect(report.missing).toEqual([]);

    const explorer = await security.permissionExplorer("t-1");
    expect(explorer.roles.map((r) => r.key).sort()).toEqual(["platform-admin", "platform-service"]);

    const sessionId = await sessionFor(security, "t-1", "owner-a");
    const decision = await security.evaluateAccess({
      tenantId: "t-1",
      principalExternalId: "owner-a",
      permission: "orders:read",
      sessionId,
    });
    expect((decision.body as { allowed: boolean }).allowed).toBe(true);
    expect((decision.body as { roleKeys: string[] }).roleKeys).toContain("platform-admin");
  });

  it("is idempotent: provisioning twice creates no second role and grants nothing twice", async () => {
    const { security } = world();
    const p = new TenantProvisioner({ security, logger: logger as never });
    await p.provision("t-1", { ownerExternalId: "owner-a" });
    const second = await p.provision("t-1", { ownerExternalId: "owner-a" });
    expect(second.complete).toBe(true);
    expect((await security.permissionExplorer("t-1")).roles).toHaveLength(2);
    const state = await p.inspect("t-1", { ownerExternalId: "owner-a" });
    expect(state.owner).toEqual({ registered: true, adminAssignments: 1, enforcementGrants: 1 });
  });

  it("interrupted midway: reports itself INCOMPLETE naming what is missing — never 'ready'", async () => {
    const { security } = world();
    const f = flaky(security, "publishPolicyVersion");
    const p = new TenantProvisioner({ security: f.security, logger: logger as never });
    const report = await p.provision("t-1", { ownerExternalId: "owner-a" });
    expect(report.complete).toBe(false);
    expect(report.missing).toContain("policy");
    expect(report.steps.find((s) => s.name === "policy")?.error).toMatch(/injected failure/);
    // A fresh reader (another process, later) sees the same truth — it is derived from the stored state.
    const later = await new TenantProvisioner({ security, logger: logger as never }).inspect(
      "t-1",
      {
        ownerExternalId: "owner-a",
      },
    );
    expect(later.complete).toBe(false);
    expect(later.missing).toContain("policy");
  });

  it("resuming an interrupted provisioning completes it without duplicating what already exists", async () => {
    const { security } = world();
    const f = flaky(security, "publishPolicyVersion");
    const p = new TenantProvisioner({ security: f.security, logger: logger as never });
    await p.provision("t-1", { ownerExternalId: "owner-a" });
    f.heal();
    const resumed = await p.provision("t-1", { ownerExternalId: "owner-a" });
    expect(resumed.complete).toBe(true);
    expect((await security.permissionExplorer("t-1")).roles).toHaveLength(2);
    expect((await p.inspect("t-1", { ownerExternalId: "owner-a" })).owner?.adminAssignments).toBe(
      1,
    );
  });

  it("an owner-grant failure leaves the tenant incomplete even though the baseline is in place", async () => {
    const { security } = world();
    const f = flaky(security, "assignRole");
    const p = new TenantProvisioner({ security: f.security, logger: logger as never });
    const report = await p.provision("t-1", { ownerExternalId: "owner-a" });
    expect(report.complete).toBe(false);
    expect(report.missing).toEqual(["owner-admin-role"]);
  });

  it("writes the enforcement grant through Security (so the relation-sync consumer tenant-qualifies it)", async () => {
    const { security } = world();
    const spy = vi.spyOn(security, "writeRelationTuple");
    await new TenantProvisioner({ security, logger: logger as never }).provision("t-1", {
      ownerExternalId: "owner-a",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const input = spy.mock.calls[0]![0];
    expect(input.tenantId).toBe("t-1");
    expect(input.object).not.toMatch(/^tenant\//); // never pre-qualified here: the consumer adds it once
    expect(input).toMatchObject({
      namespace: "permissions",
      relation: "granted",
      subject: "owner-a",
    });
  });

  it("two tenants provisioned in one process do not see each other's roles, principals or grants", async () => {
    const { security } = world();
    const p = new TenantProvisioner({ security, logger: logger as never });
    await p.provision("t-1", { ownerExternalId: "owner-a" });
    await p.provision("t-2", { ownerExternalId: "owner-b" });

    const ids1 = (await security.identityOverview("t-1")).principals.map((x) => x.externalId);
    const ids2 = (await security.identityOverview("t-2")).principals.map((x) => x.externalId);
    expect(ids1).toEqual(["owner-a"]);
    expect(ids2).toEqual(["owner-b"]);

    // owner-a holds nothing in t-2: the same principal id is unknown there and t-2 is incomplete for it.
    const cross = await p.inspect("t-2", { ownerExternalId: "owner-a" });
    expect(cross.complete).toBe(false);
    expect(cross.owner?.registered).toBe(false);
    const denied = await security.evaluateAccess({
      tenantId: "t-2",
      principalExternalId: "owner-a",
      permission: "orders:read",
    });
    expect((denied.body as { roleKeys: string[] }).roleKeys).toEqual([]);
  });

  it("a tenant never provisioned reports every step missing", async () => {
    const { security } = world();
    const report = await new TenantProvisioner({ security, logger: logger as never }).inspect(
      "t-9",
    );
    expect(report.complete).toBe(false);
    expect(report.missing).toEqual(["roles", "policy", "profile"]);
  });
});
