import { UniqueEntityId } from "@platform/domain";
import { describe, expect, it } from "vitest";
import { MfaEnrollment } from "../domain/mfa-enrollment";
import { InMemoryMfaEnrollmentRepository } from "./in-memory-repositories";
import * as M from "./prisma-mappers";
import { PrismaMfaEnrollmentRepository } from "./prisma-repositories";

const NOW = new Date("2026-11-27T10:00:00.000Z");
const enrollment = (
  id: string,
  principalRef: string,
  opts: { active?: boolean; revoked?: boolean; method?: "totp" | "webauthn" } = {},
): MfaEnrollment => {
  const e = MfaEnrollment.enroll(
    UniqueEntityId.from(id),
    { principalRef, method: opts.method ?? "totp", secretRef: `s-${id}` },
    `evt-${id}`,
    NOW,
  );
  if (opts.active === true) e.markVerified(`v-${id}`, NOW);
  if (opts.revoked === true) e.revoke(`r-${id}`, NOW);
  return e;
};
const repoDeps = {
  outbox: { write: async () => undefined },
  context: {},
} as never;

describe("MfaEnrollmentMapper lastUsedStep", () => {
  it("writes lastUsedStep on create and on update", () => {
    const e = enrollment("e-1", "p-1", { active: true });
    e.acceptStep(42);
    expect(M.MfaEnrollmentMapper.toRow(e, "t").lastUsedStep).toBe(42);
    expect(M.MfaEnrollmentMapper.toUpdate(e).lastUsedStep).toBe(42);
  });

  it("round-trips a used step and a null step", () => {
    const used = enrollment("e-1", "p-1", { active: true });
    used.acceptStep(42);
    const usedBack = M.MfaEnrollmentMapper.toDomain(M.MfaEnrollmentMapper.toRow(used, "t"));
    expect(usedBack.lastUsedStep).toBe(42);
    const fresh = enrollment("e-2", "p-1");
    const freshBack = M.MfaEnrollmentMapper.toDomain(M.MfaEnrollmentMapper.toRow(fresh, "t"));
    expect(freshBack.lastUsedStep).toBeNull();
  });
});

describe("InMemoryMfaEnrollmentRepository", () => {
  it("keeps lastUsedStep across save/find", async () => {
    const repo = new InMemoryMfaEnrollmentRepository(repoDeps);
    const e = enrollment("e-1", "p-1", { active: true });
    e.acceptStep(9);
    await repo.save(e, "t1");
    expect((await repo.findById("e-1", "t1"))!.lastUsedStep).toBe(9);
  });

  it("listActiveByPrincipals returns only active totp enrolments of the asked principals, keyed by principal", async () => {
    const repo = new InMemoryMfaEnrollmentRepository(repoDeps);
    await repo.save(enrollment("e-1", "p-1", { active: true }), "t1");
    await repo.save(enrollment("e-2", "p-2"), "t1"); // pending
    await repo.save(enrollment("e-3", "p-3", { active: true, revoked: true }), "t1"); // revoked
    await repo.save(enrollment("e-4", "p-4", { active: true, method: "webauthn" }), "t1");
    await repo.save(enrollment("e-5", "p-5", { active: true }), "t1"); // not asked
    const map = await repo.listActiveByPrincipals("t1", ["p-1", "p-2", "p-3", "p-4", "p-6"]);
    expect([...map.keys()]).toEqual(["p-1"]);
    expect(map.get("p-1")!.id.toString()).toBe("e-1");
  });

  it("listActiveByPrincipals never crosses tenants and handles an empty list", async () => {
    const repo = new InMemoryMfaEnrollmentRepository(repoDeps);
    await repo.save(enrollment("e-1", "p-1", { active: true }), "t1");
    expect((await repo.listActiveByPrincipals("t2", ["p-1"])).size).toBe(0);
    expect((await repo.listActiveByPrincipals("t1", [])).size).toBe(0);
  });
});

describe("PrismaMfaEnrollmentRepository.listActiveByPrincipals (no database)", () => {
  const repo = new PrismaMfaEnrollmentRepository({} as never);

  it("filters by tenant, principals, status active and method totp, and maps rows", async () => {
    const calls: unknown[] = [];
    const e = enrollment("e-1", "p-1", { active: true });
    e.acceptStep(5);
    const tx = {
      securityMfaEnrollment: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [{ ...M.MfaEnrollmentMapper.toRow(e, "t1"), version: 2 }];
        },
      },
    };
    const map = await repo.listActiveByPrincipals("t1", ["p-1", "p-2"], tx);
    expect(calls).toHaveLength(1);
    const where = (calls[0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({
      tenantId: "t1",
      principalRef: { in: ["p-1", "p-2"] },
      status: "active",
      method: "totp",
    });
    expect(map.get("p-1")!.lastUsedStep).toBe(5);
  });

  it("does not query for an empty principal list", async () => {
    const tx = {
      securityMfaEnrollment: {
        findMany: async () => {
          throw new Error("must not query");
        },
      },
    };
    expect((await repo.listActiveByPrincipals("t1", [], tx)).size).toBe(0);
  });
});
