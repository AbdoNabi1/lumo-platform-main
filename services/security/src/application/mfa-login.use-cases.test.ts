import type { Result } from "@platform/types";
import { ConcurrencyError, type DomainError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { MfaEnrollment } from "../domain/mfa-enrollment";
import { InMemoryTotpMfaProvider, NodeCrypto } from "../infrastructure/in-memory-auth-adapters";
import { buildStaffKit, type StaffKit } from "../infrastructure/staff-test-kit";
import { base32Decode, totp } from "../infrastructure/totp";
import { TotpMfaProvider } from "../infrastructure/totp-mfa-provider";
import type { MfaLoginDeps } from "./deps";
import { normalizeMfaCode, VerifyMfaLogin } from "./mfa-login.use-cases";

const T = "shop-a";
const KEY = "k".repeat(32);
const BACKUP = ["a1b2c3d4e5f6", "0123456789ab", "ffffffffffff"];

const failureOf = <V>(r: Result<V, DomainError>): DomainError => {
  if (r.ok) throw new Error(`expected failure, got ${JSON.stringify(r.value)}`);
  return r.error;
};
const valueOf = <V>(r: Result<V, DomainError>): V => {
  if (!r.ok) throw new Error(`expected success, got ${r.error.message}`);
  return r.value;
};

/** A member with an ACTIVE enrolment under the REAL totp provider and a fixed secret; fake time. */
async function setup(options: { active?: boolean; status?: "active" | "suspended" } = {}) {
  const kit = buildStaffKit();
  const crypto = new NodeCrypto();
  const provider = new TotpMfaProvider(crypto, kit.clock, { keyRef: KEY });
  const internalId = await kit.seedStaff(T, {
    externalId: "p-sam",
    email: "sam@x.com",
    roles: ["admin"],
    ...(options.status === undefined ? {} : { status: options.status }),
  });
  const enrolled = await provider.enroll({ principalRef: internalId, accountLabel: "sam@x.com" });
  const secret = base32Decode(enrolled.manualKey!);
  const enrollment = MfaEnrollment.enroll(
    kit.id(),
    { principalRef: internalId, method: "totp", secretRef: enrolled.secretRef },
    kit.deps.idGenerator.generate(),
    kit.clock.now(),
  );
  if (options.active !== false) enrollment.markVerified("e", kit.clock.now());
  enrollment.setBackupCodes(await Promise.all(BACKUP.map((c) => crypto.hash(c))));
  await kit.mfaEnrollments.save(enrollment, T);
  const deps = kit.mfaDeps(provider);
  const verify = new VerifyMfaLogin(deps);
  const at = (iso: string) => new Date(iso);
  const codeAt = (when: Date) => totp(secret, Math.floor(when.getTime() / 1000));
  const run = (code: string, now: Date, externalId = "p-sam") =>
    verify.execute({ tenantId: T, principalExternalId: externalId, code, now });
  return { kit, deps, enrollment, run, at, codeAt, secret, verify, internalId };
}

const logAudits = async (kit: StaffKit) =>
  (await kit.deps.auditLedger.list(T, T)).filter((r) =>
    r.content.action.startsWith("security.mfa.login_"),
  );

const T0 = new Date("2026-11-27T10:00:10.000Z");

describe("VerifyMfaLogin — authenticator codes (real TOTP provider, fake clock)", () => {
  it("accepts the right code and audits login_verified with only actor/target/method", async () => {
    const s = await setup();

    const out = valueOf(await s.run(s.codeAt(T0), T0));

    expect(out).toEqual({ principalExternalId: "p-sam", method: "totp" });
    const rows = await logAudits(s.kit);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content.action).toBe("security.mfa.login_verified");
    expect(rows[0]!.content.decision).toBe("allow");
    expect(rows[0]!.content.principalRef).toBe("p-sam");
    expect(rows[0]!.content.metadata).toEqual({ actor: "p-sam", target: "p-sam", method: "totp" });
    expect(s.enrollment.lastUsedStep).toBe(Math.floor(T0.getTime() / 30_000));
  });

  it("the same code twice in the same step: the second fails", async () => {
    const s = await setup();
    const code = s.codeAt(T0);

    expect((await s.run(code, T0)).ok).toBe(true);
    const second = await s.run(code, new Date(T0.getTime() + 5000));

    expect(failureOf(second).message).toBe("Invalid code");
    expect(failureOf(second).code).toBe("UNAUTHENTICATED");
  });

  it("a previous-step code after a newer step was used fails (and a still newer one works)", async () => {
    const s = await setup();
    const earlier = new Date(T0.getTime() - 30_000);
    const later = new Date(T0.getTime() + 30_000);

    expect((await s.run(s.codeAt(T0), T0)).ok).toBe(true);
    // The window still accepts now-1: the older code is rejected only because a newer step was spent.
    expect((await s.run(s.codeAt(earlier), T0)).ok).toBe(false);
    expect((await s.run(s.codeAt(later), later)).ok).toBe(true);
  });

  it("a wrong code fails, audits login_failed (deny) and spends nothing", async () => {
    const s = await setup();
    const right = s.codeAt(T0);
    const wrong = right === "000000" ? "000001" : "000000";

    const result = await s.run(wrong, T0);

    expect(failureOf(result).message).toBe("Invalid code");
    const rows = await logAudits(s.kit);
    expect(rows.map((r) => r.content.action)).toEqual(["security.mfa.login_failed"]);
    expect(rows[0]!.content.decision).toBe("deny");
    expect(rows[0]!.content.metadata).toEqual({ actor: "p-sam", target: "p-sam" });
    expect(s.enrollment.lastUsedStep).toBeNull();
    expect((await s.run(right, T0)).ok).toBe(true);
  });

  it("a code outside the ±1 step window fails", async () => {
    const s = await setup();
    const far = new Date(T0.getTime() + 90_000);

    expect((await s.run(s.codeAt(far), T0)).ok).toBe(false);
  });

  it("normalises spaces: '123 456' style input is accepted", async () => {
    const s = await setup();
    const code = s.codeAt(T0);

    expect((await s.run(` ${code.slice(0, 3)} ${code.slice(3)} `, T0)).ok).toBe(true);
  });

  it("shapes that are neither 6 digits nor 12 hex fail (empty, letters, 7 digits, 11 hex)", async () => {
    const s = await setup();

    for (const bad of ["", "abcdef", "1234567", "a1b2c3d4e5f", "a1b2c3d4e5f6a"]) {
      expect((await s.run(bad, T0)).ok).toBe(false);
    }
  });
});

