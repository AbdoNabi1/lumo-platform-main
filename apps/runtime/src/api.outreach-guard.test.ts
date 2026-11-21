import { describe, expect, it } from "vitest";
import { InMemoryOutreachCredentialVault } from "@platform/outreach";
import { startApi } from "./api";
import { buildRuntimeCore, type RuntimeCore } from "./composition";
import { loadRuntimeConfig } from "./config";

const validEnv = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://lumo:***@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:19092",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
  KETO_WRITE_URL: "https://keto.morbeh.local:4467",
  KRATOS_PUBLIC_URL: "https://kratos.morbeh.local:4433",
  KRATOS_ADMIN_URL: "https://kratos.morbeh.local:4434",
} as NodeJS.ProcessEnv;

describe("the outreach vault boot guard is part of startApi's aggregated guards", () => {
  const prodConfig = () =>
    loadRuntimeConfig({
      ...validEnv,
      APP_ENV: "production",
      KETO_READ_URL: "https://keto.morbeh.local",
    });

  it("a stub vault outside local is refused, named in the same error as the other open guards", async () => {
    expect.hasAssertions();
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));
    const stubbed = {
      ...core,
      outreach: { ...core.outreach, vault: new InMemoryOutreachCredentialVault() },
    } as RuntimeCore;
    await expect(startApi(prodConfig(), stubbed)).rejects.toThrow(/7 production guards failed/);
    await expect(startApi(prodConfig(), stubbed)).rejects.toThrow(/outreach credential vault/);
  });

  it("no outreach vault at all adds no failure (Outreach is simply not configured)", async () => {
    expect.hasAssertions();
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));
    expect(core.outreach.vault).toBeUndefined();
    await expect(startApi(prodConfig(), core)).rejects.toThrow(/6 production guards failed/);
    await expect(startApi(prodConfig(), core)).rejects.not.toThrow(/outreach credential vault/);
  });
});
