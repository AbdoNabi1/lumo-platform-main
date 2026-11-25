import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryTotpMfaProvider } from "../infrastructure/in-memory-auth-adapters";
import { InMemoryMfaEnrollmentRepository } from "../infrastructure/in-memory-repositories";
import { buildStaffKit } from "../infrastructure/staff-test-kit";
import { Principal } from "../domain/principal";
import type { MfaMethodKind } from "../domain/value-objects/auth-method";
import type { MfaProviderPort, MfaProviderResolver } from "./auth-ports";
import type { SecurityDeps } from "./deps";
import { EnrollMfa } from "./mfa.use-cases";

const T = "shop-a";

function capturingProvider() {
  const calls: { principalRef: string; accountLabel: string }[] = [];
  const inner = new InMemoryTotpMfaProvider();
  const provider: MfaProviderPort = {
    method: "totp",
    enroll: async (input) => {
      calls.push({ ...input });
      return inner.enroll(input);
    },
    issueChallenge: () => inner.issueChallenge(),
    verify: (input) => inner.verify(input),
    verifyStep: (input) => inner.verifyStep(input),
  };
  const resolver: MfaProviderResolver = {
    get: (method: MfaMethodKind) => (method === "totp" ? provider : null),
    supportedMethods: () => ["totp"],
  };
  return { calls, resolver };
}

function enrollDeps(kit: ReturnType<typeof buildStaffKit>, resolver: MfaProviderResolver) {
  const mfaEnrollments = new InMemoryMfaEnrollmentRepository({
    outbox: { write: async () => undefined },
    context: {},
  } as never);
  const deps = {
    ...kit.deps,
    mfaProviders: resolver,
    mfaMethodRegistry: { get: () => null },
    mfaEnrollments,
  } as unknown as SecurityDeps;
  return deps;
}

describe("EnrollMfa passes an accountLabel to the provider", () => {
  it("uses the staff email when the principal has a staff credential", async () => {
    const kit = buildStaffKit();
    await kit.seedStaff(T, { externalId: "p-1", email: "sam@example.com", roles: ["admin"] });
    const { calls, resolver } = capturingProvider();

    const result = await new EnrollMfa(enrollDeps(kit, resolver)).execute({
      tenantId: T,
      principalExternalId: "p-1",
      method: "totp",
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.accountLabel).toBe("sam@example.com");
    // the label is never the internal id
    expect(calls[0]!.accountLabel).not.toBe(calls[0]!.principalRef);
  });

  it("falls back to the display name when there is no staff credential", async () => {
    const kit = buildStaffKit();
    const principal = Principal.register(
      UniqueEntityId.from("00000000-0000-4000-8000-0000000000aa"),
      {
        externalId: "svc-1",
        kind: "human",
        displayName: "Front Desk",
        subjectRef: "svc-1",
        tenantRef: T,
      },
      "evt-1",
      kit.clock.now(),
    );
    await kit.principals.save(principal, T);
    const { calls, resolver } = capturingProvider();

    const result = await new EnrollMfa(enrollDeps(kit, resolver)).execute({
      tenantId: T,
      principalExternalId: "svc-1",
      method: "totp",
    });

    expect(result.ok).toBe(true);
    expect(calls[0]!.accountLabel).toBe("Front Desk");
  });
});

describe("InMemoryTotpMfaProvider.verifyStep", () => {
  it("maps the fixed code to the current step and rejects anything else", async () => {
    const provider = new InMemoryTotpMfaProvider();
    const at = new Date("2026-11-27T10:00:10.000Z");
    expect(await provider.verifyStep({ secretRef: "s", code: "123456", at })).toBe(
      Math.floor(at.getTime() / 30_000),
    );
    expect(await provider.verifyStep({ secretRef: "s", code: "000000", at })).toBeNull();
  });
});
