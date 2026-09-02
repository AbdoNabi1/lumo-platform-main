import { AppError } from "@platform/utils";

/**
 * **Envelope encryption** with key **versioning** + **aliasing** (H-3 / G-SEC-2). A reusable primitive
 * that extends `@platform/secrets` without a new crypto/secret engine: it never implements ciphers itself,
 * delegating every key operation to an injected {@link KeyWrapCipher} (any KMS/Vault/HSM-backed
 * `CryptoPort` satisfies it structurally — no dependency on a bounded context). Each payload gets a fresh
 * **data key** encrypted under a KEK reference; the DEK is wrapped by the KEK, which never leaves the
 * backend. Rotating a key **alias** points new writes at the new KEK version while previously sealed data
 * keeps decrypting under the KEK ref embedded in its envelope. Rotation *scheduling* / emergency rotation
 * / lineage stay in the Security context's Credential engine — this is only the cryptographic envelope.
 */

/** The key operations envelope encryption needs — structurally satisfied by a KMS/Vault/HSM `CryptoPort`. */
export interface KeyWrapCipher {
  encrypt(plaintext: string, keyRef: string): Promise<string>;
  decrypt(ciphertext: string, keyRef: string): Promise<string>;
  wrapKey(keyMaterial: string, kekRef: string): Promise<string>;
  unwrapKey(wrapped: string, kekRef: string): Promise<string>;
  randomToken(bytes?: number): Promise<string>;
}

/** A sealed envelope — self-describing so it decrypts under the KEK version it was written with. */
export interface SealedEnvelope {
  /** Envelope format version (currently 1). */
  readonly v: number;
  /** The alias in effect at seal time (audit/telemetry only; decryption uses `kekRef`). */
  readonly alias: string;
  /** The exact KEK reference/version the data key was wrapped under. */
  readonly kekRef: string;
  /** The data key, wrapped by the KEK. */
  readonly wrappedDek: string;
  /** The payload, encrypted with the data key. */
  readonly ciphertext: string;
}

const ENVELOPE_VERSION = 1;
const DEK_BYTES = 32;

/**
 * A registry mapping stable **aliases** (e.g. `primary`) to the current KEK reference, with version
 * history. Aliasing decouples callers from concrete KEK versions; rotating an alias is how key rotation
 * is expressed at the envelope layer (old envelopes still resolve their own embedded KEK ref).
 */
export class KeyAliasRegistry {
  private readonly current = new Map<string, string>();
  private readonly history = new Map<string, string[]>();

  /** Points an alias at a KEK ref (first call sets it; later calls rotate it, recording history). */
  set(alias: string, kekRef: string): void {
    if (alias.trim().length === 0)
      throw new AppError("alias is required", { code: "SECRET_ALIAS_INVALID" });
    if (kekRef.trim().length === 0)
      throw new AppError("kekRef is required", { code: "SECRET_KEKREF_INVALID" });
    this.current.set(alias, kekRef);
    const versions = this.history.get(alias) ?? [];
    versions.push(kekRef);
    this.history.set(alias, versions);
  }

  /** Rotates the alias to a new KEK ref, returning the previous ref (or null if it was unset). */
  rotate(alias: string, newKekRef: string): string | null {
    const previous = this.current.get(alias) ?? null;
    this.set(alias, newKekRef);
    return previous;
  }

  /** The KEK ref currently bound to an alias, or throws if the alias is unknown (fail-closed). */
  resolve(alias: string): string {
    const kekRef = this.current.get(alias);
    if (kekRef === undefined)
      throw new AppError(`unknown key alias: ${alias}`, { code: "SECRET_ALIAS_UNKNOWN" });
    return kekRef;
  }

  /** Every KEK ref this alias has pointed at, oldest first (key version lineage). */
  versions(alias: string): readonly string[] {
    return [...(this.history.get(alias) ?? [])];
  }
}

export class EnvelopeCipher {
  private readonly cipher: KeyWrapCipher;
  private readonly aliases: KeyAliasRegistry;

  constructor(cipher: KeyWrapCipher, aliases: KeyAliasRegistry) {
    this.cipher = cipher;
    this.aliases = aliases;
  }

  /** Seals a plaintext under the alias's current KEK version — fresh data key per call. */
  async seal(plaintext: string, alias = "primary"): Promise<SealedEnvelope> {
    const kekRef = this.aliases.resolve(alias);
    const dek = await this.cipher.randomToken(DEK_BYTES);
    const [wrappedDek, ciphertext] = await Promise.all([
      this.cipher.wrapKey(dek, kekRef),
      this.cipher.encrypt(plaintext, dek),
    ]);
    return { v: ENVELOPE_VERSION, alias, kekRef, wrappedDek, ciphertext };
  }

  /** Opens a sealed envelope using the KEK ref it embeds, so rotation never strands old data. */
  async open(envelope: SealedEnvelope): Promise<string> {
    if (envelope.v !== ENVELOPE_VERSION)
      throw new AppError(`unsupported envelope version: ${envelope.v}`, {
        code: "SECRET_ENVELOPE_VERSION",
      });
    const dek = await this.cipher.unwrapKey(envelope.wrappedDek, envelope.kekRef);
    return this.cipher.decrypt(envelope.ciphertext, dek);
  }
}
