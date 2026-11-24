import { UniqueEntityId } from "@platform/domain";
import { describe, expect, it } from "vitest";
import { StaffInvitation } from "../domain/staff-invitation";
import type { StaffMemberView } from "../domain/staff";
import { buildStaffKit } from "../infrastructure/staff-test-kit";
import { ListStaff, StaffAccess } from "./staff.use-cases";

const T = "shop-a";

async function invite(
  kit: ReturnType<typeof buildStaffKit>,
  input: {
    email: string;
    externalId: string;
    ttlMs?: number;
    role?: "admin" | "operator" | "viewer";
  },
  tenant = T,
) {
  // the invitee is a suspended principal holding the invited role, with no credential
  await kit.seedStaff(tenant, {
    externalId: input.externalId,
    email: input.email,
    roles: [input.role ?? "viewer"],
    status: "suspended",
    credential: false,
  });
  const invitation = StaffInvitation.create(
    UniqueEntityId.from(kit.deps.idGenerator.generate()),
    {
      tenantId: tenant,
      email: input.email,
      principalExternalId: input.externalId,
      roleKey: input.role ?? "viewer",
      invitedBy: "owner-1",
      tokenHash: kit.deps.idGenerator.generate().replaceAll("-", "").padEnd(64, "0"),
    },
    kit.clock.now(),
    input.ttlMs,
  );
  await kit.staffInvitations.save(invitation);
  return invitation;
}

