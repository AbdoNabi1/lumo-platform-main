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

/** What is persisted: the sealed envelope WITHOUT its key reference. */
interface StoredEnvelope {
  readonly v: number;
  readonly alias: string;
  readonly wrappedDek: string;
  readonly ciphertext: string;
}

/** The trusted, configured alias → key reference lookup (`undefined` for an unknown alias). */
export type KekRefResolver = (alias: string) => string | undefined;

const OPEN_FAILED = "Ad platform credentials could not be opened";
const SEAL_FAILED = "Ad platform credentials could not be sealed";
const STORED_KEYS = ["alias", "ciphertext", "v", "wrappedDek"];

/**
 * The real {@link CredentialVaultPort}: `@platform/secrets`' envelope encryption (a fresh data key per
 * payload, wrapped by a KEK that never leaves its backend). What reaches Postgres is only
 * `{ v, alias, wrappedDek, ciphertext }`.
 *
 * The key reference is NEVER stored: with the stock `NodeCrypto` it is the secret the KEK is derived
 * from, so a row carrying it would carry its own decryption key. It is resolved on open from the
 * vault's own trusted, configured alias registry (`resolveKekRef`), never from the row. A stored row
 * that has a `kekRef` property at all, or names an unknown alias, is refused.
 * (Follow-up: rotating the KEK behind the same alias strands old rows; rotation needs a versioned,
 * non-secret key identifier plus a trusted historical-key registry.)
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
  private readonly resolveKekRef: KekRefResolver;

  constructor(cipher: EnvelopeCipher, alias: string, resolveKekRef: KekRefResolver) {
    this.cipher = cipher;
    this.alias = alias;
    this.resolveKekRef = resolveKekRef;
  }

  async seal(tenantId: string, platform: AdPlatform, secret: string): Promise<string> {
    const payload: Payload = { v: 1, t: tenantId, p: platform, s: secret };
    try {
      const envelope = await this.cipher.seal(JSON.stringify(payload), this.alias);
      const stored: StoredEnvelope = {
        v: envelope.v,
        alias: envelope.alias,
        wrappedDek: envelope.wrappedDek,
        ciphertext: envelope.ciphertext,
      };
      return JSON.stringify(stored);
    } catch {
      throw new Error(SEAL_FAILED);
    }
  }

  async open(tenantId: string, platform: AdPlatform, sealed: string): Promise<string> {
    try {
      const parsed: unknown = JSON.parse(sealed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("shape");
      }
      const row = parsed as Record<string, unknown>;
      // Exactly the four stored fields (so any own `kekRef`, even null, is refused) with the right types.
      const keys = Object.keys(row).sort();
      if (keys.length !== STORED_KEYS.length || keys.some((key, i) => key !== STORED_KEYS[i])) {
        throw new Error("shape");
      }
      const { v, alias, wrappedDek, ciphertext } = row;
      if (
        typeof v !== "number" ||
        typeof alias !== "string" ||
        typeof wrappedDek !== "string" ||
        typeof ciphertext !== "string"
      ) {
        throw new Error("shape");
      }
      const kekRef = this.resolveKekRef(alias);
      if (typeof kekRef !== "string" || kekRef.length === 0) throw new Error("alias");
      const envelope: SealedEnvelope = { v, alias, kekRef, wrappedDek, ciphertext };
      const decrypted: unknown = JSON.parse(await this.cipher.open(envelope));
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
}
