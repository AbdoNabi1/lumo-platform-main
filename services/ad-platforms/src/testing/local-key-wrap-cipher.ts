import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { EnvelopeCipher, KeyAliasRegistry, type KeyWrapCipher } from "@platform/secrets";
import { EnvelopeCredentialVault } from "../infrastructure/envelope-credential-vault";

/**
 * TEST DOUBLE ONLY. A real AES-256-GCM `KeyWrapCipher` (so tests exercise genuine encryption, not a base64
 * stand-in) whose KEK is derived from the key ref, like the runtime's `NodeCrypto`. Production composes
 * `@platform/security`'s crypto (or a KMS provider) instead; this exists because a service may not import
 * another service's internals.
 */
class LocalKeyWrapCipher implements KeyWrapCipher {
  private key(ref: string): Buffer {
    return scryptSync(ref, "ad-platforms-test", 32);
  }

  encrypt(plaintext: string, keyRef: string): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(keyRef), iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Promise.resolve(
      `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`,
    );
  }

  decrypt(ciphertext: string, keyRef: string): Promise<string> {
    const [iv, tag, ct] = ciphertext.split(":");
    if (iv === undefined || tag === undefined || ct === undefined) {
      return Promise.reject(new Error("malformed ciphertext"));
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key(keyRef), Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Promise.resolve(
        Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString(
          "utf8",
        ),
      );
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error("decrypt failed"));
    }
  }

  wrapKey(keyMaterial: string, kekRef: string): Promise<string> {
    return this.encrypt(keyMaterial, kekRef);
  }

  unwrapKey(wrapped: string, kekRef: string): Promise<string> {
    return this.decrypt(wrapped, kekRef);
  }

  randomToken(bytes = 24): Promise<string> {
    return Promise.resolve(randomBytes(bytes).toString("hex"));
  }
}

export const TEST_KEK_ALIAS = "ad-platform-credentials";
export const TEST_KEK_REF = "test-kek-ref-0123456789-0123456789-abcdef";

/** The real envelope vault over a genuine AES-GCM cipher and a test KEK. */
export function testEnvelopeVault(kekRef: string = TEST_KEK_REF): EnvelopeCredentialVault {
  const aliases = new KeyAliasRegistry();
  aliases.set(TEST_KEK_ALIAS, kekRef);
  return new EnvelopeCredentialVault(
    new EnvelopeCipher(new LocalKeyWrapCipher(), aliases),
    TEST_KEK_ALIAS,
    (alias) => (alias === TEST_KEK_ALIAS ? kekRef : undefined),
  );
}