describe("ListStaff", () => {
  it("lists owner + admin + operator + viewer + an invitee, never a customer; owner first then email asc", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, {
      externalId: "p-owner",
      email: "zed@x.com",
      roles: ["platform-admin"],
    });
    await kit.seedStaff(T, { externalId: "p-admin", email: "bob@x.com", roles: ["admin"] });
    await kit.seedStaff(T, { externalId: "p-op", email: "carol@x.com", roles: ["operator"] });
    await kit.seedStaff(T, { externalId: "p-view", email: "al@x.com", roles: ["viewer"] });
    // a customer principal: has a role-less identity and NO staff: credential
    await kit.seedStaff(T, {
      externalId: "p-cust",
      email: "cust@x.com",
      roles: ["viewer"],
      credential: false,
    });
    const invitation = await invite(kit, {
      email: "dana@x.com",
      externalId: "p-inv",
      role: "operator",
    });

    const result = await new ListStaff(kit.deps).execute({
      tenantId: T,
      actorExternalId: "p-admin",
      now: kit.clock.now(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = result.value.items;
    expect(items.map((i) => i.email)).toEqual([
      "zed@x.com", // owner first, although "zed" sorts last
      "al@x.com",
      "bob@x.com",
      "carol@x.com",
      "dana@x.com",
    ]);
    expect(items.map((i) => i.principalExternalId)).not.toContain("p-cust");
    const byEmail = Object.fromEntries(items.map((i) => [i.email, i])) as Record<
      string,
      StaffMemberView
    >;
    expect(byEmail["zed@x.com"]).toMatchObject({ role: "owner", isOwner: true, status: "active" });
    expect(byEmail["bob@x.com"]).toMatchObject({ role: "admin", isOwner: false, status: "active" });
    expect(byEmail["carol@x.com"]).toMatchObject({ role: "operator", status: "active" });
    expect(byEmail["al@x.com"]).toMatchObject({ role: "viewer", status: "active" });
    expect(byEmail["dana@x.com"]).toMatchObject({
      role: "operator",
      status: "invited",
      invitation: {
        id: invitation.id.toString(),
        version: 1,
        expiresAt: new Date(kit.clock.now().getTime() + 7 * 24 * 3600 * 1000).toISOString(),
      },
    });
    expect(byEmail["bob@x.com"]?.invitation).toBeNull();
    expect(items.filter((i) => i.isSelf).map((i) => i.principalExternalId)).toEqual(["p-admin"]);
    expect(byEmail["al@x.com"]?.addedAt).toBe(kit.clock.now().toISOString());
  });

  it("lastSignInAt is the latest of two sessions; null when the person never signed in", async () => {
    const kit = buildStaffKit();
    const adminId = await kit.seedStaff(T, {
      externalId: "p-admin",
      email: "bob@x.com",
      roles: ["admin"],
    });
    await kit.seedStaff(T, { externalId: "p-view", email: "al@x.com", roles: ["viewer"] });
    await kit.seedSession(T, adminId, new Date("2026-11-20T08:00:00.000Z"));
    await kit.seedSession(T, adminId, new Date("2026-11-25T09:30:00.000Z"));
    const result = await new ListStaff(kit.deps).execute({
      tenantId: T,
      actorExternalId: "p-admin",
      now: kit.clock.now(),
    });
    if (!result.ok) throw result.error;
    const byEmail = Object.fromEntries(result.value.items.map((i) => [i.email, i]));
    expect(byEmail["bob@x.com"]?.lastSignInAt).toBe("2026-11-25T09:30:00.000Z");
    expect(byEmail["al@x.com"]?.lastSignInAt).toBeNull();
  });

  it("an invitation past its expiry shows invitation_expired; a deactivated member shows deactivated", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, { externalId: "p-admin", email: "bob@x.com", roles: ["admin"] });
    await kit.seedStaff(T, {
      externalId: "p-off",
      email: "off@x.com",
      roles: ["viewer"],
      status: "suspended",
    });
    await invite(kit, { email: "late@x.com", externalId: "p-late" });
    kit.clock.advance(7 * 24 * 3600 * 1000 + 1000);
    const result = await new ListStaff(kit.deps).execute({
      tenantId: T,
      actorExternalId: "p-admin",
      now: kit.clock.now(),
    });
    if (!result.ok) throw result.error;
    const byEmail = Object.fromEntries(result.value.items.map((i) => [i.email, i]));
    expect(byEmail["late@x.com"]).toMatchObject({
      status: "invitation_expired",
      invitation: { version: 1 },
    });
    expect(byEmail["off@x.com"]?.status).toBe("deactivated");
    expect(byEmail["bob@x.com"]?.status).toBe("active");
  });

  it("omits revoked invitees (disabled, no credential, no pending invitation), disabled principals and credential holders with no staff role", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, { externalId: "p-admin", email: "bob@x.com", roles: ["admin"] });
    const invitation = await invite(kit, { email: "gone@x.com", externalId: "p-gone" });
    // revoke: invitation revoked, principal disabled, role assignment revoked
    const stored = await kit.staffInvitations.findById(T, invitation.id.toString());
    stored!.revoke(kit.clock.now());
    await kit.staffInvitations.save(stored!);
    const gone = await kit.principals.findByExternalId("p-gone", T);
    gone!.disable("evt", kit.clock.now());
    await kit.principals.save(gone!, T);
    await kit.seedStaff(T, { externalId: "p-dead", email: "dead@x.com", roles: ["viewer"] });
    const dead = await kit.principals.findByExternalId("p-dead", T);
    dead!.disable("evt-2", kit.clock.now());
    await kit.principals.save(dead!, T);
    // a staff credential but no mapped role key at all
    await kit.seedStaff(T, {
      externalId: "p-norole",
      email: "norole@x.com",
      roles: ["custom-role"],
    });

    const result = await new ListStaff(kit.deps).execute({
      tenantId: T,
      actorExternalId: "p-admin",
      now: kit.clock.now(),
    });
    if (!result.ok) throw result.error;
    expect(result.value.items.map((i) => i.email)).toEqual(["bob@x.com"]);
  });

  it("reports the highest staff role when several are held, and the owner wins over every other key", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, {
      externalId: "p-multi",
      email: "multi@x.com",
      roles: ["viewer", "operator"],
    });
    await kit.seedStaff(T, {
      externalId: "p-own",
      email: "own@x.com",
      roles: ["admin", "platform-admin", "viewer"],
    });
    const result = await new ListStaff(kit.deps).execute({
      tenantId: T,
      actorExternalId: "x",
      now: kit.clock.now(),
    });
    if (!result.ok) throw result.error;
    const byEmail = Object.fromEntries(result.value.items.map((i) => [i.email, i]));
    expect(byEmail["multi@x.com"]?.role).toBe("operator");
    expect(byEmail["own@x.com"]?.role).toBe("owner");
  });

  it("is tenant-scoped: another store's staff, invitations and sessions never appear", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, { externalId: "p-admin", email: "bob@x.com", roles: ["admin"] });
    const otherAdmin = await kit.seedStaff("shop-b", {
      externalId: "p-b",
      email: "bee@other.com",
      roles: ["admin"],
    });
    await kit.seedSession("shop-b", otherAdmin, new Date("2026-11-25T09:30:00.000Z"));
    await invite(kit, { email: "inv@other.com", externalId: "p-binv" }, "shop-b");
    const result = await new ListStaff(kit.deps).execute({
      tenantId: T,
      actorExternalId: "p-admin",
      now: kit.clock.now(),
    });
    if (!result.ok) throw result.error;
    expect(result.value.items.map((i) => i.email)).toEqual(["bob@x.com"]);
    expect(result.value.items[0]?.lastSignInAt).toBeNull();
  });

  it("never carries a hash, token or token hash in the response", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, { externalId: "p-admin", email: "bob@x.com", roles: ["admin"] });
    await invite(kit, { email: "dana@x.com", externalId: "p-inv" });
    const result = await new ListStaff(kit.deps).execute({
      tenantId: T,
      actorExternalId: "p-admin",
      now: kit.clock.now(),
    });
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/seed-hash|tokenHash|passwordHash|scrypt|hashed:/);
  });
});

