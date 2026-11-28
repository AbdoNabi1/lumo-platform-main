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
 * payload, wrapped by a KEK that never leaves its backend). What reaches Postgres is only
 * `{ v: 2, alias, wrappedDek, ciphertext }`.
 *
 * The key reference is NEVER stored (O15): with the stock `NodeCrypto` it is the secret the KEK is derived
 * from, so a row carrying it would carry its own decryption key. `EnvelopeCipher` seals without it and opens
 * with keys taken only from its trusted alias registry; a `kekRef` on a stored row (a legacy v1 shape) is
 * dropped here and ignored by the cipher, never used. A row naming another alias is refused.
 *
 * The tenant and platform are sealed INSIDE the payload and re-checked on open, so an envelope copied
 * from one shop's row (or platform) into another's does not decrypt to a usable credential
 * (`EnvelopeCipher` has no associated-data channel of its own).
 *
 * Errors are fixed generic messages with no `cause`: they never include the plaintext, the ciphertext,
 * the payload or the underlying library error.
 *
 * Rotation: the trusted registry may hold a previous ref for the alias, so rows sealed under it keep
 * opening. No re-seal job covers this table yet (it has no production rows); `reseal` is there for it.
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
      return JSON.stringify(storedFields(envelope));
    } catch {
      throw new Error(SEAL_FAILED);
    }
  }

  async open(tenantId: string, platform: AdPlatform, sealed: string): Promise<string> {
    try {
      const decrypted: unknown = JSON.parse(await this.cipher.open(this.storedEnvelope(sealed)));
      if (typeof decrypted !== "object" || decrypted === null) throw new Error("payload");
      const payload = decrypted as Partial<Payload>;
      if (
        payload.v !== 1 ||
        payload.t !== tenantId ||
        payload.p !== platform ||
        typeof payload.s !== "string"
      ) {
        throw new Error("payload");
      }
      return payload.s;
    } catch {
      throw new Error(OPEN_FAILED);
    }
  }

  /**
   * Rotation (O15): re-wraps one stored envelope under the CURRENT key as a fresh v2 envelope, the sealed
   * payload (and so its tenant/platform binding) untouched. Returns the input itself when it is already v2
   * under the current key. Fails with the generic message for anything the trusted keys cannot open.
   */
  async reseal(sealed: string): Promise<string> {
    try {
      const next = await this.cipher.reseal(this.storedEnvelope(sealed));
      return next === null ? sealed : JSON.stringify(storedFields(next));
    } catch {
      throw new Error(OPEN_FAILED);
    }
  }

  /** The four stored fields of a row (anything else on it, a legacy `kekRef` included, is dropped). */
  private storedEnvelope(sealed: string): SealedEnvelope {
    const parsed: unknown = JSON.parse(sealed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("shape");
    }
    const { v, alias, wrappedDek, ciphertext } = parsed as Record<string, unknown>;
    if (
      typeof v !== "number" ||
      alias !== this.alias ||
      typeof wrappedDek !== "string" ||
      typeof ciphertext !== "string"
    ) {
      throw new Error("shape");
    }
    return { v, alias, wrappedDek, ciphertext };
  }
}

function storedFields(envelope: SealedEnvelope): SealedEnvelope {
  return {
    v: envelope.v,
    alias: envelope.alias,
    wrappedDek: envelope.wrappedDek,
    ciphertext: envelope.ciphertext,
  };
}
