import { AppError } from "@platform/utils";

/**
 * **Envelope encryption** with key **versioning** + **aliasing** (H-3 / G-SEC-2). A reusable primitive
 * that extends `@platform/secrets` without a new crypto/secret engine: it never implements ciphers itself,
 * delegating every key operation to an injected {@link KeyWrapCipher} (any KMS/Vault/HSM-backed
 * `CryptoPort` satisfies it structurally — no dependency on a bounded context). Each payload gets a fresh
 * **data key** encrypted under a KEK reference; the DEK is wrapped by the KEK, which never leaves the
 * backend. Rotating a key **alias** points new writes at the new KEK version while previously sealed data
 * keeps decrypting under the alias's recorded earlier versions. Rotation *scheduling* / emergency rotation
 * / lineage stay in the Security context's Credential engine — this is only the cryptographic envelope.
 *
 * **The key reference is never stored (O15).** With the stock `NodeCrypto` the KEK is derived from the
 * reference string itself, so a reference stored next to the ciphertext IS the key. A sealed envelope is
 * `{ v: 2, alias, wrappedDek, ciphertext }` and {@link EnvelopeCipher.open} takes its candidate keys only
 * from the trusted {@link KeyAliasRegistry}, never from the stored value (a `kekRef` on a legacy v1 row is
 * ignored).
 */

/** The key operations envelope encryption needs — structurally satisfied by a KMS/Vault/HSM `CryptoPort`. */
export interface KeyWrapCipher {
  encrypt(plaintext: string, keyRef: string): Promise<string>;
  decrypt(ciphertext: string, keyRef: string): Promise<string>;
  wrapKey(keyMaterial: string, kekRef: string): Promise<string>;
  unwrapKey(wrapped: string, kekRef: string): Promise<string>;
  randomToken(bytes?: number): Promise<string>;
}

/**
 * A sealed envelope: self-describing for everything EXCEPT the key. `kekRef` exists only on legacy v1
 * rows that were written before O15; it is never emitted and never read.
 */
export interface SealedEnvelope {
  /** Envelope format version: 2 is written; 1 (legacy, carried a `kekRef`) is still opened. */
  readonly v: number;
  /** The alias in effect at seal time: how `open` finds the candidate keys in the trusted registry. */
  readonly alias: string;
  /** The data key, wrapped by the KEK. */
  readonly wrappedDek: string;
  /** The payload, encrypted with the data key. */
  readonly ciphertext: string;
  /** LEGACY v1 ONLY and IGNORED: with `NodeCrypto` it is the key itself, so it must never be trusted. */
  readonly kekRef?: string;
}

const ENVELOPE_VERSION = 2;
const LEGACY_ENVELOPE_VERSION = 1;
const DEK_BYTES = 32;

/** The one error every failed open raises: it names no key, alias, plaintext or ciphertext. */
function openFailed(): AppError {
  return new AppError("Sealed value could not be opened", { code: "SECRET_ENVELOPE_OPEN_FAILED" });
}

/**
 * A registry mapping stable **aliases** (e.g. `primary`) to the current KEK reference, with version
 * history. Aliasing decouples callers from concrete KEK versions; rotating an alias is how key rotation
 * is expressed at the envelope layer (old envelopes still open under the recorded earlier versions).
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

  /**
   * The keys `open` may try for an alias, in try-order: the CURRENT ref first, then every earlier
   * version newest to oldest, each once. Empty for an unknown alias (a copy: callers cannot edit the
   * registry through it).
   */
  candidates(alias: string): readonly string[] {
    const current = this.current.get(alias);
    if (current === undefined) return [];
    const ordered = [current, ...[...(this.history.get(alias) ?? [])].reverse()];
    return [...new Set(ordered)];
  }
}

export class EnvelopeCipher {
  private readonly cipher: KeyWrapCipher;
  private readonly aliases: KeyAliasRegistry;

  constructor(cipher: KeyWrapCipher, aliases: KeyAliasRegistry) {
    this.cipher = cipher;
    this.aliases = aliases;
  }

  /**
   * Seals a plaintext under the alias's current KEK version — fresh data key per call. The result
   * carries NO key reference.
   */
  async seal(plaintext: string, alias = "primary"): Promise<SealedEnvelope> {
    const kekRef = this.aliases.resolve(alias);
    const dek = await this.cipher.randomToken(DEK_BYTES);
    const [wrappedDek, ciphertext] = await Promise.all([
      this.cipher.wrapKey(dek, kekRef),
      this.cipher.encrypt(plaintext, dek),
    ]);
    return { v: ENVELOPE_VERSION, alias, wrappedDek, ciphertext };
  }

  /**
   * Opens a sealed envelope. The key comes ONLY from the trusted registry for the envelope's alias
   * (current version first, then earlier ones); any `kekRef` in the stored value is ignored. A wrong key
   * fails AES-GCM authentication, so each candidate is simply tried in turn. Every failure (bad shape,
   * unknown alias, no key opens it) is the same generic error.
   */
  async open(envelope: SealedEnvelope): Promise<string> {
    return (await this.openRanked(envelope)).plaintext;
  }

  /**
   * Re-wraps an envelope under the alias's CURRENT key as a fresh v2 envelope (rotation). Returns
   * `null` when it is already v2 and opens under the current key (nothing to do). Throws the generic
   * open error for an envelope no trusted key opens.
   */
  async reseal(envelope: SealedEnvelope): Promise<SealedEnvelope | null> {
    const { plaintext, rank } = await this.openRanked(envelope);
    if (envelope.v === ENVELOPE_VERSION && rank === 0) return null;
    return this.seal(plaintext, envelope.alias);
  }

  private async openRanked(
    envelope: SealedEnvelope,
  ): Promise<{ readonly plaintext: string; readonly rank: number }> {
    const stored = envelope as unknown;
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) throw openFailed();
    const { v, alias, wrappedDek, ciphertext } = stored as Partial<
      Record<keyof SealedEnvelope, unknown>
    >;
    if (
      (v !== ENVELOPE_VERSION && v !== LEGACY_ENVELOPE_VERSION) ||
      typeof alias !== "string" ||
      typeof wrappedDek !== "string" ||
      typeof ciphertext !== "string"
    ) {
      throw openFailed();
    }
    const candidates = this.aliases.candidates(alias);
    for (const [rank, kekRef] of candidates.entries()) {
      try {
        const dek = await this.cipher.unwrapKey(wrappedDek, kekRef);
        return { plaintext: await this.cipher.decrypt(ciphertext, dek), rank };
      } catch {
        // A wrong key fails authentication: try the next trusted candidate. The cause is dropped.
      }
    }
    throw openFailed();
  }
}
