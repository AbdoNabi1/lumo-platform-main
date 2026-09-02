import { describe, expect, it } from "vitest";
import { BUILTIN_PROVIDERS, SecurityProviderRegistry } from "./provider-registry";

describe("SecurityProviderRegistry", () => {
  it("registers every built-in provider and exposes them by kind", () => {
    const registry = new SecurityProviderRegistry();
    expect(registry.has("kms", "aws")).toBe(true);
    expect(registry.has("threat", "crowdstrike")).toBe(true);
    expect(registry.has("hsm", "yubihsm")).toBe(true);
    expect(
      registry
        .list("kms")
        .map((p) => p.name)
        .sort(),
    ).toEqual(["aws", "azure", "gcp", "local", "vault"]);
    expect(registry.list("threat")).toHaveLength(6);
    expect(registry.list("hsm")).toHaveLength(3);
  });

  it("resolves required config metadata for a provider", () => {
    const registry = new SecurityProviderRegistry();
    expect(registry.require("kms", "vault").requiredConfig).toEqual(["VAULT_ADDR", "VAULT_TOKEN"]);
  });

  it("fails closed on an unknown provider name, listing valid names", () => {
    const registry = new SecurityProviderRegistry();
    expect(() => registry.require("kms", "oracle")).toThrow(
      /unknown kms provider 'oracle' — valid:/,
    );
    expect(registry.get("threat", "nope")).toBeNull();
  });

  it("catalogs the H-3 built-ins exactly once each", () => {
    expect(BUILTIN_PROVIDERS).toHaveLength(14);
    const keys = BUILTIN_PROVIDERS.map((p) => `${p.kind}:${p.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