describe("VerifyMfaLogin — backup codes", () => {
  it("a backup code works once; the same code again fails; another still works", async () => {
    const s = await setup();

    const first = valueOf(await s.run(BACKUP[0]!, T0));
    expect(first.method).toBe("backup");
    expect((await s.run(BACKUP[0]!, T0)).ok).toBe(false);
    expect((await s.run(BACKUP[1]!, T0)).ok).toBe(true);
    expect(s.enrollment.remainingBackupCodes).toBe(1);
    const rows = await logAudits(s.kit);
    expect(rows.map((r) => r.content.action)).toEqual([
      "security.mfa.login_verified",
      "security.mfa.login_failed",
      "security.mfa.login_verified",
    ]);
    expect(rows[0]!.content.metadata).toEqual({
      actor: "p-sam",
      target: "p-sam",
      method: "backup",
    });
  });

  it("accepts the display form (xxxx-xxxx-xxxx, upper case, padded)", async () => {
    const s = await setup();

    expect((await s.run("  A1B2-C3D4-E5F6 ", T0)).ok).toBe(true);
  });

  it("a code is never written to the audit ledger", async () => {
    const s = await setup();
    const code = s.codeAt(T0);
    await s.run(code, T0);
    await s.run(BACKUP[0]!, T0);
    await s.run("999999", T0);

    const dump = JSON.stringify((await s.kit.deps.auditLedger.list(T, T)).map((r) => r.content));

    expect(dump).not.toContain(code);
    expect(dump).not.toContain(BACKUP[0]!);
    expect(dump).not.toContain("999999");
  });
});