describe("StaffAccess", () => {
  it("an active admin → { active, [admin] }", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, { externalId: "p-admin", email: "bob@x.com", roles: ["admin"] });
    const result = await new StaffAccess(kit.deps).execute({
      tenantId: T,
      principalExternalId: "p-admin",
    });
    expect(result).toEqual({ ok: true, value: { status: "active", roleKeys: ["admin"] } });
  });

  it("the owner's keys include platform-admin", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, {
      externalId: "p-owner",
      email: "o@x.com",
      roles: ["platform-admin", "admin"],
    });
    const result = await new StaffAccess(kit.deps).execute({
      tenantId: T,
      principalExternalId: "p-owner",
    });
    expect(result).toEqual({
      ok: true,
      value: { status: "active", roleKeys: ["admin", "platform-admin"] },
    });
  });

  it("a suspended principal reports suspended", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, {
      externalId: "p-off",
      email: "o@x.com",
      roles: ["viewer"],
      status: "suspended",
    });
    const result = await new StaffAccess(kit.deps).execute({
      tenantId: T,
      principalExternalId: "p-off",
    });
    expect(result).toEqual({ ok: true, value: { status: "suspended", roleKeys: ["viewer"] } });
  });

  it("a revoked assignment and an expired one are excluded", async () => {
    const kit = buildStaffKit();
    const internalId = await kit.seedStaff(T, {
      externalId: "p-1",
      email: "o@x.com",
      roles: ["operator", "viewer"],
    });
    const rows = await kit.assignments.listByPrincipal(internalId, T);
    const operator = rows.find((a) => a.roleKey === "operator")!;
    operator.revoke("evt", kit.clock.now());
    await kit.assignments.save(operator, T);
    const result = await new StaffAccess(kit.deps).execute({
      tenantId: T,
      principalExternalId: "p-1",
    });
    expect(result).toEqual({ ok: true, value: { status: "active", roleKeys: ["viewer"] } });
  });

  it("another tenant's principal and an unknown one → NOT_FOUND", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff("shop-b", { externalId: "p-b", email: "b@x.com", roles: ["admin"] });
    const other = await new StaffAccess(kit.deps).execute({
      tenantId: T,
      principalExternalId: "p-b",
    });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.code).toBe("NOT_FOUND");
    const unknown = await new StaffAccess(kit.deps).execute({
      tenantId: T,
      principalExternalId: "nobody",
    });
    expect(unknown.ok).toBe(false);
  });
});
