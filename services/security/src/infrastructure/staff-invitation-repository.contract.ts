import { UniqueEntityId } from "@platform/domain";
import { ConcurrencyError, ConflictError } from "@platform/utils";
import { expect, it } from "vitest";
import type { StaffInvitationRepository } from "../domain/repositories";
import { INVITATION_TTL_MS, StaffInvitation } from "../domain/staff-invitation";

/**
 * Behaviour every `StaffInvitationRepository` adapter must share. The in-memory twin runs it
 * unconditionally; the Prisma adapter runs it inside the DATABASE_URL_TEST-gated integration suite.
 * `run` hands the adapter the transaction handle it needs for writes (Prisma: the UoW tx; in-memory:
 * undefined).
 */
export interface StaffInvitationContractHarness {
  readonly repo: StaffInvitationRepository;
  readonly run: <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;
  /** A fresh tenant id per call, so suites sharing one database never collide. */
  readonly tenant: () => string;
}

const NOW = new Date("2026-11-26T10:00:00.000Z");

export function registerStaffInvitationContract(
  wire: () => StaffInvitationContractHarness | Promise<StaffInvitationContractHarness>,
): void {
  const uuid = (): string => crypto.randomUUID();
  const hash = (): string => crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");
  const make = (
    tenantId: string,
    email: string,
    overrides: { id?: string; tokenHash?: string } = {},
  ): StaffInvitation =>
    StaffInvitation.create(
      UniqueEntityId.from(overrides.id ?? uuid()),
      {
        tenantId,
        email,
        principalExternalId: uuid(),
        roleKey: "operator",
        invitedBy: "owner-1",
        tokenHash: overrides.tokenHash ?? hash(),
      },
      NOW,
      INVITATION_TTL_MS,
    );

  it("create persists version 1; update persists version 2; the aggregate's version never changes", async () => {
    const { repo, run, tenant } = await wire();
    const tenantId = tenant();
    const inv = make(tenantId, "sam@example.com");
    expect(await run((tx) => repo.save(inv, tx))).toBe(1);
    expect(inv.version).toBe(0);

    const loaded = (await repo.findById(tenantId, inv.id.toString()))!;
    expect(loaded.version).toBe(1);
    expect(loaded.email).toBe("sam@example.com");
    expect(loaded.status).toBe("pending");
    expect(loaded.expiresAt).toEqual(inv.expiresAt);
    expect(loaded.tokenHash).toBe(inv.tokenHash);

    const later = new Date(NOW.getTime() + 1000);
    loaded.accept(later);
    expect(await run((tx) => repo.save(loaded, tx))).toBe(2);
    expect(loaded.version).toBe(1);

    const again = (await repo.findById(tenantId, inv.id.toString()))!;
    expect(again.version).toBe(2);
    expect(again.status).toBe("accepted");
    expect(again.acceptedAt).toEqual(later);
  });

  it("a stale save throws ConcurrencyError and leaves the stored row untouched", async () => {
    const { repo, run, tenant } = await wire();
    const tenantId = tenant();
    const inv = make(tenantId, "sam@example.com");
    await run((tx) => repo.save(inv, tx));
    const winner = (await repo.findById(tenantId, inv.id.toString()))!;
    const loser = (await repo.findById(tenantId, inv.id.toString()))!;
    winner.revoke(NOW);
    await run((tx) => repo.save(winner, tx));
    loser.accept(NOW);
    await expect(run((tx) => repo.save(loser, tx))).rejects.toBeInstanceOf(ConcurrencyError);
    const stored = (await repo.findById(tenantId, inv.id.toString()))!;
    expect(stored.status).toBe("revoked");
    expect(stored.version).toBe(2);
  });

  it("reads hand back a fresh aggregate each time (mutating one never leaks into the store)", async () => {
    const { repo, run, tenant } = await wire();
    const tenantId = tenant();
    const inv = make(tenantId, "sam@example.com");
    await run((tx) => repo.save(inv, tx));
    const first = (await repo.findById(tenantId, inv.id.toString()))!;
    first.revoke(NOW);
    const second = (await repo.findById(tenantId, inv.id.toString()))!;
    expect(second).not.toBe(first);
    expect(second.status).toBe("pending");
  });

  it("a second pending invitation for the same email → ConflictError; accepted/revoked ones do not block", async () => {
    const { repo, run, tenant } = await wire();
    const tenantId = tenant();
    const first = make(tenantId, "sam@example.com");
    await run((tx) => repo.save(first, tx));
    const dup = make(tenantId, "sam@example.com");
    await expect(run((tx) => repo.save(dup, tx))).rejects.toThrow(
      new ConflictError("This email already has a pending invitation"),
    );
    await expect(run((tx) => repo.save(dup, tx))).rejects.toBeInstanceOf(ConflictError);

    const loaded = (await repo.findById(tenantId, first.id.toString()))!;
    loaded.revoke(NOW);
    await run((tx) => repo.save(loaded, tx));
    const second = make(tenantId, "sam@example.com");
    await run((tx) => repo.save(second, tx));
    const loadedSecond = (await repo.findById(tenantId, second.id.toString()))!;
    loadedSecond.accept(NOW);
    await run((tx) => repo.save(loadedSecond, tx));
    const third = make(tenantId, "sam@example.com");
    await run((tx) => repo.save(third, tx)); // revoked + accepted rows present, still fine
    expect((await repo.findPendingByEmail(tenantId, "sam@example.com"))?.id.toString()).toBe(
      third.id.toString(),
    );
  });

  it("renewing a pending invitation rotates its token hash without colliding with itself", async () => {
    const { repo, run, tenant } = await wire();
    const tenantId = tenant();
    const inv = make(tenantId, "sam@example.com");
    await run((tx) => repo.save(inv, tx));
    const loaded = (await repo.findById(tenantId, inv.id.toString()))!;
    const newHash = hash();
    loaded.renew(NOW, INVITATION_TTL_MS, newHash);
    expect(await run((tx) => repo.save(loaded, tx))).toBe(2);
    expect(await repo.findByTokenHash(tenantId, inv.tokenHash)).toBeNull();
    expect((await repo.findByTokenHash(tenantId, newHash))?.id.toString()).toBe(inv.id.toString());
  });

  it("findPendingByEmail / findByTokenHash / listPending only see their own tenant", async () => {
    const { repo, run, tenant } = await wire();
    const a = tenant();
    const b = tenant();
    const invA = make(a, "sam@example.com");
    const invB = make(b, "sam@example.com"); // same email, other tenant: allowed
    await run((tx) => repo.save(invA, tx));
    await run((tx) => repo.save(invB, tx));

    expect((await repo.findPendingByEmail(a, "sam@example.com"))?.id.toString()).toBe(
      invA.id.toString(),
    );
    expect((await repo.findPendingByEmail(b, "sam@example.com"))?.id.toString()).toBe(
      invB.id.toString(),
    );
    expect(await repo.findPendingByEmail(a, "nobody@example.com")).toBeNull();
    expect(await repo.findById(b, invA.id.toString())).toBeNull();
    expect(await repo.findByTokenHash(b, invA.tokenHash)).toBeNull();
    expect((await repo.findByTokenHash(a, invA.tokenHash))?.email).toBe("sam@example.com");
    expect((await repo.listPending(a)).map((i) => i.id.toString())).toEqual([invA.id.toString()]);
    expect((await repo.listPending(b)).map((i) => i.id.toString())).toEqual([invB.id.toString()]);
  });

  it("listPending omits accepted and revoked invitations and orders by email", async () => {
    const { repo, run, tenant } = await wire();
    const tenantId = tenant();
    const zed = make(tenantId, "zed@example.com");
    const amy = make(tenantId, "amy@example.com");
    const gone = make(tenantId, "gone@example.com");
    for (const inv of [zed, amy, gone]) await run((tx) => repo.save(inv, tx));
    const loaded = (await repo.findById(tenantId, gone.id.toString()))!;
    loaded.revoke(NOW);
    await run((tx) => repo.save(loaded, tx));
    expect((await repo.listPending(tenantId)).map((i) => i.email)).toEqual([
      "amy@example.com",
      "zed@example.com",
    ]);
  });

  it("findById with a non-UUID id returns null", async () => {
    const { repo, tenant } = await wire();
    expect(await repo.findById(tenant(), "not-a-uuid")).toBeNull();
    expect(await repo.findById(tenant(), "")).toBeNull();
  });

  it("findPendingByEmail ignores a non-pending invitation, findByTokenHash still resolves it", async () => {
    const { repo, run, tenant } = await wire();
    const tenantId = tenant();
    const inv = make(tenantId, "sam@example.com");
    await run((tx) => repo.save(inv, tx));
    const loaded = (await repo.findById(tenantId, inv.id.toString()))!;
    loaded.revoke(NOW);
    await run((tx) => repo.save(loaded, tx));
    expect(await repo.findPendingByEmail(tenantId, "sam@example.com")).toBeNull();
    expect((await repo.findByTokenHash(tenantId, inv.tokenHash))?.status).toBe("revoked");
  });
}
