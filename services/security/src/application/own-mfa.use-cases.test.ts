import type { Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import { TenantSecurityProfile } from "../domain/tenant-security-profile";
import { InMemoryTotpMfaProvider, NodeCrypto } from "../infrastructure/in-memory-auth-adapters";
import { buildStaffKit, type StaffKit } from "../infrastructure/staff-test-kit";
import { base32Decode, totp } from "../infrastructure/totp";
import { TotpMfaProvider } from "../infrastructure/totp-mfa-provider";
import { VerifyMfaLogin } from "./mfa-login.use-cases";
import {
  ConfirmOwnTwoStep,
  DisableOwnTwoStep,
  GetOwnTwoStep,
  RegenerateOwnBackupCodes,
  StartOwnTwoStep,
} from "./own-mfa.use-cases";

const T = "shop-a";
const KEY = "k".repeat(32);
const T0 = new Date("2026-11-27T10:00:10.000Z");
const later = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);
const CODE = "123456";

const failureOf = <V>(r: Result<V, DomainError>): DomainError => {
  if (r.ok) throw new Error(`expected failure, got ${JSON.stringify(r.value)}`);
  return r.error;
};
const valueOf = <V>(r: Result<V, DomainError>): V => {
  if (!r.ok) throw new Error(`expected success, got ${r.error.message}`);
  return r.value;
};

