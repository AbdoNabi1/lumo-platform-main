import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { NodeCrypto } from "./in-memory-auth-adapters";
import { base32Decode, base32Encode, totp } from "./totp";
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

    const { provisioningUri } = await provider.enroll({
      principalRef: "principal-1",
      accountLabel: "a@b.co",
    });

    expect(provisioningUri).toMatch(/^otpauth:\/\/totp\//);
    expect(provisioningUri).toContain("secret=");
  });

  it("enroll() never returns the same secretRef twice", async () => {
    const provider = new TotpMfaProvider(new NodeCrypto(), clockAt("2026-01-01T00:00:00.000Z"));

    const first = await provider.enroll({ principalRef: "principal-1", accountLabel: "a@b.co" });
    const second = await provider.enroll({ principalRef: "principal-1", accountLabel: "a@b.co" });

    expect(first.secretRef).not.toBe(second.secretRef);
  });

  it("verify() accepts the code computed for the current time step", async () => {
    const clock = clockAt("2026-01-01T00:00:30.000Z");
    const provider = new TotpMfaProvider(new NodeCrypto(), clock);
    const { secretRef, provisioningUri } = await provider.enroll({
      principalRef: "principal-1",
      accountLabel: "a@b.co",
    });
    const expected = totp(
      secretBytesFromProvisioningUri(provisioningUri!),
      secondsOf(clock.now().toISOString()),
    );

    const result = await provider.verify({ secretRef, code: expected });

    expect(result).toBe(true);
  });

  it("verify() rejects a wrong code", async () => {
    const provider = new TotpMfaProvider(new NodeCrypto(), clockAt("2026-01-01T00:00:30.000Z"));
    const { secretRef } = await provider.enroll({
      principalRef: "principal-1",
      accountLabel: "a@b.co",
    });

    const result = await provider.verify({ secretRef, code: "000000" });

    expect(result).toBe(false);
  });

  it("verify() tolerates one time step of clock drift", async () => {
    const provider = new TotpMfaProvider(new NodeCrypto(), clockAt("2026-01-01T00:00:00.000Z"));
    const { secretRef, provisioningUri } = await provider.enroll({
      principalRef: "principal-1",
      accountLabel: "a@b.co",
    });
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
    const { secretRef, provisioningUri } = await provider.enroll({
      principalRef: "principal-1",
      accountLabel: "a@b.co",
    });
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

// ── Wave 1e: verifyStep, account label, manual key ──────────────────────────────────────────────
// RFC 6238 SHA-1 test secret, ASCII "12345678901234567890", derived at runtime (no secret literal).
const RFC_SECRET_B32 = base32Encode(Buffer.from("12345678901234567890", "ascii"));
const FIXED_KEY = "k".repeat(32);

async function providerWithSecret(nowIso: string) {
  const crypto = new NodeCrypto();
  const provider = new TotpMfaProvider(crypto, clockAt(nowIso), { keyRef: FIXED_KEY });
  const secretRef = await crypto.encrypt(RFC_SECRET_B32, FIXED_KEY);
  return { provider, secretRef, secret: base32Decode(RFC_SECRET_B32) };
}
const stepOf = (iso: string): number => Math.floor(new Date(iso).getTime() / 30_000);

describe("TotpMfaProvider.verifyStep", () => {
  it("returns the RFC 6238 time step for the RFC vector at a fixed clock", async () => {
    // RFC 6238 appendix B: T = 59 s -> step 1, TOTP (8 digit) 94287082, so the 6-digit code is 287082.
    const crypto = new NodeCrypto();
    const provider = new TotpMfaProvider(
      crypto,
      { now: () => new Date(59_000) },
      { keyRef: FIXED_KEY },
    );
    const secretRef = await crypto.encrypt(RFC_SECRET_B32, FIXED_KEY);
    expect(await provider.verifyStep({ secretRef, code: "287082" })).toBe(1);
  });

  it("verify() is true exactly when verifyStep matches", async () => {
    const now = "2026-11-27T10:00:10.000Z";
    const { provider, secretRef, secret } = await providerWithSecret(now);
    const code = totp(secret, secondsOf(now));
    expect(await provider.verify({ secretRef, code })).toBe(true);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await provider.verify({ secretRef, code: wrong })).toBe(false);
  });

  it("accepts now-1, now and now+1 and returns each one's own step", async () => {
    const now = "2026-11-27T10:00:10.000Z";
    const { provider, secretRef, secret } = await providerWithSecret(now);
    const current = stepOf(now);
    for (const offset of [-1, 0, 1]) {
      const code = totp(secret, (current + offset) * 30);
      expect(await provider.verifyStep({ secretRef, code })).toBe(current + offset);
    }
  });

  it("rejects now-2 and now+2", async () => {
    const now = "2026-11-27T10:00:10.000Z";
    const { provider, secretRef, secret } = await providerWithSecret(now);
    const current = stepOf(now);
    for (const offset of [-2, 2]) {
      const code = totp(secret, (current + offset) * 30);
      expect(await provider.verifyStep({ secretRef, code })).toBeNull();
    }
  });

  it("honours an explicit `at` over the clock", async () => {
    const { provider, secretRef, secret } = await providerWithSecret("2026-01-01T00:00:00.000Z");
    const at = new Date("2026-11-27T10:00:10.000Z");
    const code = totp(secret, Math.floor(at.getTime() / 1000));
    expect(await provider.verifyStep({ secretRef, code })).toBeNull();
    expect(await provider.verifyStep({ secretRef, code, at })).toBe(stepOf(at.toISOString()));
  });

  it.each([
    "12345",
    "1234567",
    "12345a",
    "abcdef",
    "12 456",
    "",
    "\u0661\u0662\u0663\u0664\u0665\u0666",
  ])("returns null for the malformed code %j", async (code) => {
    const { provider, secretRef } = await providerWithSecret("2026-11-27T10:00:10.000Z");
    expect(await provider.verifyStep({ secretRef, code })).toBeNull();
  });

  it("returns null for a null or undecryptable secretRef instead of throwing", async () => {
    const { provider } = await providerWithSecret("2026-11-27T10:00:10.000Z");
    expect(await provider.verifyStep({ secretRef: null, code: "123456" })).toBeNull();
    expect(await provider.verifyStep({ secretRef: "garbage", code: "123456" })).toBeNull();
  });
});

describe("TotpMfaProvider.enroll account label", () => {
  it("labels the otpauth URI with the encoded email under issuer Morbeh, never an id", async () => {
    const provider = new TotpMfaProvider(new NodeCrypto(), clockAt("2026-01-01T00:00:00.000Z"));
    const principalRef = "0b6f3b0e-5c1c-4e0e-9c55-1c9f1f0e7a11";
    const { provisioningUri } = await provider.enroll({
      principalRef,
      accountLabel: "sam+ops@example.com",
    });
    expect(provisioningUri).toMatch(
      /^otpauth:\/\/totp\/Morbeh:sam%2Bops%40example\.com\?secret=[A-Z2-7]+&issuer=Morbeh&algorithm=SHA1&digits=6&period=30$/,
    );
    expect(provisioningUri).not.toContain(principalRef);
  });

  it("returns the base32 manual key once and it matches the URI secret", async () => {
    const provider = new TotpMfaProvider(new NodeCrypto(), clockAt("2026-01-01T00:00:00.000Z"));
    const { provisioningUri, manualKey, secretRef } = await provider.enroll({
      principalRef: "p",
      accountLabel: "a@b.co",
    });
    expect(manualKey).toMatch(/^[A-Z2-7]{32}$/);
    expect(provisioningUri).toContain(`secret=${manualKey}`);
    expect(secretRef).not.toContain(manualKey);
  });
});
