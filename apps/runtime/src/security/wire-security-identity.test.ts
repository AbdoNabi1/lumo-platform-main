import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../config";
import { buildRuntimeCore } from "../composition";
import { wireSecurityIdentity } from "./wire-security-identity";

const baseEnv = {
  DATABASE_URL: "postgresql://lumo:lumo@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:19092",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
} as NodeJS.ProcessEnv;

const oryEnv = {
  ...baseEnv,
  APP_ENV: "staging",
  KETO_READ_URL: "http://keto:4466",
  KETO_WRITE_URL: "http://keto:4467",
  KRATOS_PUBLIC_URL: "http://kratos:4433",
  KRATOS_ADMIN_URL: "http://kratos:4434",
} as NodeJS.ProcessEnv;

describe("wireSecurityIdentity (H-2 live binding — lazy, no broker/db connection)", () => {
  it("is DISABLED locally when the Ory URLs are unset (permissive escape hatch)", () => {
    const core = buildRuntimeCore(loadRuntimeConfig({ ...baseEnv, APP_ENV: "local" }));
    expect(wireSecurityIdentity(core)).toBeNull();
  });

  it("composes the consent + relation + session + identity-resolution consumer fleet when Ory is configured", () => {
    const core = buildRuntimeCore(loadRuntimeConfig(oryEnv));
    const wired = wireSecurityIdentity(core);
    expect(wired).not.toBeNull();
    expect(wired?.runtimes).toHaveLength(9);
    const topics = wired?.runtimes.map((r) => r.topic) ?? [];
    expect(topics).toEqual(
      expect.arrayContaining([
        "identity.customer.consent_changed.v1",
        "security.relation.written.v1",
        "security.relation.deleted.v1",
        "security.session.revoked_all.v1",
        "identity.user.created.v1",
        "identity.user.deactivated.v1",
        "identity.organization.created.v1",
        "identity.membership.created.v1",
        "identity.membership.role_changed.v1",
      ]),
    );
    expect(wired?.runtimes.every((r) => !r.isRunning)).toBe(true); // built, not started
    expect(wired?.identityProjection).toBeDefined();
  });

  it("REQUIRES the Ory URLs outside local (config fails closed, H-2)", () => {
    expect(() =>
      loadRuntimeConfig({ ...baseEnv, APP_ENV: "production", KETO_READ_URL: "http://keto:4466" }),
    ).toThrow(/KETO_WRITE_URL|KRATOS_PUBLIC_URL|KRATOS_ADMIN_URL/);
  });
});
