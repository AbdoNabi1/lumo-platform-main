import { UniqueEntityId } from "@platform/domain";
import { BusinessRuleError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { INVITATION_TTL_MS, StaffInvitation } from "./staff-invitation";

const NOW = new Date("2026-11-26T10:00:00.000Z");
const ID = "00000000-0000-4000-8000-000000000001";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const make = (overrides: Partial<Parameters<typeof StaffInvitation.create>[1]> = {}) =>
  StaffInvitation.create(
    UniqueEntityId.from(ID),
    {
      tenantId: "t1",
      email: "sam@example.com",
      principalExternalId: "p-1",
      roleKey: "operator",
      invitedBy: "owner-1",
      tokenHash: HASH_A,
      ...overrides,
    },
    NOW,
    INVITATION_TTL_MS,
  );

describe("StaffInvitation aggregate", () => {
  it("INVITATION_TTL_MS is seven days", () => {
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 3600 * 1000);
  });

  it("create → pending, version 0, expiresAt = now + ttl, no acceptedAt", () => {
    const inv = make();
    expect(inv.version).toBe(0);
    expect(inv.status).toBe("pending");
    expect(inv.expiresAt.toISOString()).toBe("2026-12-03T10:00:00.000Z");
    expect(inv.acceptedAt).toBeNull();
    expect(inv.tokenHash).toBe(HASH_A);
    expect(inv.email).toBe("sam@example.com");
    expect(inv.createdAt).toEqual(NOW);
    expect(inv.updatedAt).toEqual(NOW);
  });

  it("create rejects an un-normalised email, a bad role, an empty token hash, a non-positive ttl", () => {
    expect(() => make({ email: " Sam@Example.com " })).toThrow(BusinessRuleError);
    expect(() => make({ email: "" })).toThrow(BusinessRuleError);
    expect(() => make({ roleKey: "platform-admin" as never })).toThrow(BusinessRuleError);
    expect(() => make({ tokenHash: "  " })).toThrow(BusinessRuleError);
    expect(() =>
      StaffInvitation.create(
        UniqueEntityId.from(ID),
        {
          tenantId: "t1",
          email: "a@b.co",
          principalExternalId: "p",
          roleKey: "viewer",
          invitedBy: "o",
          tokenHash: HASH_A,
        },
        NOW,
        0,
      ),
    ).toThrow(BusinessRuleError);
  });

  it("isExpired is false before and true at/after expiresAt", () => {
    const inv = make();
    expect(inv.isExpired(new Date(inv.expiresAt.getTime() - 1))).toBe(false);
    expect(inv.isExpired(inv.expiresAt)).toBe(true);
    expect(inv.isExpired(new Date(inv.expiresAt.getTime() + 1))).toBe(true);
  });

  it("accept (pending, unexpired) → accepted with acceptedAt", () => {
    const inv = make();
    const later = new Date(NOW.getTime() + 1000);
    inv.accept(later);
    expect(inv.status).toBe("accepted");
    expect(inv.acceptedAt).toEqual(later);
    expect(inv.updatedAt).toEqual(later);
  });

  it("accept an expired invitation → BusinessRuleError and stays pending", () => {
    const inv = make();
    expect(() => inv.accept(inv.expiresAt)).toThrow(
      new BusinessRuleError("This invitation is no longer valid"),
    );
    expect(inv.status).toBe("pending");
    expect(inv.acceptedAt).toBeNull();
  });

  it("accept a non-pending invitation (accepted or revoked) → BusinessRuleError", () => {
    const accepted = make();
    accepted.accept(NOW);
    expect(() => accepted.accept(NOW)).toThrow(BusinessRuleError);
    const revoked = make();
    revoked.revoke(NOW);
    expect(() => revoked.accept(NOW)).toThrow("This invitation is no longer valid");
  });

  it("revoke pending (even expired) → revoked; revoke non-pending → BusinessRuleError", () => {
    const inv = make();
    inv.revoke(new Date(inv.expiresAt.getTime() + 1000));
    expect(inv.status).toBe("revoked");
    expect(() => inv.revoke(NOW)).toThrow(BusinessRuleError);
    const accepted = make();
    accepted.accept(NOW);
    expect(() => accepted.revoke(NOW)).toThrow(BusinessRuleError);
  });

  it("renew rotates the token hash and restarts the clock, also for an expired pending invite", () => {
    const inv = make();
    const later = new Date(inv.expiresAt.getTime() + 5000); // expired
    inv.renew(later, INVITATION_TTL_MS, HASH_B);
    expect(inv.status).toBe("pending");
    expect(inv.tokenHash).toBe(HASH_B);
    expect(inv.expiresAt.getTime()).toBe(later.getTime() + INVITATION_TTL_MS);
    expect(inv.isExpired(later)).toBe(false);
    expect(inv.updatedAt).toEqual(later);
  });

  it("renew rejects non-pending invitations, an empty hash and a non-positive ttl", () => {
    const accepted = make();
    accepted.accept(NOW);
    expect(() => accepted.renew(NOW, INVITATION_TTL_MS, HASH_B)).toThrow(BusinessRuleError);
    const revoked = make();
    revoked.revoke(NOW);
    expect(() => revoked.renew(NOW, INVITATION_TTL_MS, HASH_B)).toThrow(BusinessRuleError);
    const pending = make();
    expect(() => pending.renew(NOW, INVITATION_TTL_MS, "")).toThrow(BusinessRuleError);
    expect(() => pending.renew(NOW, -1, HASH_B)).toThrow(BusinessRuleError);
    expect(pending.tokenHash).toBe(HASH_A);
  });

  it("reconstitute carries version and every field", () => {
    const inv = StaffInvitation.reconstitute(UniqueEntityId.from(ID), {
      tenantId: "t1",
      email: "sam@example.com",
      principalExternalId: "p-1",
      roleKey: "admin",
      invitedBy: "owner-1",
      tokenHash: HASH_A,
      status: "accepted",
      expiresAt: NOW,
      acceptedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      version: 4,
    });
    expect(inv.version).toBe(4);
    expect(inv.status).toBe("accepted");
    expect(inv.roleKey).toBe("admin");
  });
});