describe("VerifyMfaLogin — refusals (always the same generic failure)", () => {
  it("a suspended principal fails and is audited", async () => {
    const s = await setup({ status: "suspended" });

    const result = await s.run(s.codeAt(T0), T0);

    expect(failureOf(result).message).toBe("Invalid code");
    expect((await logAudits(s.kit)).map((r) => r.content.action)).toEqual([
      "security.mfa.login_failed",
    ]);
  });

  it("no active enrolment (pending only) fails", async () => {
    const s = await setup({ active: false });

    expect(failureOf(await s.run(s.codeAt(T0), T0)).message).toBe("Invalid code");
    expect((await logAudits(s.kit))[0]!.content.action).toBe("security.mfa.login_failed");
  });

  it("no enrolment at all fails", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, { externalId: "p-sam", email: "sam@x.com", roles: ["admin"] });
    const verify = new VerifyMfaLogin(kit.mfaDeps(new InMemoryTotpMfaProvider()));

    const result = await verify.execute({
      tenantId: T,
      principalExternalId: "p-sam",
      code: "123456",
      now: T0,
    });

    expect(failureOf(result).message).toBe("Invalid code");
  });

  it("a revoked enrolment fails", async () => {
    const s = await setup();
    s.enrollment.revoke("r", T0);
    await s.kit.mfaEnrollments.save(s.enrollment, T);

    expect((await s.run(s.codeAt(T0), T0)).ok).toBe(false);
  });

  it("an unknown principal fails with the SAME error and records NO audit row", async () => {
    const s = await setup();

    const result = await s.run(s.codeAt(T0), T0, "nobody");

    expect(failureOf(result).message).toBe("Invalid code");
    expect(failureOf(result).code).toBe("UNAUTHENTICATED");
    expect(await logAudits(s.kit)).toHaveLength(0);
  });

  it("another tenant's member is not reachable", async () => {
    const s = await setup();
    const verify = new VerifyMfaLogin(s.deps);

    const result = await verify.execute({
      tenantId: "shop-b",
      principalExternalId: "p-sam",
      code: s.codeAt(T0),
      now: T0,
    });

    expect(result.ok).toBe(false);
  });

  it("a ConcurrencyError from the save is a failure, never a success", async () => {
    const s = await setup();
    const losing: MfaLoginDeps = {
      ...s.deps,
      mfaEnrollments: Object.assign(Object.create(s.deps.mfaEnrollments) as object, {
        save: () => Promise.reject(new ConcurrencyError()),
      }) as unknown as MfaLoginDeps["mfaEnrollments"],
    };

    const result = await new VerifyMfaLogin(losing).execute({
      tenantId: T,
      principalExternalId: "p-sam",
      code: BACKUP[0]!,
      now: T0,
    });

    expect(failureOf(result).message).toBe("Invalid code");
    expect((await logAudits(s.kit)).map((r) => r.content.action)).toEqual([
      "security.mfa.login_failed",
    ]);
  });
});

describe("VerifyMfaLogin — concurrency (in-memory repository shares aggregate references)", () => {
  it("two parallel verifies of ONE backup code: exactly one succeeds", async () => {
    const s = await setup();

    const results = await Promise.all([s.run(BACKUP[2]!, T0), s.run(BACKUP[2]!, T0)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(s.enrollment.remainingBackupCodes).toBe(2);
  });

  it("many parallel verifies of one backup code: still exactly one succeeds", async () => {
    const s = await setup();

    const results = await Promise.all(Array.from({ length: 8 }, () => s.run(BACKUP[0]!, T0)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("two parallel verifies of ONE authenticator code (same step): exactly one succeeds", async () => {
    const s = await setup();
    const code = s.codeAt(T0);

    const results = await Promise.all([s.run(code, T0), s.run(code, T0)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe("VerifyMfaLogin — wiring with the in-memory provider", () => {
  it("the fixed reference code works once per step through the aggregate", async () => {
    const kit = buildStaffKit();
    const id = await kit.seedStaff(T, {
      externalId: "p-sam",
      email: "sam@x.com",
      roles: ["admin"],
    });
    const enrollment = MfaEnrollment.enroll(
      kit.id(),
      { principalRef: id, method: "totp", secretRef: "totp:x" },
      kit.deps.idGenerator.generate(),
      kit.clock.now(),
    );
    enrollment.markVerified("e", kit.clock.now());
    await kit.mfaEnrollments.save(enrollment, T);
    const verify = new VerifyMfaLogin(kit.mfaDeps(new InMemoryTotpMfaProvider()));
    const input = { tenantId: T, principalExternalId: "p-sam", code: "123456", now: T0 };

    expect((await verify.execute(input)).ok).toBe(true);
    expect((await verify.execute(input)).ok).toBe(false);
    expect((await verify.execute({ ...input, now: new Date(T0.getTime() + 31_000) })).ok).toBe(
      true,
    );
  });
});

describe("normalizeMfaCode", () => {
  it("trims, drops spaces and dashes, lower-cases", () => {
    expect(normalizeMfaCode("  AB-cd 12 ")).toBe("abcd12");
  });
});
