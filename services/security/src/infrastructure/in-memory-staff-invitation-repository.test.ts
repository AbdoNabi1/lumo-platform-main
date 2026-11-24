import { UniqueEntityId } from "@platform/domain";
import { ConflictError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { INVITATION_TTL_MS, StaffInvitation } from "../domain/staff-invitation";
import { InMemoryStaffInvitationRepository } from "./in-memory-staff-invitation-repository";
import { registerStaffInvitationContract } from "./staff-invitation-repository.contract";

const make = (email: string, tokenHash = "h".repeat(64)) =>
  StaffInvitation.create(
    UniqueEntityId.from(crypto.randomUUID()),
    {
      tenantId: "t1",
      email,
      principalExternalId: "p-1",
      roleKey: "viewer",
      invitedBy: "o",
      tokenHash,
    },
    new Date("2026-11-26T10:00:00Z"),
    INVITATION_TTL_MS,
  );

describe("InMemoryStaffInvitationRepository", () => {
  registerStaffInvitationContract(() => ({
    repo: new InMemoryStaffInvitationRepository(),
    run: (work) => work(undefined),
    tenant: () => `t-${crypto.randomUUID()}`,
  }));

  it("keeps an immutable snapshot: mutating the saved aggregate afterwards changes nothing stored", async () => {
    const repo = new InMemoryStaffInvitationRepository();
    const inv = make("sam@example.com");
    await repo.save(inv);
    inv.revoke(new Date("2026-11-26T11:00:00Z")); // not saved
    expect((await repo.findById("t1", inv.id.toString()))?.status).toBe("pending");
  });

  it("rejects a token hash reused by another invitation, like the unique index", async () => {
    const repo = new InMemoryStaffInvitationRepository();
    await repo.save(make("a@example.com", "same".padEnd(64, "0")));
    await expect(repo.save(make("b@example.com", "same".padEnd(64, "0")))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
