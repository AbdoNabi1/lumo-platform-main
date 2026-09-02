import { randomBytes } from "node:crypto";
import type { Clock } from "@platform/contracts";
import type { CryptoPort, MfaProviderPort } from "../application/auth-ports";
import type { MfaMethodKind } from "../domain/value-objects/auth-method";
import { base32Decode, base32Encode, totp } from "./totp";

const KEY_REF = "security.mfa.totp";
const ISSUER = "Lumo";
const STEP_TOLERANCE = 1; // ± one 30s period, absorbing clock drift between client and server.

/**
 * Production {@link MfaProviderPort} for `totp` (C2-4): real RFC 6238 codes, not a hardcoded
 * reference value. The raw secret is never persisted — `enroll()` returns it encrypted (via the
 * injected {@link CryptoPort}) as `secretRef`, decrypting only transiently inside `verify()`.
 * `provisioningUri` carries the secret in the standard `otpauth://` form so an authenticator app
 * can actually be enrolled; callers must capture it at enroll time, since it is never derivable
 * from `secretRef` again afterward.
 */
export class TotpMfaProvider implements MfaProviderPort {
  readonly method: MfaMethodKind = "totp";

  constructor(
    private readonly crypto: CryptoPort,
    private readonly clock: Clock,
  ) {}

  async enroll(input: {
    readonly principalRef: string;
  }): Promise<{ readonly secretRef: string; readonly provisioningUri: string }> {
    const secret = randomBytes(20);
    const base32Secret = base32Encode(secret);
    const secretRef = await this.crypto.encrypt(base32Secret, KEY_REF);
    const provisioningUri =
      `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(input.principalRef)}` +
      `?secret=${base32Secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30`;
    return { secretRef, provisioningUri };
  }

  async issueChallenge(input: {
    readonly secretRef: string | null;
    readonly deliveryHint?: string;
  }): Promise<{ readonly challengeRef: string }> {
    void input; // TOTP is time-based, not push/SMS-delivered — nothing to send. Ref is correlation-only.
    return { challengeRef: await this.crypto.randomToken(16) };
  }

  async verify(input: { readonly secretRef: string | null; readonly code: string }): Promise<boolean> {
    if (input.secretRef === null) return false;
    let base32Secret: string;
    try {
      base32Secret = await this.crypto.decrypt(input.secretRef, KEY_REF);
    } catch {
      return false;
    }
    let secretBytes: Buffer;
    try {
      secretBytes = base32Decode(base32Secret);
    } catch {
      return false;
    }
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    for (let step = -STEP_TOLERANCE; step <= STEP_TOLERANCE; step += 1) {
      if (totp(secretBytes, nowSeconds + step * 30) === input.code) return true;
    }
    return false;
  }
}
