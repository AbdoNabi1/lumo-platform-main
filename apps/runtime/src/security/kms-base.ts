import type { CryptoPort, KmsPort } from "@platform/security";

/**
 * Shared base for the cloud **KMS/Vault crypto providers** (H-3 / G-SEC-2). Every provider implements the
 * *key* operations (encrypt/decrypt/sign/verify + key-ref lifecycle) against its backend; the non-key
 * primitives (`hash`/`verifyHash`/`randomToken`) and the envelope `wrapKey`/`unwrapKey` derivation are
 * identical everywhere, so they live here once and delegate to the local `node:crypto` provider
 * (reusing `@platform/security`'s `NodeCrypto`) — no duplicated content-hashing/RNG across four adapters.
 * `wrapKey` is envelope encryption of key material under a KEK ref; the KEK never leaves the backend.
 */
export abstract class KmsCryptoProvider implements KmsPort, CryptoPort {
  protected constructor(protected readonly localCrypto: CryptoPort) {}

  abstract readonly name: string;
  abstract generateKeyRef(purpose: string): Promise<string>;
  abstract rotate(keyRef: string): Promise<string>;
  abstract encrypt(plaintext: string, keyRef: string): Promise<string>;
  abstract decrypt(ciphertext: string, keyRef: string): Promise<string>;
  abstract sign(payload: string, keyRef: string): Promise<string>;
  abstract verify(payload: string, signature: string, keyRef: string): Promise<boolean>;

  /** Envelope-encrypts key material under a KEK ref — the KEK stays inside the backend (never exported). */
  async wrapKey(keyMaterial: string, kekRef: string): Promise<string> {
    return this.encrypt(keyMaterial, kekRef);
  }
  async unwrapKey(wrapped: string, kekRef: string): Promise<string> {
    return this.decrypt(wrapped, kekRef);
  }

  hash(value: string): Promise<string> {
    return this.localCrypto.hash(value);
  }
  verifyHash(value: string, hash: string): Promise<boolean> {
    return this.localCrypto.verifyHash(value, hash);
  }
  randomToken(bytes?: number): Promise<string> {
    return this.localCrypto.randomToken(bytes);
  }
  /** Non-reversible fingerprint of a material handle — a SHA-256 digest, never the raw value (KmsPort). */
  async fingerprint(material: string): Promise<string> {
    return `fp_${await this.localCrypto.hash(material)}`;
  }
}

/** UTF-8 → base64 (KMS/Vault APIs exchange plaintext as base64). */
export function b64encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/** base64 → UTF-8. */
export function b64decode(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}

/** Sanitises a purpose string into a backend-safe key name (alphanumeric plus `-_.`). */
export function safeKeyName(purpose: string): string {
  const cleaned = purpose.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  return cleaned.length === 0 ? "default" : cleaned;
}
