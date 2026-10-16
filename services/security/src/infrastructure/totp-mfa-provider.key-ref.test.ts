import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { NodeCrypto } from "./in-memory-auth-adapters";
import { TotpMfaProvider } from "./totp-mfa-provider";

const clock: Clock = { now: () => new Date("2026-10-07T00:00:00.000Z") };
const KEY_A = "a".repeat(32);
const KEY_B = "b".repeat(32);

describe("TotpMfaProvider keyRef (G-87)", () => {
  it("encrypts the secret under the configured key, not the source-code constant", async () => {
    const crypto = new NodeCrypto();
    const provider = new TotpMfaProvider(crypto, clock, { keyRef: KEY_A });
    const { secretRef } = await provider.enroll({ principalRef: "p-1" });
    await expect(crypto.decrypt(secretRef, KEY_A)).resolves.toMatch(/^[A-Z2-7]+$/);
    await expect(crypto.decrypt(secretRef, KEY_B)).rejects.toThrow();
    await expect(crypto.decrypt(secretRef, "security.mfa.totp")).rejects.toThrow();
  });

  it("refuses a short key", () => {
    expect(() => new TotpMfaProvider(new NodeCrypto(), clock, { keyRef: "short" })).toThrow(/32/);
  });
});
