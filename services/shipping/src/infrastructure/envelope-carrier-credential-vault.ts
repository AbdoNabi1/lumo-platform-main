import type { EnvelopeCipher, SealedEnvelope } from "@platform/secrets";
import type { CarrierCredentialVault } from "../application/ports";

/** The KEK alias carrier secrets are sealed under — its own, never payments' (spec §6). */
export const SHIPPING_CREDENTIALS_KEY_ALIAS = "shipping-credentials";

const OPEN_FAILED = "Carrier credentials could not be opened";

interface Payload {
  readonly v: 1;
  /** The tenant and carrier key the secrets were sealed for, checked on open. */
  readonly t: string;
  readonly c: string;
  readonly s: Readonly<Record<string, string>>;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

/**
 * The real {@link CarrierCredentialVault}: `@platform/secrets`' envelope encryption (a fresh data key
 * per payload, wrapped by a KEK that never leaves its backend). What reaches Postgres is only the
 * sealed envelope JSON. Mirrors payments' `EnvelopePaymentCredentialVault`.
 *
 * The key reference is NEVER stored (O15): with the stock `NodeCrypto` it is the secret the KEK is
 * derived from, so a row carrying it would carry its own decryption key. What is stored is exactly
 * `{ v: 2, alias, wrappedDek, ciphertext }`. On open only those four fields reach the cipher (a
 * `kekRef` on a legacy v1 row is dropped here and ignored by the cipher) and the key comes from the
 * trusted alias registry: the current ref, then the previous one while a rotation is under way.
 *
 * The tenant and carrier key are sealed INSIDE the payload and re-checked on open
 * (`EnvelopeCipher` has no associated-data channel of its own). Every failure, whatever its
 * cause, is the same message, which names no tenant, key, plaintext or ciphertext.
 */
export class EnvelopeCarrierCredentialVault implements CarrierCredentialVault {
  readonly backing = "real" as const;
  private readonly cipher: EnvelopeCipher;
  private readonly alias: string;

  constructor(cipher: EnvelopeCipher, alias: string) {
    this.cipher = cipher;
    this.alias = alias;
  }

  async seal(
    tenantId: string,
    carrierKey: string,
    secrets: Readonly<Record<string, string>>,
  ): Promise<string> {
    const payload: Payload = { v: 1, t: tenantId, c: carrierKey, s: secrets };
    const envelope = await this.cipher.seal(JSON.stringify(payload), this.alias);
    return JSON.stringify(storedFields(envelope));
  }

  async open(
    tenantId: string,
    carrierKey: string,
    sealed: string,
  ): Promise<Readonly<Record<string, string>>> {
    let payload: Payload;
    try {
      payload = JSON.parse(await this.cipher.open(this.storedEnvelope(sealed))) as Payload;
    } catch {
      throw new Error(OPEN_FAILED);
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      payload.v !== 1 ||
      payload.t !== tenantId ||
      payload.c !== carrierKey ||
      !isStringRecord(payload.s)
    ) {
      throw new Error(OPEN_FAILED);
    }
    return payload.s;
  }

  /**
   * Rotation (O15): re-wraps one stored envelope under the CURRENT key as a fresh v2 envelope, keeping
   * the sealed payload (and so its tenant/carrier binding) untouched. Returns the input string itself
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
 * NOT encryption. The offline/test stand-in so shipping composes without a KEK. It reports itself
 * as `stub`, which the boot guard (Task 12) refuses outside `local`. It still re-checks the tenant
 * and carrier key, so tests built on it keep the isolation property.
 */
export class InMemoryCarrierCredentialVault implements CarrierCredentialVault {
  readonly backing = "stub" as const;

  seal(
    tenantId: string,
    carrierKey: string,
    secrets: Readonly<Record<string, string>>,
  ): Promise<string> {
    const body = Buffer.from(JSON.stringify({ t: tenantId, c: carrierKey, s: secrets })).toString(
      "base64",
    );
    return Promise.resolve(`stub:${body}`);
  }

  open(
    tenantId: string,
    carrierKey: string,
    sealed: string,
  ): Promise<Readonly<Record<string, string>>> {
    let parsed: { t?: unknown; c?: unknown; s?: unknown };
    try {
      parsed = JSON.parse(
        Buffer.from(sealed.replace(/^stub:/, ""), "base64").toString("utf8"),
      ) as typeof parsed;
    } catch {
      return Promise.reject(new Error(OPEN_FAILED));
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.t !== tenantId ||
      parsed.c !== carrierKey ||
      !isStringRecord(parsed.s)
    ) {
      return Promise.reject(new Error(OPEN_FAILED));
    }
    return Promise.resolve(parsed.s);
  }
}
