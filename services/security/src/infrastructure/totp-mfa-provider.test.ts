import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { NodeCrypto } from "./in-memory-auth-adapters";
import { base32Decode, totp } from "./totp";
import { TotpMfaProvider } from "./totp-mfa-provider";

function clockAt(iso: string): Clock {
  return { now: () => new Date(iso) };
}

function secretBytesFromProvisioningUri(uri: string): Buffer {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (match === null) throw new Error("no secret in provisioning URI");
  return base32Decode(match[1]!);
}

function secondsOf(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

describe("TotpMfaProvider", () => {
  it("enroll() returns a provisioningUri carrying a usable secret", async () => {
    const provider = new TotpMfaProvider(new NodeCrypto(), clockAt("2026-01-01T00:00:00.000Z"));

    const { provisioningUri } = await provider.enroll({ principalRef: "principal-1" });

    expect(provisioningUri).toMatch(/^otpauth:\/\/totp\//);
    expect(provisioningUri).toContain("secret=");
  });

  it("enroll() never returns the same secretRef twice", async () => {
    const provider = new TotpMfaProvider(new NodeCrypto(), clockAt("2026-01-01T00:00:00.000Z"));

    const first = await provider.enroll({ principalRef: "principal-1" });
    const second = await provider.enroll({ principalRef: "principal-1" });

    expect(first.secretRef).not.toBe(second.secretRef);
  });

  it("verify() accepts the code computed for the current time step", async () => {
    const clock = clockAt("2026-01-01T00:00:30.000Z");
    const provider = new TotpMfaProvider(new NodeCrypto(), clock);
    const { secretRef, provisioningUri } = await provider.enroll({ principalRef: "principal-1" });
    const expected = totp(secretBytesFromProvisioningUri(provisioningUri!), secondsOf(clock.now().toISOString()));

    const result = await provider.verify({ secretRef, code: expected });

    expect(result).toBe(true);
  });

  it("verify() rejects a wrong code", async () => {
    const provider = new TotpMfaProvider(new NodeCrypto(), clockAt("2026-01-01T00:00:30.000Z"));
    const { secretRef } = await provider.enroll({ principalRef: "principal-1" });

    const result = await provider.verify({ secretRef, code: "000000" });

    expect(result).toBe(false);
  });

  it("verify() tolerates one time step of clock drift", async () => {
    const provider = new TotpMfaProvider(new NodeCrypto(), clockAt("2026-01-01T00:00:00.000Z"));
    const { secretRef, provisioningUri } = await provider.enroll({ principalRef: "principal-1" });
    const secretBytes = secretBytesFromProvisioningUri(provisioningUri!);
    const codeOneStepLater = totp(secretBytes, secondsOf("2026-01-01T00:00:30.000Z"));
    const verifyingProvider = new TotpMfaProvider(
      new NodeCrypto(),
      clockAt("2026-01-01T00:00:30.000Z"),
    );

    const result = await verifyingProvider.verify({ secretRef, code: codeOneStepLater });

    expect(result).toBe(true);
  });

  it("verify() rejects a code two time steps stale", async () => {
    const provider = new TotpMfaProvider(new NodeCrypto(), clockAt("2026-01-01T00:00:00.000Z"));
    const { secretRef, provisioningUri } = await provider.enroll({ principalRef: "principal-1" });
    const secretBytes = secretBytesFromProvisioningUri(provisioningUri!);
    const staleCode = totp(secretBytes, secondsOf("2026-01-01T00:00:00.000Z"));
    const verifyingProvider = new TotpMfaProvider(
      new NodeCrypto(),
      clockAt("2026-01-01T00:01:30.000Z"), // 3 periods later
    );

    const result = await verifyingProvider.verify({ secretRef, code: staleCode });

    expect(result).toBe(false);
  });

  it("verify() rejects when secretRef is null", async () => {
    const provider = new TotpMfaProvider(new NodeCrypto(), clockAt("2026-01-01T00:00:00.000Z"));

    const result = await provider.verify({ secretRef: null, code: "287082" });

    expect(result).toBe(false);
  });

  it("verify() rejects a malformed secretRef instead of throwing", async () => {
    const provider = new TotpMfaProvider(new NodeCrypto(), clockAt("2026-01-01T00:00:00.000Z"));

    const result = await provider.verify({ secretRef: "not-real-ciphertext", code: "287082" });

    expect(result).toBe(false);
  });

  it("issueChallenge() returns a distinct correlation ref each call", async () => {
    const provider = new TotpMfaProvider(new NodeCrypto(), clockAt("2026-01-01T00:00:00.000Z"));

    const first = await provider.issueChallenge({ secretRef: null });
    const second = await provider.issueChallenge({ secretRef: null });

    expect(first.challengeRef).not.toBe(second.challengeRef);
  });
});
