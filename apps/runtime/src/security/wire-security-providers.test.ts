import { describe, expect, it } from "vitest";
import type { Logger } from "@platform/utils";
import { loadRuntimeConfig } from "../config";
import { VaultTransitProvider } from "./kms-vault";
import { AwsKmsProvider } from "./kms-aws";
import { Pkcs11HsmProvider, type Pkcs11Session } from "./hsm-providers";
import { wireSecurityProviders } from "./wire-security-providers";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

const BASE = {
  DATABASE_URL: "postgres://x",
  REDIS_URL: "redis://x",
  AUTH_ISSUER_URL: "https://issuer.test",
  AUTH_JWKS_URL: "https://issuer.test/jwks",
};
const ORY = {
  KETO_READ_URL: "https://keto.test/read",
  KETO_WRITE_URL: "https://keto.test/write",
  KRATOS_PUBLIC_URL: "https://kratos.test/public",
  KRATOS_ADMIN_URL: "https://kratos.test/admin",
};
const cfg = (overrides: Record<string, string>) => loadRuntimeConfig({ ...BASE, ...overrides });

const stubSession: Pkcs11Session = {
  generateKeyPair: async () => ({ handle: "h" }),
  getPublicKey: async () => "pub",
  sign: async () => Buffer.from("sig"),
  verify: async () => true,
};

describe("wireSecurityProviders (H-3 config-driven selection)", () => {
  it("selects nothing for the local default (context uses node:crypto + reference feed)", () => {
    const wired = wireSecurityProviders({ config: cfg({}), logger: silent });
    expect(wired.kms).toBeUndefined();
    expect(wired.crypto).toBeUndefined();
    expect(wired.threatIntel).toBeUndefined();
    expect(wired.hsm).toBeUndefined();
    expect(wired.summary).toEqual([]);
  });

  it("builds the Vault provider and shares it as both kms and crypto", () => {
    const wired = wireSecurityProviders({
      config: cfg({
        SECURITY_KMS_PROVIDER: "vault",
        VAULT_ADDR: "https://vault.test:8200",
        VAULT_TOKEN: "s.tok",
      }),
      logger: silent,
    });
    expect(wired.kms).toBeInstanceOf(VaultTransitProvider);
    expect(wired.crypto).toBe(wired.kms);
    expect(wired.summary).toContain("kms=vault");
  });

  it("switches to AWS KMS when configured", () => {
    const wired = wireSecurityProviders({
      config: cfg({
        SECURITY_KMS_PROVIDER: "aws",
        AWS_REGION: "us-east-1",
        AWS_KMS_KEY_ID: "k",
        AWS_ACCESS_KEY_ID: "AKID",
        AWS_SECRET_ACCESS_KEY: "secret",
      }),
      logger: silent,
    });
    expect(wired.kms).toBeInstanceOf(AwsKmsProvider);
  });

  it("builds a resilient threat resolver over the selected feeds", () => {
    const wired = wireSecurityProviders({
      config: cfg({
        SECURITY_THREAT_PROVIDERS: "abuseipdb,virustotal",
        THREAT_ABUSEIPDB_API_KEY: "a",
        THREAT_VIRUSTOTAL_API_KEY: "b",
      }),
      logger: silent,
    });
    expect(wired.threatIntel?.providerNames()).toEqual(["abuseipdb", "virustotal"]);
    expect(wired.summary).toContain("threat=[abuseipdb,virustotal]");
  });

  it("binds an HSM provider when a PKCS#11 session is injected", () => {
    const wired = wireSecurityProviders({
      config: cfg({ SECURITY_HSM_PROVIDER: "pkcs11", HSM_PKCS11_MODULE: "/opt/pkcs11.so" }),
      logger: silent,
      pkcs11Session: stubSession,
    });
    expect(wired.hsm).toBeInstanceOf(Pkcs11HsmProvider);
    expect(wired.summary).toContain("hsm=pkcs11");
  });

  it("skips the HSM in local dev when no session is injected", () => {
    const wired = wireSecurityProviders({
      config: cfg({ SECURITY_HSM_PROVIDER: "pkcs11", HSM_PKCS11_MODULE: "/opt/pkcs11.so" }),
      logger: silent,
    });
    expect(wired.hsm).toBeUndefined();
  });

  it("fails closed when an HSM is selected outside local without a session", () => {
    const config = cfg({
      APP_ENV: "production",
      ...ORY,
      SECURITY_HSM_PROVIDER: "pkcs11",
      HSM_PKCS11_MODULE: "/opt/pkcs11.so",
    });
    expect(() => wireSecurityProviders({ config, logger: silent })).toThrow(
      /requires an injected PKCS#11 session/,
    );
  });
});
