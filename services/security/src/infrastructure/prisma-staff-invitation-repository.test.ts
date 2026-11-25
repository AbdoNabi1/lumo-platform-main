import type { Database } from "@platform/db";
import { UniqueEntityId } from "@platform/domain";
import { ConcurrencyError, ConflictError, UnexpectedError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { INVITATION_TTL_MS, StaffInvitation } from "../domain/staff-invitation";
import { PrismaStaffInvitationRepository } from "./prisma-staff-invitation-repository";

const ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-26T10:00:00.000Z");
const HASH = "h".repeat(64);
const make = () =>
  StaffInvitation.create(
    UniqueEntityId.from(ID),
    {
      tenantId: "tenant-a",
      email: "sam@example.com",
      principalExternalId: "p-1",
      roleKey: "operator",
      invitedBy: "owner",
      tokenHash: HASH,
    },
    NOW,
    INVITATION_TTL_MS,
  );
const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  tenantId: "tenant-a",
  email: "sam@example.com",
  principalExternalId: "p-1",
  roleKey: "operator",
  invitedBy: "owner",
  tokenHash: HASH,
  status: "pending",
  expiresAt: new Date("2026-12-03T10:00:00.000Z"),
  acceptedAt: null,
  version: 3,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

describe("PrismaStaffInvitationRepository (no database)", () => {
  const repo = new PrismaStaffInvitationRepository({ prisma: {} as Database });

  it("writes require the unit of work's tx, with the exact text", async () => {
    await expect(repo.save(make())).rejects.toThrow(
      "PrismaStaffInvitationRepository.save requires the unit of work's transaction client (ADR-0003).",
    );
    await expect(repo.save(make(), null)).rejects.toThrow(
      /requires the unit of work's transaction/,
    );
  });

  it("findById with a non-UUID returns null without querying", async () => {
    const tx = {
      securityStaffInvitation: {
        findFirst: async () => {
          throw new Error("must not query");
        },
      },
    };
    expect(await repo.findById("tenant-a", "nope", tx)).toBeNull();
  });

  it("create inserts version 1 with the tenant on the row", async () => {
    const created: unknown[] = [];
    const tx = {
      securityStaffInvitation: {
        create: async (args: unknown) => {
          created.push(args);
        },
      },
    };
    expect(await repo.save(make(), tx)).toBe(1);
    expect(created).toEqual([
      {
        data: expect.objectContaining({
          id: ID,
          tenantId: "tenant-a",
          email: "sam@example.com",
          roleKey: "operator",
          tokenHash: HASH,
          status: "pending",
          version: 1,
        }),
      },
    ]);
  });

  it("update is guarded by id + tenantId + version and increments the version", async () => {
    const calls: Record<string, unknown>[] = [];
    const tx = {
      securityStaffInvitation: {
        findFirst: async () => row(),
        updateMany: async (args: Record<string, unknown>) => {
          calls.push(args);
          return { count: 1 };
        },
      },
    };
    const inv = (await repo.findById("tenant-a", ID, tx))!;
    inv.revoke(NOW);
    expect(await repo.save(inv, tx)).toBe(4);
    expect(inv.version).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]!["where"]).toEqual({ id: ID, tenantId: "tenant-a", version: 3 });
    expect(calls[0]!["data"]).toEqual(
      expect.objectContaining({ status: "revoked", version: { increment: 1 } }),
    );
  });

  it("0 updated rows → ConcurrencyError", async () => {
    const tx = {
      securityStaffInvitation: {
        findFirst: async () => row(),
        updateMany: async () => ({ count: 0 }),
      },
    };
    const inv = (await repo.findById("tenant-a", ID, tx))!;
    await expect(repo.save(inv, tx)).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("maps unique violations (pending-per-email, token hash) to ConflictError", async () => {
    const violation = (target: unknown) => ({
      securityStaffInvitation: {
        create: async () => {
          throw Object.assign(new Error("unique"), { code: "P2002", meta: { target } });
        },
      },
    });
    await expect(
      repo.save(make(), violation("staff_invitations_one_pending_per_email")),
    ).rejects.toThrow(new ConflictError("This email already has a pending invitation"));
    await expect(repo.save(make(), violation(["tenant_id", "email"]))).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(repo.save(make(), violation(["token_hash"]))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("rethrows non-unique errors untouched", async () => {
    const tx = {
      securityStaffInvitation: {
        create: async () => {
          throw new Error("connection reset");
        },
      },
    };
    await expect(repo.save(make(), tx)).rejects.toThrow("connection reset");
  });

  it("every read puts tenantId in its where", async () => {
    const wheres: Record<string, unknown>[] = [];
    const tx = {
      securityStaffInvitation: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          wheres.push(args.where);
          return null;
        },
        findMany: async (args: { where: Record<string, unknown> }) => {
          wheres.push(args.where);
          return [];
        },
      },
    };
    await repo.findById("tenant-a", ID, tx);
    await repo.findPendingByEmail("tenant-a", "sam@example.com", tx);
    await repo.findByTokenHash("tenant-a", HASH, tx);
    await repo.listPending("tenant-a", tx);
    expect(wheres).toEqual([
      { id: ID, tenantId: "tenant-a" },
      { tenantId: "tenant-a", email: "sam@example.com", status: "pending" },
      { tenantId: "tenant-a", tokenHash: HASH },
      { tenantId: "tenant-a", status: "pending" },
    ]);
  });

  it("a corrupt stored role or status is an UnexpectedError, not a silent default", async () => {
    const tx = (over: Record<string, unknown>) => ({
      securityStaffInvitation: { findFirst: async () => row(over) },
    });
    await expect(repo.findById("tenant-a", ID, tx({ roleKey: "root" }))).rejects.toBeInstanceOf(
      UnexpectedError,
    );
    await expect(repo.findById("tenant-a", ID, tx({ status: "expired" }))).rejects.toBeInstanceOf(
      UnexpectedError,
    );
  });
});
