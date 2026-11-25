import type { Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { INVITATION_TTL_MS } from "../domain/staff-invitation";
import { buildStaffKit, type StaffKit } from "../infrastructure/staff-test-kit";
import {
  AcceptStaffInvitation,
  ChangeStaffRole,
  CreateStaffInvitation,
  RenewStaffInvitation,
  RevokeStaffInvitation,
  SetStaffActive,
} from "./staff-commands.use-cases";
import { ListStaff } from "./staff.use-cases";
import { adminsAfterChange, loadStaffDirectory } from "./staff-support";

const T = "shop-a";
const WEEK = INVITATION_TTL_MS;
const hash = (c: string): string => c.repeat(64);

function failure<V>(result: Result<V, DomainError>): DomainError {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.value)}`);
  return result.error;
}
function value<V>(result: Result<V, DomainError>): V {
  if (!result.ok)
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** Owner + admin + operator + viewer, the usual cast. */
async function cast(kit: StaffKit) {
  await kit.seedStaff(T, {
    externalId: "p-owner",
    email: "owner@x.com",
    roles: ["platform-admin"],
  });
  await kit.seedStaff(T, { externalId: "p-admin", email: "admin@x.com", roles: ["admin"] });
  await kit.seedStaff(T, { externalId: "p-op", email: "op@x.com", roles: ["operator"] });
  await kit.seedStaff(T, { externalId: "p-view", email: "view@x.com", roles: ["viewer"] });
}

const roleKeysOf = async (kit: StaffKit, externalId: string, tenant = T): Promise<string[]> => {
  const principal = await kit.principals.findByExternalId(externalId, tenant);
  const rows = await kit.assignments.listByPrincipal(principal!.id.toString(), tenant);
  return rows
    .filter((a) => a.isActiveAt(kit.clock.now()))
    .map((a) => a.roleKey)
    .sort();
};
const statusOf = async (kit: StaffKit, externalId: string, tenant = T) =>
  (await kit.principals.findByExternalId(externalId, tenant))?.status;
const audits = async (kit: StaffKit, tenant = T) =>
  (await kit.deps.auditLedger.list(null, tenant)).map((r) => r.content);

describe("ChangeStaffRole", () => {
  const run = (
    kit: StaffKit,
    input: { actor?: string; target: string; role: string; tenant?: string },
  ) =>
    new ChangeStaffRole(kit.deps).execute({
      tenantId: input.tenant ?? T,
      actorExternalId: input.actor ?? "p-owner",
      targetExternalId: input.target,
      role: input.role as "admin",
    });

  it("operator → viewer: the old assignment is revoked, the new one active, audited with {actor,target,from,to}", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    const result = await run(kit, { target: "p-op", role: "viewer" });
    expect(value(result)).toEqual({ role: "viewer" });
    expect(await roleKeysOf(kit, "p-op")).toEqual(["viewer"]);
    const principal = await kit.principals.findByExternalId("p-op", T);
    const rows = await kit.assignments.listByPrincipal(principal!.id.toString(), T);
    expect(rows.map((a) => [a.roleKey, a.status]).sort()).toEqual([
      ["operator", "revoked"],
      ["viewer", "active"],
    ]);
    const record = (await audits(kit)).find((a) => a.action === "security.staff.role_changed");
    expect(record).toMatchObject({
      principalRef: "p-op",
      decision: "allow",
      metadata: { actor: "p-owner", target: "p-op", from: "operator", to: "viewer" },
    });
  });

  it("defines the three staff roles on first use (idempotent), with no permissions", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    await run(kit, { target: "p-op", role: "viewer" });
    await run(kit, { target: "p-view", role: "operator" });
    const roles = await kit.deps.roles.findByKeys(["admin", "operator", "viewer"], T);
    expect(roles.map((r) => r.key).sort()).toEqual(["admin", "operator", "viewer"]);
    expect(roles.every((r) => r.permissions.length === 0)).toBe(true);
  });

  it("demoting the only `admin` while an owner exists is fine", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    expect(value(await run(kit, { target: "p-admin", role: "operator" }))).toEqual({
      role: "operator",
    });
    expect(await roleKeysOf(kit, "p-admin")).toEqual(["operator"]);
  });

  it("an owner is never changed (BUSINESS_RULE) and nothing is written", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    const before = await kit.snapshot(T);
    const error = failure(await run(kit, { actor: "p-admin", target: "p-owner", role: "viewer" }));
    expect([error.code, error.message]).toEqual([
      "BUSINESS_RULE",
      "The store owner's role can't be changed",
    ]);
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("nobody changes their own role (BUSINESS_RULE), nothing written", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    const before = await kit.snapshot(T);
    const error = failure(await run(kit, { actor: "p-admin", target: "p-admin", role: "viewer" }));
    expect([error.code, error.message]).toEqual([
      "BUSINESS_RULE",
      "You can't change your own role",
    ]);
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("a store whose only admin-level principal is the target: the change is rejected and nothing changed", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, { externalId: "p-solo", email: "solo@x.com", roles: ["admin"] });
    await kit.seedStaff(T, { externalId: "p-op", email: "op@x.com", roles: ["operator"] });
    const before = await kit.snapshot(T);
    const error = failure(await run(kit, { actor: "p-solo", target: "p-solo", role: "viewer" }));
    expect(error.code).toBe("BUSINESS_RULE");
    expect(await kit.snapshot(T)).toBe(before);
    // and nobody else can act: an operator is not an admin → 403, still nothing changed
    const denied = failure(await run(kit, { actor: "p-op", target: "p-solo", role: "viewer" }));
    expect(denied.code).toBe("FORBIDDEN");
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("the last-admin rule itself (defence in depth): removing the only admin-level principal leaves zero", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, { externalId: "p-solo", email: "solo@x.com", roles: ["admin"] });
    await kit.seedStaff(T, { externalId: "p-op", email: "op@x.com", roles: ["operator"] });
    await kit.seedStaff(T, {
      externalId: "p-susp",
      email: "s@x.com",
      roles: ["admin"],
      status: "suspended",
    });
    const directory = await loadStaffDirectory(kit.deps, T, kit.clock.now());
    expect([...directory.adminLevel]).toEqual(["p-solo"]); // a suspended admin does not count
    expect(adminsAfterChange(directory, { removed: "p-solo" })).toBe(0);
    expect(adminsAfterChange(directory, { removed: "p-op" })).toBe(1);
    expect(adminsAfterChange(directory, { removed: "p-solo", added: "p-op" })).toBe(1);
  });

  it("an actor who is not an active admin gets FORBIDDEN and nothing is written", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    await kit.seedStaff(T, {
      externalId: "p-off",
      email: "off@x.com",
      roles: ["admin"],
      status: "suspended",
    });
    const before = await kit.snapshot(T);
    for (const actor of ["p-op", "p-view", "p-off", "nobody"]) {
      expect(failure(await run(kit, { actor, target: "p-view", role: "operator" })).code).toBe(
        "FORBIDDEN",
      );
    }
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("unknown, other-tenant, customer and revoked-invitee targets are NOT_FOUND, nothing written", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    await kit.seedStaff("shop-b", { externalId: "p-other", email: "o@y.com", roles: ["operator"] });
    await kit.seedStaff(T, {
      externalId: "p-cust",
      email: "c@x.com",
      roles: ["viewer"],
      credential: false,
    });
    const created = value(
      await new CreateStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        principalExternalId: "p-inv",
        email: "inv@x.com",
        role: "viewer",
        tokenHash: hash("a"),
        now: kit.clock.now(),
      }),
    );
    value(
      await new RevokeStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        invitationId: created.invitationId,
        expectedVersion: 1,
        now: kit.clock.now(),
      }),
    );
    const before = await kit.snapshot(T, [created.invitationId]);
    for (const target of ["nobody", "p-cust", "p-inv"]) {
      expect(failure(await run(kit, { target, role: "viewer" })).code).toBe("NOT_FOUND");
    }
    expect(failure(await run(kit, { target: "p-other", role: "viewer" })).code).toBe("NOT_FOUND");
    expect(await kit.snapshot(T, [created.invitationId])).toBe(before);
    expect(await roleKeysOf(kit, "p-other", "shop-b")).toEqual(["operator"]);
  });

  it("an unchanged role is a no-op success: no writes, no audit", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    const before = await kit.snapshot(T);
    expect(value(await run(kit, { target: "p-op", role: "operator" }))).toEqual({
      role: "operator",
    });
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("an invalid role is VALIDATION on `role`", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    const before = await kit.snapshot(T);
    const error = failure(await run(kit, { target: "p-op", role: "platform-admin" }));
    expect(error.code).toBe("VALIDATION");
    expect(JSON.stringify(error)).toContain("role");
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("an invited target IS a staff member here: its pending assignment is replaced", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    value(
      await new CreateStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        principalExternalId: "p-inv",
        email: "inv@x.com",
        role: "viewer",
        tokenHash: hash("a"),
        now: kit.clock.now(),
      }),
    );
    expect(value(await run(kit, { target: "p-inv", role: "admin" }))).toEqual({ role: "admin" });
    expect(await roleKeysOf(kit, "p-inv")).toEqual(["admin"]);
    const listed = value(
      await new ListStaff(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        now: kit.clock.now(),
      }),
    );
    expect(listed.items.find((i) => i.email === "inv@x.com")).toMatchObject({
      role: "admin",
      status: "invited",
    });
    // a still-suspended invitee does not count as an admin
    const directory = await loadStaffDirectory(kit.deps, T, kit.clock.now());
    expect(directory.adminLevel.has("p-inv")).toBe(false);
  });

  it("two ownerless admins demoting each other in parallel: exactly one wins, one admin remains", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, { externalId: "p-a", email: "a@x.com", roles: ["admin"] });
    await kit.seedStaff(T, { externalId: "p-b", email: "b@x.com", roles: ["admin"] });
    const [first, second] = await Promise.all([
      run(kit, { actor: "p-a", target: "p-b", role: "viewer" }),
      run(kit, { actor: "p-b", target: "p-a", role: "viewer" }),
    ]);
    const outcomes = [first, second];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    const loser = failure(outcomes.find((r) => !r.ok)!);
    expect(["FORBIDDEN", "BUSINESS_RULE"]).toContain(loser.code);
    const admins = [
      (await roleKeysOf(kit, "p-a")).includes("admin"),
      (await roleKeysOf(kit, "p-b")).includes("admin"),
    ];
    expect(admins.filter(Boolean)).toHaveLength(1);
  });

  it("control: without the staff lock the same race leaves ZERO admins (what the lock prevents)", async () => {
    const kit = buildStaffKit({
      lock: { withTenantStaffLock: (_tenant, _tx, fn) => fn() },
    });
    await kit.seedStaff(T, { externalId: "p-a", email: "a@x.com", roles: ["admin"] });
    await kit.seedStaff(T, { externalId: "p-b", email: "b@x.com", roles: ["admin"] });
    const results = await Promise.all([
      run(kit, { actor: "p-a", target: "p-b", role: "viewer" }),
      run(kit, { actor: "p-b", target: "p-a", role: "viewer" }),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await roleKeysOf(kit, "p-a")).toEqual(["viewer"]);
    expect(await roleKeysOf(kit, "p-b")).toEqual(["viewer"]);
  });
});

describe("SetStaffActive", () => {
  const run = (
    kit: StaffKit,
    input: { actor?: string; target: string; active: boolean; tenant?: string },
  ) =>
    new SetStaffActive(kit.deps).execute({
      tenantId: input.tenant ?? T,
      actorExternalId: input.actor ?? "p-owner",
      targetExternalId: input.target,
      active: input.active,
    });

  it("deactivate: principal suspended, every active session revoked, audited", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    const internal = (await kit.principals.findByExternalId("p-op", T))!.id.toString();
    await kit.seedSession(T, internal, new Date("2026-11-26T09:00:00.000Z"));
    await kit.seedSession(T, internal, new Date("2026-11-26T10:00:00.000Z"));
    expect(value(await run(kit, { target: "p-op", active: false }))).toEqual({
      status: "deactivated",
    });
    expect(await statusOf(kit, "p-op")).toBe("suspended");
    const sessions = await kit.sessions.listByPrincipal(internal, T);
    expect(sessions.map((s) => s.status)).toEqual(["revoked", "revoked"]);
    const actions = (await audits(kit)).map((a) => a.action);
    expect(actions).toContain("security.staff.deactivated");
    expect(
      (await audits(kit)).find((a) => a.action === "security.staff.deactivated"),
    ).toMatchObject({
      principalRef: "p-op",
      metadata: { actor: "p-owner", target: "p-op" },
    });
  });

  it("reactivate: suspended → active, audited", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    await run(kit, { target: "p-op", active: false });
    expect(value(await run(kit, { target: "p-op", active: true }))).toEqual({ status: "active" });
    expect(await statusOf(kit, "p-op")).toBe("active");
    expect((await audits(kit)).map((a) => a.action)).toContain("security.staff.reactivated");
  });

  it("owner and self are refused with their own texts; nothing written", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    const before = await kit.snapshot(T);
    const owner = failure(await run(kit, { actor: "p-admin", target: "p-owner", active: false }));
    expect([owner.code, owner.message]).toEqual([
      "BUSINESS_RULE",
      "The store owner can't be deactivated",
    ]);
    const self = failure(await run(kit, { actor: "p-admin", target: "p-admin", active: false }));
    expect([self.code, self.message]).toEqual(["BUSINESS_RULE", "You can't deactivate yourself"]);
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("an invited target → BUSINESS_RULE 'Revoke the invitation instead'", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    value(
      await new CreateStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        principalExternalId: "p-inv",
        email: "inv@x.com",
        role: "viewer",
        tokenHash: hash("a"),
        now: kit.clock.now(),
      }),
    );
    const before = await kit.snapshot(T);
    const error = failure(await run(kit, { target: "p-inv", active: true }));
    expect([error.code, error.message]).toEqual(["BUSINESS_RULE", "Revoke the invitation instead"]);
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("repeating the request is a no-op success", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    await run(kit, { target: "p-op", active: false });
    const before = await kit.snapshot(T);
    expect(value(await run(kit, { target: "p-op", active: false }))).toEqual({
      status: "deactivated",
    });
    expect(value(await run(kit, { target: "p-view", active: true }))).toEqual({ status: "active" });
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("non-admin actor → FORBIDDEN; unknown/other-tenant/customer target → NOT_FOUND; nothing written", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    await kit.seedStaff("shop-b", { externalId: "p-other", email: "o@y.com", roles: ["operator"] });
    await kit.seedStaff(T, {
      externalId: "p-cust",
      email: "c@x.com",
      roles: ["viewer"],
      credential: false,
    });
    const before = await kit.snapshot(T);
    expect(failure(await run(kit, { actor: "p-op", target: "p-view", active: false })).code).toBe(
      "FORBIDDEN",
    );
    for (const target of ["nobody", "p-other", "p-cust"]) {
      expect(failure(await run(kit, { target, active: false })).code).toBe("NOT_FOUND");
    }
    expect(await kit.snapshot(T)).toBe(before);
    expect(await statusOf(kit, "p-other", "shop-b")).toBe("active");
  });

  it("two ownerless admins deactivating each other in parallel: one wins, one admin stays active", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, { externalId: "p-a", email: "a@x.com", roles: ["admin"] });
    await kit.seedStaff(T, { externalId: "p-b", email: "b@x.com", roles: ["admin"] });
    const results = await Promise.all([
      run(kit, { actor: "p-a", target: "p-b", active: false }),
      run(kit, { actor: "p-b", target: "p-a", active: false }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(["FORBIDDEN", "BUSINESS_RULE"]).toContain(failure(results.find((r) => !r.ok)!).code);
    const statuses = [await statusOf(kit, "p-a"), await statusOf(kit, "p-b")];
    expect(statuses.filter((s) => s === "active")).toHaveLength(1);
  });
});

describe("CreateStaffInvitation", () => {
  const run = (
    kit: StaffKit,
    over: Partial<Parameters<CreateStaffInvitation["execute"]>[0]> = {},
  ) =>
    new CreateStaffInvitation(kit.deps).execute({
      tenantId: T,
      actorExternalId: "p-owner",
      principalExternalId: "p-new",
      email: "sam@example.com",
      role: "operator",
      tokenHash: hash("a"),
      now: kit.clock.now(),
      ...over,
    });

  it("creates a suspended principal with the role, a pending invitation (7 days) and NO credential", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    const out = value(await run(kit));
    expect(out).toEqual({
      invitationId: expect.any(String),
      principalExternalId: "p-new",
      identifier: "staff:sam@example.com",
    });
    const principal = await kit.principals.findByExternalId("p-new", T);
    expect(principal).toMatchObject({
      status: "suspended",
      kind: "human",
      displayName: "sam@example.com",
      subjectRef: "p-new",
      tenantRef: T,
    });
    expect(await roleKeysOf(kit, "p-new")).toEqual(["operator"]);
    const invitation = await kit.staffInvitations.findById(T, out.invitationId);
    expect(invitation).toMatchObject({
      status: "pending",
      email: "sam@example.com",
      principalExternalId: "p-new",
      roleKey: "operator",
      invitedBy: "p-owner",
      tokenHash: hash("a"),
    });
    expect(invitation!.expiresAt.getTime()).toBe(kit.clock.now().getTime() + WEEK);
    expect(await kit.staffCredentials.find(T, "staff:sam@example.com")).toBeNull();
    expect(await kit.staffCredentials.findByPrincipal(T, "p-new")).toBeNull();
    const record = (await audits(kit)).find((a) => a.action === "security.staff.invited");
    expect(record).toMatchObject({
      principalRef: "p-new",
      metadata: {
        actor: "p-owner",
        target: "p-new",
        role: "operator",
        invitationId: out.invitationId,
      },
    });
  });

  it("normalises ' Sam@Example.COM '", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    const out = value(await run(kit, { email: " Sam@Example.COM " }));
    expect(out.identifier).toBe("staff:sam@example.com");
    const invitation = await kit.staffInvitations.findById(T, out.invitationId);
    expect(invitation?.email).toBe("sam@example.com");
  });

  it("an existing staff email → CONFLICT, nothing written", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    const before = await kit.snapshot(T);
    const error = failure(await run(kit, { email: "ADMIN@x.com" }));
    expect([error.code, error.message]).toEqual([
      "CONFLICT",
      "This person is already on your staff",
    ]);
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("a pending invitation for the email → CONFLICT, nothing written", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    value(await run(kit));
    const before = await kit.snapshot(T);
    const error = failure(await run(kit, { principalExternalId: "p-other", tokenHash: hash("b") }));
    expect([error.code, error.message]).toEqual([
      "CONFLICT",
      "This email already has a pending invitation",
    ]);
    expect(await kit.snapshot(T)).toBe(before);
  });

  it.each([
    ["not an address", "sam"],
    ["no domain dot", "sam@example"],
    ["spaces inside", "sa m@example.com"],
    ["empty", "   "],
    ["over 254 chars", `${"a".repeat(250)}@example.com`],
  ])("bad email (%s) → VALIDATION on `email`, nothing written", async (_label, email) => {
    const kit = buildStaffKit();
    await cast(kit);
    const before = await kit.snapshot(T);
    const error = failure(await run(kit, { email }));
    expect(error.code).toBe("VALIDATION");
    expect(JSON.stringify(error)).toContain("email");
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("a bad role or an empty token hash is VALIDATION; the owner key is not an invitable role", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    const before = await kit.snapshot(T);
    expect(failure(await run(kit, { role: "platform-admin" as "admin" })).code).toBe("VALIDATION");
    expect(failure(await run(kit, { tokenHash: " " })).code).toBe("VALIDATION");
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("a non-admin actor → FORBIDDEN, nothing written", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    const before = await kit.snapshot(T);
    expect(failure(await run(kit, { actorExternalId: "p-op" })).code).toBe("FORBIDDEN");
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("a reused principal id or token hash → CONFLICT, nothing written", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    value(await run(kit));
    const before = await kit.snapshot(T);
    expect(failure(await run(kit, { email: "x@x.com", tokenHash: hash("a") })).code).toBe(
      "CONFLICT",
    );
    expect(failure(await run(kit, { email: "y@x.com", tokenHash: hash("c") })).code).toBe(
      "CONFLICT",
    ); // p-new exists
    expect(await kit.snapshot(T)).toBe(before);
  });

  it("the invited person is listed as `invited` and never carries a token hash outward", async () => {
    const kit = buildStaffKit();
    await cast(kit);
    value(await run(kit));
    const listed = value(
      await new ListStaff(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        now: kit.clock.now(),
      }),
    );
    expect(listed.items.find((i) => i.email === "sam@example.com")).toMatchObject({
      status: "invited",
      role: "operator",
      invitation: { version: 1 },
    });
    expect(JSON.stringify(listed)).not.toContain(hash("a"));
    expect(JSON.stringify(await audits(kit))).not.toContain(hash("a"));
  });
});

describe("Renew / Revoke StaffInvitation", () => {
  async function invited(kit: StaffKit) {
    await cast(kit);
    return value(
      await new CreateStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        principalExternalId: "p-new",
        email: "sam@example.com",
        role: "operator",
        tokenHash: hash("a"),
        now: kit.clock.now(),
      }),
    );
  }
  const renew = (kit: StaffKit, over: Partial<Parameters<RenewStaffInvitation["execute"]>[0]>) =>
    new RenewStaffInvitation(kit.deps).execute({
      tenantId: T,
      actorExternalId: "p-owner",
      invitationId: "",
      expectedVersion: 1,
      tokenHash: hash("b"),
      now: kit.clock.now(),
      ...over,
    });
  const revoke = (kit: StaffKit, over: Partial<Parameters<RevokeStaffInvitation["execute"]>[0]>) =>
    new RevokeStaffInvitation(kit.deps).execute({
      tenantId: T,
      actorExternalId: "p-owner",
      invitationId: "",
      expectedVersion: 1,
      now: kit.clock.now(),
      ...over,
    });

  it("renew rotates the token hash, restarts the 7 days and bumps the version; the old hash stops resolving", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    kit.clock.advance(3 * 24 * 3600 * 1000);
    const out = value(await renew(kit, { invitationId }));
    expect(out).toEqual({ invitationId, version: 2, email: "sam@example.com" });
    const inv = await kit.staffInvitations.findById(T, invitationId);
    expect(inv?.tokenHash).toBe(hash("b"));
    expect(inv!.expiresAt.getTime()).toBe(kit.clock.now().getTime() + WEEK);
    expect(await kit.staffInvitations.findByTokenHash(T, hash("a"))).toBeNull();
    expect(
      (await audits(kit)).find((a) => a.action === "security.staff.invitation_renewed"),
    ).toMatchObject({
      principalRef: "p-new",
      metadata: { actor: "p-owner", target: "p-new", invitationId },
    });
  });

  it("an expired pending invitation can be renewed", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    kit.clock.advance(WEEK + 1000);
    expect(value(await renew(kit, { invitationId })).version).toBe(2);
  });

  it("a stale expectedVersion → CONFLICT 'changed by someone else', nothing written", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    value(await renew(kit, { invitationId }));
    const before = await kit.snapshot(T, [invitationId]);
    const error = failure(
      await renew(kit, { invitationId, expectedVersion: 1, tokenHash: hash("c") }),
    );
    expect([error.code, error.message]).toEqual([
      "CONFLICT",
      "This invitation was changed by someone else",
    ]);
    expect(failure(await revoke(kit, { invitationId, expectedVersion: 1 })).code).toBe("CONFLICT");
    expect(await kit.snapshot(T, [invitationId])).toBe(before);
  });

  it("unknown or other-tenant invitation → NOT_FOUND; non-admin actor → FORBIDDEN; reused token hash → CONFLICT", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    const before = await kit.snapshot(T, [invitationId]);
    expect(failure(await renew(kit, { invitationId: "nope" })).code).toBe("NOT_FOUND");
    expect(failure(await renew(kit, { invitationId, tenantId: "shop-b" })).code).toBe("FORBIDDEN");
    expect(failure(await revoke(kit, { invitationId: "nope" })).code).toBe("NOT_FOUND");
    expect(failure(await renew(kit, { invitationId, actorExternalId: "p-op" })).code).toBe(
      "FORBIDDEN",
    );
    expect(failure(await renew(kit, { invitationId, tokenHash: hash("a") })).code).toBe("CONFLICT");
    expect(await kit.snapshot(T, [invitationId])).toBe(before);
  });

  it("other tenant: an admin of shop-b cannot see or touch shop-a's invitation (NOT_FOUND)", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    await kit.seedStaff("shop-b", {
      externalId: "p-bo",
      email: "bo@y.com",
      roles: ["platform-admin"],
    });
    const before = await kit.snapshot(T, [invitationId]);
    expect(
      failure(await renew(kit, { invitationId, tenantId: "shop-b", actorExternalId: "p-bo" })).code,
    ).toBe("NOT_FOUND");
    expect(
      failure(await revoke(kit, { invitationId, tenantId: "shop-b", actorExternalId: "p-bo" }))
        .code,
    ).toBe("NOT_FOUND");
    expect(await kit.snapshot(T, [invitationId])).toBe(before);
  });

  it("revoke: invitation revoked, its role assignments revoked, principal suspended → disabled; returns {invitationId,email,principalExternalId}", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    const out = value(await revoke(kit, { invitationId }));
    expect(out).toEqual({ invitationId, email: "sam@example.com", principalExternalId: "p-new" });
    expect((await kit.staffInvitations.findById(T, invitationId))?.status).toBe("revoked");
    expect(await roleKeysOf(kit, "p-new")).toEqual([]);
    expect(await statusOf(kit, "p-new")).toBe("disabled");
    expect(
      (await audits(kit)).find((a) => a.action === "security.staff.invitation_revoked"),
    ).toMatchObject({
      principalRef: "p-new",
      metadata: { actor: "p-owner", target: "p-new", invitationId },
    });
    const listed = value(
      await new ListStaff(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        now: kit.clock.now(),
      }),
    );
    expect(listed.items.map((i) => i.email)).not.toContain("sam@example.com");
  });

  it("revoking or renewing a non-pending invitation → BUSINESS_RULE, nothing written", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    value(await revoke(kit, { invitationId }));
    const before = await kit.snapshot(T, [invitationId]);
    expect(failure(await revoke(kit, { invitationId, expectedVersion: 2 })).code).toBe(
      "BUSINESS_RULE",
    );
    expect(failure(await renew(kit, { invitationId, expectedVersion: 2 })).code).toBe(
      "BUSINESS_RULE",
    );
    expect(await kit.snapshot(T, [invitationId])).toBe(before);
  });

  it("revoke → re-invite the same email works with a NEW principal and the old token stays dead", async () => {
    const kit = buildStaffKit();
    const first = await invited(kit);
    value(await revoke(kit, { invitationId: first.invitationId }));
    const second = value(
      await new CreateStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        principalExternalId: "p-new-2",
        email: "sam@example.com",
        role: "viewer",
        tokenHash: hash("d"),
        now: kit.clock.now(),
      }),
    );
    expect(second.invitationId).not.toBe(first.invitationId);
    expect(await statusOf(kit, "p-new-2")).toBe("suspended");
    expect(await kit.staffInvitations.findByTokenHash(T, hash("a"))).toMatchObject({
      status: "revoked",
    });
    const accepted = await new AcceptStaffInvitation(kit.deps).execute({
      tenantId: T,
      tokenHash: hash("a"),
      password: "correct horse 1",
      now: kit.clock.now(),
    });
    expect(failure(accepted).code).toBe("BUSINESS_RULE");
  });
});

describe("AcceptStaffInvitation", () => {
  const PASSWORD = "correct horse 1";
  async function invited(kit: StaffKit) {
    await cast(kit);
    return value(
      await new CreateStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        principalExternalId: "p-new",
        email: "sam@example.com",
        role: "operator",
        tokenHash: hash("a"),
        now: kit.clock.now(),
      }),
    );
  }
  const accept = (
    kit: StaffKit,
    over: Partial<Parameters<AcceptStaffInvitation["execute"]>[0]> = {},
  ) =>
    new AcceptStaffInvitation(kit.deps).execute({
      tenantId: T,
      tokenHash: hash("a"),
      password: PASSWORD,
      now: kit.clock.now(),
      ...over,
    });

  it("saves the hashed credential in the same command, activates the principal, accepts the invitation and audits as the invitee", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    expect(await kit.staffCredentials.find(T, "staff:sam@example.com")).toBeNull(); // unusable before
    const out = value(await accept(kit));
    expect(out).toEqual({ principalExternalId: "p-new", email: "sam@example.com" });
    expect(await kit.staffCredentials.find(T, "staff:sam@example.com")).toMatchObject({
      principalExternalId: "p-new",
      passwordHash: `hashed:${PASSWORD}`,
    });
    expect(await statusOf(kit, "p-new")).toBe("active");
    expect((await kit.staffInvitations.findById(T, invitationId))?.status).toBe("accepted");
    expect(await roleKeysOf(kit, "p-new")).toEqual(["operator"]);
    const record = (await audits(kit)).find(
      (a) => a.action === "security.staff.invitation_accepted",
    );
    expect(record).toMatchObject({
      principalRef: "p-new",
      metadata: { actor: "invitee", target: "p-new", invitationId },
    });
    expect(JSON.stringify(await audits(kit))).not.toContain(PASSWORD);
    const listed = value(
      await new ListStaff(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        now: kit.clock.now(),
      }),
    );
    expect(listed.items.find((i) => i.email === "sam@example.com")).toMatchObject({
      status: "active",
      invitation: null,
    });
  });

  it("a 7-character password is VALIDATION on `password`, nothing changes and the token still works", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    const before = await kit.snapshot(T, [invitationId]);
    const error = failure(await accept(kit, { password: "1234567" }));
    expect(error.code).toBe("VALIDATION");
    expect(JSON.stringify(error)).toContain("password");
    expect(failure(await accept(kit, { password: "x".repeat(257) })).code).toBe("VALIDATION");
    expect(await kit.snapshot(T, [invitationId])).toBe(before);
    expect(value(await accept(kit)).principalExternalId).toBe("p-new");
  });

  it("an expired invitation, an unknown token and a revoked one → BUSINESS_RULE 'no longer valid', nothing written", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    const before = await kit.snapshot(T, [invitationId]);
    kit.clock.advance(WEEK + 1000);
    const expired = failure(await accept(kit));
    expect([expired.code, expired.message]).toEqual([
      "BUSINESS_RULE",
      "This invitation is no longer valid",
    ]);
    expect(failure(await accept(kit, { tokenHash: hash("z") })).code).toBe("BUSINESS_RULE");
    expect(failure(await accept(kit, { tokenHash: "" })).code).toBe("BUSINESS_RULE");
    kit.clock.set(new Date("2026-11-27T10:00:00.000Z"));
    expect(await kit.snapshot(T, [invitationId])).toBe(before);
    value(
      await new RevokeStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        invitationId,
        expectedVersion: 1,
        now: kit.clock.now(),
      }),
    );
    const afterRevoke = await kit.snapshot(T, [invitationId]);
    expect(failure(await accept(kit)).code).toBe("BUSINESS_RULE");
    expect(await kit.snapshot(T, [invitationId])).toBe(afterRevoke);
    expect(await kit.staffCredentials.find(T, "staff:sam@example.com")).toBeNull();
  });

  it("a second accept with the same token → BUSINESS_RULE and the first password is untouched", async () => {
    const kit = buildStaffKit();
    await invited(kit);
    value(await accept(kit));
    const failed = failure(await accept(kit, { password: "another password" }));
    expect(failed.code).toBe("BUSINESS_RULE");
    expect((await kit.staffCredentials.find(T, "staff:sam@example.com"))?.passwordHash).toBe(
      `hashed:${PASSWORD}`,
    );
  });

  it("after a resend the OLD token is rejected and the NEW one works", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    value(
      await new RenewStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        invitationId,
        expectedVersion: 1,
        tokenHash: hash("b"),
        now: kit.clock.now(),
      }),
    );
    expect(failure(await accept(kit, { tokenHash: hash("a") })).code).toBe("BUSINESS_RULE");
    expect(value(await accept(kit, { tokenHash: hash("b") })).email).toBe("sam@example.com");
  });

  it("a staff credential that appeared for the email meanwhile → BUSINESS_RULE, nothing written", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    await kit.staffCredentials.save({
      tenantId: T,
      identifier: "staff:sam@example.com",
      principalExternalId: "someone-else",
      passwordHash: "their-hash",
    });
    const before = await kit.snapshot(T, [invitationId]);
    expect(failure(await accept(kit)).code).toBe("BUSINESS_RULE");
    expect(await kit.snapshot(T, [invitationId])).toBe(before);
  });

  it("atomic: when the credential write fails nothing else was written (credential is the first write)", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    const before = await kit.snapshot(T, [invitationId]);
    kit.staffCredentials.save = () => Promise.reject(new Error("db down"));
    await expect(accept(kit)).rejects.toThrow("db down");
    expect(await kit.snapshot(T, [invitationId])).toBe(before);
    expect(await statusOf(kit, "p-new")).toBe("suspended");
  });

  it("another tenant's token never resolves", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    const before = await kit.snapshot(T, [invitationId]);
    expect(failure(await accept(kit, { tenantId: "shop-b" })).code).toBe("BUSINESS_RULE");
    expect(await kit.snapshot(T, [invitationId])).toBe(before);
  });

  it("revoked invitee principals are NOT_FOUND for every staff command", async () => {
    const kit = buildStaffKit();
    const { invitationId } = await invited(kit);
    value(
      await new RevokeStaffInvitation(kit.deps).execute({
        tenantId: T,
        actorExternalId: "p-owner",
        invitationId,
        expectedVersion: 1,
        now: kit.clock.now(),
      }),
    );
    expect(
      failure(
        await new SetStaffActive(kit.deps).execute({
          tenantId: T,
          actorExternalId: "p-owner",
          targetExternalId: "p-new",
          active: true,
        }),
      ).code,
    ).toBe("NOT_FOUND");
  });
});
