import type { EnvelopeCipher, SealedEnvelope } from "@platform/secrets";
import type { PaymentCredentialVault, ProviderBacking } from "../application/ports";
import type { PaymentProviderKey } from "../domain/value-objects/payment-provider-key";

const OPEN_FAILED = "Merchant payment credentials could not be opened";

interface Payload {
  readonly v: 1;
  /** The tenant and provider the secrets were sealed for — checked on open. */
  readonly t: string;
  readonly p: string;
  readonly s: Readonly<Record<string, string>>;
}

/**
 * The real {@link PaymentCredentialVault}: `@platform/secrets`' envelope encryption (a fresh data key
 * per payload, wrapped by a KEK that never leaves its backend). What reaches Postgres is only the
 * sealed envelope JSON.
 *
 * The tenant and provider are sealed INSIDE the payload and re-checked on open, so an envelope
 * copied from one merchant's row into another's does not decrypt to a usable credential
 * (`EnvelopeCipher` has no associated-data channel of its own).
 *
 * The key reference is NEVER stored (O15): with the stock `NodeCrypto` it is the secret the KEK is
 * derived from, so a row carrying it would carry its own decryption key. What is stored is exactly
 * `{ v: 2, alias, wrappedDek, ciphertext }`. On open only those four fields reach the cipher (a
 * `kekRef` on a legacy v1 row is dropped here and ignored by the cipher) and the key comes from the
 * trusted alias registry: the current ref, then the previous one while a rotation is under way.
 *
 * Error messages never include plaintext, ciphertext or the payload.
 */
export class EnvelopePaymentCredentialVault implements PaymentCredentialVault {
  readonly backing: ProviderBacking = "real";
  private readonly cipher: EnvelopeCipher;
  private readonly alias: string;

  constructor(cipher: EnvelopeCipher, alias: string) {
    this.cipher = cipher;
    this.alias = alias;
  }

  async seal(
    tenantId: string,
    provider: PaymentProviderKey,
    secrets: Readonly<Record<string, string>>,
  ): Promise<string> {
    const payload: Payload = { v: 1, t: tenantId, p: provider, s: secrets };
    const envelope = await this.cipher.seal(JSON.stringify(payload), this.alias);
    return JSON.stringify(storedFields(envelope));
  }

  async open(
    tenantId: string,
    provider: PaymentProviderKey,
    sealed: string,
  ): Promise<Readonly<Record<string, string>>> {
    let payload: Payload;
    try {
      const envelope = this.storedEnvelope(sealed);
      payload = JSON.parse(await this.cipher.open(envelope)) as Payload;
    } catch {
      throw new Error(OPEN_FAILED);
    }
    if (payload.v !== 1 || payload.t !== tenantId || payload.p !== provider) {
      throw new Error(OPEN_FAILED);
    }
    return payload.s;
  }

  /**
   * Rotation (O15): re-wraps one stored envelope under the CURRENT key as a fresh v2 envelope, keeping
   * the sealed payload (and so its tenant/provider binding) untouched. Returns the input string itself
   * when it is already v2 under the current key. Fails with the generic message for anything the
   * trusted keys cannot open; nothing is ever written back from here.
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

/**
 * NOT encryption. Offline/test stand-in so `wirePayments` composes without a KEK; reports itself as
 * `stub`, which `assertProductionPaymentProviderConfigured` refuses outside `local`.
 */
export class InMemoryPaymentCredentialVault implements PaymentCredentialVault {
  readonly backing: ProviderBacking = "stub";

  seal(
    tenantId: string,
    provider: PaymentProviderKey,
    secrets: Readonly<Record<string, string>>,
  ): Promise<string> {
    const body = Buffer.from(JSON.stringify({ tenantId, provider, secrets })).toString("base64");
    return Promise.resolve(`stub:${body}`);
  }

  open(
    tenantId: string,
    provider: PaymentProviderKey,
    sealed: string,
  ): Promise<Readonly<Record<string, string>>> {
    const parsed = JSON.parse(Buffer.from(sealed.replace(/^stub:/, ""), "base64").toString()) as {
      tenantId: string;
      provider: string;
      secrets: Record<string, string>;
    };
    if (parsed.tenantId !== tenantId || parsed.provider !== provider) {
      return Promise.reject(new Error(OPEN_FAILED));
    }
    return Promise.resolve(parsed.secrets);
  }
}
