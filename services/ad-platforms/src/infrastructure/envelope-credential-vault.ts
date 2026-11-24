import type { EnvelopeCipher, SealedEnvelope } from "@platform/secrets";
import type { CredentialVaultPort } from "../application/ports";
import type { AdPlatform } from "../domain/connection";

interface Payload {
  readonly v: 1;
  /** The tenant and platform the secret was sealed for — checked on open. */
  readonly t: string;
  readonly p: string;
  readonly s: string;
}

const OPEN_FAILED = "Ad platform credentials could not be opened";
const SEAL_FAILED = "Ad platform credentials could not be sealed";

/**
 * The real {@link CredentialVaultPort}: `@platform/secrets`' envelope encryption (a fresh data key per
 * payload, wrapped by a KEK that never leaves its backend). What reaches Postgres is only the sealed
 * envelope JSON.
 *
 * The tenant and platform are sealed INSIDE the payload and re-checked on open, so an envelope copied
 * from one shop's row (or platform) into another's does not decrypt to a usable credential
 * (`EnvelopeCipher` has no associated-data channel of its own).
 *
 * Errors are fixed generic messages with no `cause`: they never include the plaintext, the ciphertext,
 * the payload or the underlying library error.
 */
export class EnvelopeCredentialVault implements CredentialVaultPort {
  readonly backing = "real" as const;
  private readonly cipher: EnvelopeCipher;
  private readonly alias: string;

  constructor(cipher: EnvelopeCipher, alias: string) {
    this.cipher = cipher;
    this.alias = alias;
  }

  async seal(tenantId: string, platform: AdPlatform, secret: string): Promise<string> {
    const payload: Payload = { v: 1, t: tenantId, p: platform, s: secret };
    try {
      const envelope = await this.cipher.seal(JSON.stringify(payload), this.alias);
      return JSON.stringify(envelope);
    } catch {
      throw new Error(SEAL_FAILED);
    }
  }

  async open(tenantId: string, platform: AdPlatform, sealed: string): Promise<string> {
    let payload: Partial<Payload>;
    try {
      const envelope = JSON.parse(sealed) as SealedEnvelope;
      payload = JSON.parse(await this.cipher.open(envelope)) as Partial<Payload>;
    } catch {
      throw new Error(OPEN_FAILED);
    }
    if (
      payload.v !== 1 ||
      payload.t !== tenantId ||
      payload.p !== platform ||
      typeof payload.s !== "string"
    ) {
      throw new Error(OPEN_FAILED);
    }
    return payload.s;
  }
}