/** Two staff members, in-memory reference provider (fixed code "123456") unless a provider is given. */
async function setup(
  provider: InMemoryTotpMfaProvider | TotpMfaProvider = new InMemoryTotpMfaProvider(),
) {
  const kit = buildStaffKit({ start: T0 });
  const sam = await kit.seedStaff(T, { externalId: "p-sam", email: "sam@x.com", roles: ["admin"] });
  const mona = await kit.seedStaff(T, {
    externalId: "p-mona",
    email: "mona@x.com",
    roles: ["viewer"],
  });
  const deps = kit.mfaDeps(provider);
  return {
    kit,
    sam,
    mona,
    deps,
    get: new GetOwnTwoStep(deps),
    start: new StartOwnTwoStep(deps, { mfaConfigured: true }),
    startUnconfigured: new StartOwnTwoStep(deps, { mfaConfigured: false }),
    confirm: new ConfirmOwnTwoStep(deps),
    regenerate: new RegenerateOwnBackupCodes(deps),
    disable: new DisableOwnTwoStep(deps),
    verify: new VerifyMfaLogin(deps),
  };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const startFor = (c: Ctx, externalId = "p-sam", email = "sam@x.com") =>
  c.start.execute({ tenantId: T, principalExternalId: externalId, email });

/** Start + Confirm for a member (fixed code, at `now`). Returns the backup codes. */
async function turnOn(c: Ctx, externalId = "p-sam", email = "sam@x.com", now = T0) {
  const started = valueOf(await startFor(c, externalId, email));
  const confirmed = valueOf(
    await c.confirm.execute({
      tenantId: T,
      principalExternalId: externalId,
      enrollmentId: started.enrollmentId,
      code: CODE,
      now,
    }),
  );
  return { enrollmentId: started.enrollmentId, backupCodes: confirmed.backupCodes };
}

const totpEnrollments = async (kit: StaffKit, internalId: string) =>
  kit.mfaEnrollments.listByPrincipal(internalId, T);
const mfaAudits = async (kit: StaffKit) =>
  (await kit.deps.auditLedger.list(T, T)).filter((r) =>
    r.content.action.startsWith("security.mfa."),
  );
const stateOf = async (kit: StaffKit, internalId: string) =>
  JSON.stringify(
    (await totpEnrollments(kit, internalId)).map((e) => [
      e.id.toString(),
      e.status,
      e.lastUsedStep,
      e.backupCodeHashes,
    ]),
  );

async function setPolicy(kit: StaffKit, mfaRequired: boolean): Promise<void> {
  await kit.tenantProfiles.save(
    TenantSecurityProfile.configure(
      kit.id(),
      T,
      { mfaRequired },
      kit.deps.idGenerator.generate(),
      kit.clock.now(),
    ),
    T,
  );
}

describe("GetOwnTwoStep", () => {
  it("off: not enabled, no codes, policy flag from the tenant profile", async () => {
    const c = await setup();

    expect(valueOf(await c.get.execute({ tenantId: T, principalExternalId: "p-sam" }))).toEqual({
      enabled: false,
      activatedAt: null,
      backupCodesLeft: 0,
      policyRequired: false,
    });
  });

  it("on: enabled, activation time, 10 codes left; policyRequired follows the profile", async () => {
    const c = await setup();
    await turnOn(c);
    await setPolicy(c.kit, true);

    expect(valueOf(await c.get.execute({ tenantId: T, principalExternalId: "p-sam" }))).toEqual({
      enabled: true,
      activatedAt: T0.toISOString(),
      backupCodesLeft: 10,
      policyRequired: true,
    });
  });

  it("a pending enrolment is not 'on'", async () => {
    const c = await setup();
    valueOf(await startFor(c));

    expect(
      valueOf(await c.get.execute({ tenantId: T, principalExternalId: "p-sam" })).enabled,
    ).toBe(false);
  });

  it("an unknown principal is NOT_FOUND", async () => {
    const c = await setup();

    expect(
      failureOf(await c.get.execute({ tenantId: T, principalExternalId: "nobody" })).code,
    ).toBe("NOT_FOUND");
  });
});

describe("StartOwnTwoStep", () => {
  it("returns an enrolment id, the manual key and a provisioning link labelled with the email", async () => {
    const c = await setup();

    const out = valueOf(await startFor(c));

    expect(out.enrollmentId).toMatch(/\S/);
    expect(out.manualKey.length).toBeGreaterThan(0);
    expect(out.provisioningUri).toContain("otpauth://totp/Morbeh:sam%40x.com");
    expect(out.provisioningUri).not.toContain(c.sam);
    const rows = await totpEnrollments(c.kit, c.sam);
    expect(rows.map((e) => e.status)).toEqual(["pending"]);
  });

  it("with the real provider: a base32 manual key that equals the link's secret", async () => {
    const c = await setup(
      new TotpMfaProvider(new NodeCrypto(), { now: () => T0 }, { keyRef: KEY }),
    );

    const out = valueOf(await startFor(c));

    expect(out.manualKey).toMatch(/^[A-Z2-7]{32}$/);
    expect(out.provisioningUri).toContain(`secret=${out.manualKey}`);
  });

  it("a second Start revokes the first pending enrolment and creates a new one", async () => {
    const c = await setup();
    const first = valueOf(await startFor(c));
    const second = valueOf(await startFor(c));

    expect(second.enrollmentId).not.toBe(first.enrollmentId);
    const rows = await totpEnrollments(c.kit, c.sam);
    const byId = new Map(rows.map((e) => [e.id.toString(), e.status]));
    expect(byId.get(first.enrollmentId)).toBe("revoked");
    expect(byId.get(second.enrollmentId)).toBe("pending");
    expect(rows.filter((e) => e.status === "pending")).toHaveLength(1);
  });

  it("refuses when two-step is already on, writing nothing", async () => {
    const c = await setup();
    await turnOn(c);
    const before = await stateOf(c.kit, c.sam);

    const error = failureOf(await startFor(c));

    expect(error.code).toBe("BUSINESS_RULE");
    expect(error.message).toBe("Two-step verification is already on");
    expect(await stateOf(c.kit, c.sam)).toBe(before);
  });

  it("not configured on this server: NOT_CONFIGURED and nothing written", async () => {
    const c = await setup();

    const error = failureOf(
      await c.startUnconfigured.execute({
        tenantId: T,
        principalExternalId: "p-sam",
        email: "sam@x.com",
      }),
    );

    expect(error.code).toBe("NOT_CONFIGURED");
    expect(error.message).toBe("Two-step verification isn't set up on this server");
    expect(await totpEnrollments(c.kit, c.sam)).toHaveLength(0);
  });

  it("a suspended or unknown principal is NOT_FOUND", async () => {
    const c = await setup();
    await c.kit.seedStaff(T, {
      externalId: "p-off",
      email: "off@x.com",
      roles: ["viewer"],
      status: "suspended",
    });

    expect(failureOf(await startFor(c, "p-off", "off@x.com")).code).toBe("NOT_FOUND");
    expect(failureOf(await startFor(c, "nobody", "n@x.com")).code).toBe("NOT_FOUND");
  });

  it("the secret is never audited", async () => {
    const c = await setup();
    const out = valueOf(await startFor(c));

    const dump = JSON.stringify((await c.kit.deps.auditLedger.list(T, T)).map((r) => r.content));

    expect(dump).not.toContain(out.manualKey);
    expect(dump).not.toContain("otpauth");
  });
});

describe("ConfirmOwnTwoStep", () => {
  it("a right code turns it on and returns 10 backup codes (xxxx-xxxx-xxxx), stored only as hashes", async () => {
    const c = await setup();
    const started = valueOf(await startFor(c));

    const out = valueOf(
      await c.confirm.execute({
        tenantId: T,
        principalExternalId: "p-sam",
        enrollmentId: started.enrollmentId,
        code: CODE,
        now: T0,
      }),
    );

    expect(out.backupCodes).toHaveLength(10);
    for (const code of out.backupCodes)
      expect(code).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(new Set(out.backupCodes).size).toBe(10);
    const [enrollment] = await totpEnrollments(c.kit, c.sam);
    expect(enrollment!.status).toBe("active");
    expect(enrollment!.activatedAt).toEqual(T0);
    expect(enrollment!.remainingBackupCodes).toBe(10);
    const plain = out.backupCodes.map((x) => x.replaceAll("-", ""));
    for (const p of plain) expect(enrollment!.backupCodeHashes).not.toContain(p);
    expect(enrollment!.backupCodeHashes).toContain(await new NodeCrypto().hash(plain[0]!));
  });

  it("audits security.mfa.enabled with only actor, target, method — no secret, no code", async () => {
    const c = await setup();
    const started = valueOf(await startFor(c));
    const { backupCodes } = await turnOn(c, "p-mona", "mona@x.com");

    const rows = (await mfaAudits(c.kit)).filter(
      (r) => r.content.action === "security.mfa.enabled",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.content.principalRef).toBe("p-mona");
    expect(rows[0]!.content.decision).toBe("allow");
    expect(rows[0]!.content.metadata).toEqual({
      actor: "p-mona",
      target: "p-mona",
      method: "totp",
    });
    const dump = JSON.stringify((await c.kit.deps.auditLedger.list(T, T)).map((r) => r.content));
    expect(dump).not.toContain(started.manualKey);
    for (const code of backupCodes) expect(dump).not.toContain(code);
  });

  it("a wrong code is a 409 with the exact message and changes nothing (still pending, no audit)", async () => {
    const c = await setup();
    const started = valueOf(await startFor(c));
    const before = await stateOf(c.kit, c.sam);

    const error = failureOf(
      await c.confirm.execute({
        tenantId: T,
        principalExternalId: "p-sam",
        enrollmentId: started.enrollmentId,
        code: "000000",
        now: T0,
      }),
    );

    expect(error.code).toBe("BUSINESS_RULE");
    expect(error.message).toBe("That code didn't work. Try again.");
    expect(await stateOf(c.kit, c.sam)).toBe(before);
    expect(await mfaAudits(c.kit)).toHaveLength(0);
  });

  it("another principal's enrolment id is NOT_FOUND and stays pending", async () => {
    const c = await setup();
    const monas = valueOf(await startFor(c, "p-mona", "mona@x.com"));

    const error = failureOf(
      await c.confirm.execute({
        tenantId: T,
        principalExternalId: "p-sam",
        enrollmentId: monas.enrollmentId,
        code: CODE,
        now: T0,
      }),
    );

    expect(error.code).toBe("NOT_FOUND");
    expect((await totpEnrollments(c.kit, c.mona))[0]!.status).toBe("pending");
  });

  it("an unknown, a revoked or an already-active enrolment id is NOT_FOUND", async () => {
    const c = await setup();
    const first = valueOf(await startFor(c));
    const second = valueOf(await startFor(c)); // first is now revoked
    const input = { tenantId: T, principalExternalId: "p-sam", code: CODE, now: T0 };

    expect(failureOf(await c.confirm.execute({ ...input, enrollmentId: "nope" })).code).toBe(
      "NOT_FOUND",
    );
    expect(
      failureOf(await c.confirm.execute({ ...input, enrollmentId: first.enrollmentId })).code,
    ).toBe("NOT_FOUND");
    valueOf(await c.confirm.execute({ ...input, enrollmentId: second.enrollmentId }));
    expect(
      failureOf(await c.confirm.execute({ ...input, enrollmentId: second.enrollmentId })).code,
    ).toBe("NOT_FOUND");
  });

  it("with the real provider: a computed code confirms; the same step cannot confirm twice", async () => {
    const provider = new TotpMfaProvider(new NodeCrypto(), { now: () => T0 }, { keyRef: KEY });
    const c = await setup(provider);
    const started = valueOf(await startFor(c));
    const code = totp(base32Decode(started.manualKey), Math.floor(T0.getTime() / 1000));

    const out = valueOf(
      await c.confirm.execute({
        tenantId: T,
        principalExternalId: "p-sam",
        enrollmentId: started.enrollmentId,
        code,
        now: T0,
      }),
    );

    expect(out.backupCodes).toHaveLength(10);
    // The step that confirmed is spent: signing in with the same code now fails.
    expect(
      (await c.verify.execute({ tenantId: T, principalExternalId: "p-sam", code, now: T0 })).ok,
    ).toBe(false);
  });
});

describe("RegenerateOwnBackupCodes", () => {
  it("with a valid (later-step) code: 10 new codes; old backup codes stop working at login", async () => {
    const c = await setup();
    const { backupCodes: old } = await turnOn(c);
    const now = later(60);

    const out = valueOf(
      await c.regenerate.execute({ tenantId: T, principalExternalId: "p-sam", code: CODE, now }),
    );

    expect(out.backupCodes).toHaveLength(10);
    expect(out.backupCodes.some((x) => old.includes(x))).toBe(false);
    const login = (code: string) =>
      c.verify.execute({ tenantId: T, principalExternalId: "p-sam", code, now });
    expect((await login(old[0]!)).ok).toBe(false);
    expect(valueOf(await login(out.backupCodes[0]!)).method).toBe("backup");
    const rows = (await mfaAudits(c.kit)).filter(
      (r) => r.content.action === "security.mfa.backup_codes_regenerated",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content.metadata).toEqual({ actor: "p-sam", target: "p-sam", count: "10" });
  });

  it("the replay guard applies: the code that just confirmed cannot regenerate in the same step", async () => {
    const c = await setup();
    await turnOn(c);
    const before = await stateOf(c.kit, c.sam);

    const error = failureOf(
      await c.regenerate.execute({
        tenantId: T,
        principalExternalId: "p-sam",
        code: CODE,
        now: T0,
      }),
    );

    expect(error.message).toBe("That code didn't work. Try again.");
    expect(await stateOf(c.kit, c.sam)).toBe(before);
  });

  it("a wrong code is refused and the old codes keep working", async () => {
    const c = await setup();
    const { backupCodes } = await turnOn(c);

    const error = failureOf(
      await c.regenerate.execute({
        tenantId: T,
        principalExternalId: "p-sam",
        code: "000000",
        now: later(60),
      }),
    );

    expect(error.code).toBe("BUSINESS_RULE");
    expect(
      (
        await c.verify.execute({
          tenantId: T,
          principalExternalId: "p-sam",
          code: backupCodes[0]!,
          now: later(60),
        })
      ).ok,
    ).toBe(true);
  });

  it("a backup code is not accepted as the proof (authenticator code only)", async () => {
    const c = await setup();
    const { backupCodes } = await turnOn(c);

    const error = failureOf(
      await c.regenerate.execute({
        tenantId: T,
        principalExternalId: "p-sam",
        code: backupCodes[0]!,
        now: later(60),
      }),
    );

    expect(error.message).toBe("That code didn't work. Try again.");
  });

  it("refused when two-step is not on", async () => {
    const c = await setup();

    const error = failureOf(
      await c.regenerate.execute({
        tenantId: T,
        principalExternalId: "p-sam",
        code: CODE,
        now: T0,
      }),
    );

    expect(error.code).toBe("BUSINESS_RULE");
    expect(error.message).toBe("Two-step verification isn't on");
  });
});

describe("DisableOwnTwoStep", () => {
  it("revokes the active enrolment, audits security.mfa.disabled, and sign-in codes stop working", async () => {
    const c = await setup();
    const { backupCodes } = await turnOn(c);

    valueOf(await c.disable.execute({ tenantId: T, principalExternalId: "p-sam", now: later(60) }));

    const [enrollment] = await totpEnrollments(c.kit, c.sam);
    expect(enrollment!.status).toBe("revoked");
    expect(
      valueOf(await c.get.execute({ tenantId: T, principalExternalId: "p-sam" })).enabled,
    ).toBe(false);
    expect(
      (
        await c.verify.execute({
          tenantId: T,
          principalExternalId: "p-sam",
          code: backupCodes[0]!,
          now: later(60),
        })
      ).ok,
    ).toBe(false);
    const rows = (await mfaAudits(c.kit)).filter(
      (r) => r.content.action === "security.mfa.disabled",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content.metadata).toEqual({ actor: "p-sam", target: "p-sam", method: "totp" });
  });

  it("takes NO password input: the input is { tenantId, principalExternalId, now }", async () => {
    const c = await setup();
    await turnOn(c);
    const input = { tenantId: T, principalExternalId: "p-sam", now: later(60) };

    expect(Object.keys(input).sort()).toEqual(["now", "principalExternalId", "tenantId"]);
    expect((await c.disable.execute(input)).ok).toBe(true);
  });

  it("refused with the exact message while the store requires two-step; still on, nothing audited", async () => {
    const c = await setup();
    await turnOn(c);
    await setPolicy(c.kit, true);
    const before = await stateOf(c.kit, c.sam);
    const auditsBefore = (await mfaAudits(c.kit)).length;

    const error = failureOf(
      await c.disable.execute({ tenantId: T, principalExternalId: "p-sam", now: later(60) }),
    );

    expect(error.code).toBe("BUSINESS_RULE");
    expect(error.message).toBe(
      "Your store requires two-step verification, so it can't be turned off",
    );
    expect(await stateOf(c.kit, c.sam)).toBe(before);
    expect((await mfaAudits(c.kit)).length).toBe(auditsBefore);
  });

  it("refused when two-step is not on", async () => {
    const c = await setup();

    const error = failureOf(
      await c.disable.execute({ tenantId: T, principalExternalId: "p-sam", now: T0 }),
    );

    expect(error.message).toBe("Two-step verification isn't on");
  });

  it("can be turned on again afterwards", async () => {
    const c = await setup();
    await turnOn(c);
    valueOf(await c.disable.execute({ tenantId: T, principalExternalId: "p-sam", now: later(60) }));

    const again = await turnOn(c, "p-sam", "sam@x.com", later(120));

    expect(again.backupCodes).toHaveLength(10);
    expect(
      valueOf(await c.get.execute({ tenantId: T, principalExternalId: "p-sam" })).enabled,
    ).toBe(true);
  });
});

describe("own two-step writes run under the tenant staff lock", () => {
  it("a parallel Start + Start leaves exactly one pending enrolment", async () => {
    const c = await setup();

    const results = await Promise.all([startFor(c), startFor(c)]);

    expect(results.every((r) => r.ok)).toBe(true);
    const rows = await totpEnrollments(c.kit, c.sam);
    expect(rows.filter((e) => e.status === "pending")).toHaveLength(1);
    expect(rows.filter((e) => e.status === "revoked")).toHaveLength(1);
  });

  it("two parallel Confirms of the same enrolment: exactly one succeeds", async () => {
    const c = await setup();
    const started = valueOf(await startFor(c));
    const confirm = () =>
      c.confirm.execute({
        tenantId: T,
        principalExternalId: "p-sam",
        enrollmentId: started.enrollmentId,
        code: CODE,
        now: T0,
      });

    const results = await Promise.all([confirm(), confirm()]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await mfaAudits(c.kit)).toHaveLength(1);
  });
});
