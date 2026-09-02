import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { MfaMethodKind } from "./domain/value-objects/auth-method";
import type { MfaProviderPort, MfaProviderResolver } from "./application/auth-ports";
import { wireSecurity } from "./composition";

/**
 * C2-4: the reference `InMemoryTotpMfaProvider` verifies against ONE hardcoded code ("123456"),
 * unconditionally, with (before this fix) no way to override it. Proves the new `mfaProviders`
 * seam on `SecurityWiringDeps` actually takes effect: an injected provider is authoritative and
 * the hardcoded reference code stops working once one is supplied.
 */

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-08-05T00:00:00.000Z") };
const body = <T>(r: { body: unknown }): T => r.body as T;

class FakeTotpProvider implements MfaProviderPort {
  readonly method: MfaMethodKind = "totp";
  constructor(
    private readonly validCode: string,
    private readonly provisioningUri?: string,
  ) {}
  async enroll(input: {
    readonly principalRef: string;
  }): Promise<{ readonly secretRef: string; readonly provisioningUri?: string }> {
    return { secretRef: `fake:${input.principalRef}`, provisioningUri: this.provisioningUri };
  }
  async issueChallenge(): Promise<{ readonly challengeRef: string }> {
    return { challengeRef: "chal" };
  }
  async verify(input: { readonly code: string }): Promise<boolean> {
    return input.code === this.validCode;
  }
}

class SingleMethodResolver implements MfaProviderResolver {
  constructor(private readonly provider: MfaProviderPort) {}
  get(method: MfaMethodKind): MfaProviderPort | null {
    return method === this.provider.method ? this.provider : null;
  }
  supportedMethods(): readonly MfaMethodKind[] {
    return [this.provider.method];
  }
}

async function enroll(app: ReturnType<typeof wireSecurity>): Promise<string> {
  await app.security.registerPrincipal({
    externalId: "admin-1",
    kind: "human",
    displayName: "Admin",
    subjectRef: "user-1",
    tenantRef: "t1",
  });
  const enrolled = await app.security.enrollMfa({ principalExternalId: "admin-1", method: "totp" });
  return body<{ id: string }>(enrolled).id;
}

describe("MFA provider injection (C2-4)", () => {
  it("uses the injected provider — the hardcoded reference code no longer verifies once one is supplied", async () => {
    const injected = new FakeTotpProvider("999999");
    const app = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      knownSubjects: ["user-1"],
      mfaProviders: new SingleMethodResolver(injected),
    });
    const enrollmentId = await enroll(app);

    const rejectedHardcoded = await app.security.verifyMfaEnrollment({
      enrollmentId,
      code: "123456",
    });
    expect(rejectedHardcoded.status).not.toBe(200);

    const verified = await app.security.verifyMfaEnrollment({ enrollmentId, code: "999999" });
    expect(verified.status).toBe(200);
    expect(body<{ status: string }>(verified).status).toBe("active");
  });

  it("surfaces the provider's provisioningUri on the enrollment response, once, at enroll time", async () => {
    const injected = new FakeTotpProvider("999999", "otpauth://totp/Lumo:admin-1?secret=ABC");
    const app = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      knownSubjects: ["user-1"],
      mfaProviders: new SingleMethodResolver(injected),
    });
    await app.security.registerPrincipal({
      externalId: "admin-1",
      kind: "human",
      displayName: "Admin",
      subjectRef: "user-1",
      tenantRef: "t1",
    });

    const enrolled = await app.security.enrollMfa({
      principalExternalId: "admin-1",
      method: "totp",
    });

    expect(body<{ provisioningUri?: string }>(enrolled).provisioningUri).toBe(
      "otpauth://totp/Lumo:admin-1?secret=ABC",
    );
  });

  it("falls back to the in-memory reference stub only when nothing is injected — unchanged prior behavior", async () => {
    const app = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      knownSubjects: ["user-1"],
    });
    const enrollmentId = await enroll(app);

    const verified = await app.security.verifyMfaEnrollment({ enrollmentId, code: "123456" });
    expect(verified.status).toBe(200);
    expect(body<{ status: string }>(verified).status).toBe("active");
  });
});
