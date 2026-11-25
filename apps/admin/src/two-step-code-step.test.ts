import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { NativeTokenIssuer } from "@platform/auth";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireAdmin } from "./composition";
import { AllowAllAccessControl } from "./infrastructure/allow-all-access-control";

/**
 * Wave 1e: "the sign-in code step is available" is `staffTokenIssuer present && mfaConfigured`, where
 * `mfaConfigured` is decided by `apps/runtime` (the real TOTP provider AND its key). Read through the
 * policy, which reports the flag and refuses to be turned on without it.
 */

const TENANT = "tenant-local";
const clock: Clock = { now: () => new Date("2026-11-25T10:00:00.000Z") };
// A service principal is outside the live staff check and AllowAll decides, so no staff has to be
// seeded: what is under test is the capability flag, not who may read it (that is two-step-routes).
const reader: Principal = { id: "svc-1", kind: "service", roles: ["admin"], tenantId: TENANT };

function wire(options: { issuer: boolean; mfaConfigured?: boolean }) {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  return wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    accessControl: new AllowAllAccessControl(),
    ...(options.issuer
      ? {
          staffTokenIssuer: new NativeTokenIssuer({
            privateKey: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey,
            issuer: "https://api.test/",
            audience: "morbeh-admin",
            ttlSeconds: 7200,
          }),
        }
      : {}),
    ...(options.mfaConfigured === undefined ? {} : { mfaConfigured: options.mfaConfigured }),
  });
}

beforeEach(() => {
  expect.hasAssertions();
});

describe("codeStepAvailable wiring", () => {
  it.each([
    ["issuer and mfaConfigured", { issuer: true, mfaConfigured: true }, true],
    ["issuer, mfaConfigured false", { issuer: true, mfaConfigured: false }, false],
    ["issuer, mfaConfigured absent (defaults to false)", { issuer: true }, false],
    ["no issuer, mfaConfigured true", { issuer: false, mfaConfigured: true }, false],
    ["neither", { issuer: false }, false],
  ] as const)("%s ⇒ %s", async (_name, options, expected) => {
    const admin = wire(options);
    const res = await admin.staff.securityPolicy(reader, TENANT);
    expect(res.status).toBe(200);
    expect((res.body as { codeStepAvailable: boolean }).codeStepAvailable).toBe(expected);
  });

  it("starting a setup follows the same flag: 503 NOT_CONFIGURED unless mfaConfigured", async () => {
    const off = wire({ issuer: true, mfaConfigured: false });
    const refused = await off.securityWiring.security.startOwnTwoStep({
      tenantId: TENANT,
      principalExternalId: "nobody",
      email: "nobody@example.test",
    });
    expect(refused.status).toBe(503);
    const on = wire({ issuer: true, mfaConfigured: true });
    const missing = await on.securityWiring.security.startOwnTwoStep({
      tenantId: TENANT,
      principalExternalId: "nobody",
      email: "nobody@example.test",
    });
    // Configured: it gets as far as looking the member up.
    expect(missing.status).toBe(404);
  });
});
