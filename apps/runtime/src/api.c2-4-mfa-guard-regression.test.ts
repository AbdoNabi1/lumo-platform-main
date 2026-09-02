import { describe, expect, it } from "vitest";
import {
  InMemoryTotpMfaProvider,
  MapMfaProviderResolver,
  NodeCrypto,
  TotpMfaProvider,
} from "@platform/security";
import { assertProductionMfaConfigured } from "./api";

const stubResolver = new MapMfaProviderResolver([new InMemoryTotpMfaProvider()]);
const realResolver = new MapMfaProviderResolver([
  new TotpMfaProvider(new NodeCrypto(), { now: () => new Date() }),
]);

describe("assertProductionMfaConfigured (C2-4)", () => {
  it("never throws in local, even with the in-memory stub still resolved", () => {
    expect(() => assertProductionMfaConfigured("local", stubResolver)).not.toThrow();
  });

  it("throws outside local while the resolved totp provider is still the in-memory stub", () => {
    expect(() => assertProductionMfaConfigured("production", stubResolver)).toThrow(
      /MfaProviderResolver/,
    );
  });

  it("passes outside local once a real (non-stub) totp provider is resolved", () => {
    expect(() => assertProductionMfaConfigured("production", realResolver)).not.toThrow();
  });
});
